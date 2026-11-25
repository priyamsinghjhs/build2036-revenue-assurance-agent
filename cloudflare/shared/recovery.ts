/**
 * Recovery lifecycle: states, allowed transitions, RBAC per target state and
 * amount rules. Pure, shared by the Worker, the UI and the tests.
 */
import { HIGH_VALUE_INR, hasPermission, type AppUser, type Permission } from "./roles";
import { normalizeAmount } from "./numbers";

export const RECOVERY_STATES = [
  "identified",
  "claimed",
  "disputed",
  "partially_recovered",
  "recovered",
  "written_off",
  "closed",
] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const RECOVERY_LABELS: Record<RecoveryState, string> = {
  identified: "Identified",
  claimed: "Claimed / raised",
  disputed: "Disputed",
  partially_recovered: "Partially recovered",
  recovered: "Recovered",
  written_off: "Written off",
  closed: "Closed",
};

export const TRANSITIONS: Record<RecoveryState, RecoveryState[]> = {
  identified: ["claimed", "written_off"],
  claimed: ["disputed", "partially_recovered", "recovered", "written_off"],
  disputed: ["claimed", "partially_recovered", "recovered", "written_off"],
  partially_recovered: ["partially_recovered", "disputed", "recovered", "written_off"],
  recovered: ["closed"],
  written_off: ["closed"],
  closed: [],
};

/** Permissions that may move an item INTO a state (any one suffices). */
export const TRANSITION_PERMS: Record<RecoveryState, Permission[]> = {
  identified: [],
  claimed: ["action_draft"],
  disputed: ["action_draft"],
  partially_recovered: ["action_draft"],
  recovered: ["action_draft"],
  written_off: ["approve_treasury", "approve_high_value"],
  closed: ["approve_review", "approve_treasury"],
};

export const DEFAULT_SLA_DAYS = 30;

export type RecoveryItem = {
  exception_id: string;
  state: RecoveryState;
  expected_amount: number;
  recovered_amount: number;
  written_off_amount: number;
  owner: string | null;
  due_date: string | null;
  version: number;
  last_actor: string | null;
};

export type TransitionInput = {
  to: string;
  amount?: number | null;
  owner?: string | null;
  due_date?: string | null;
  note?: string | null;
  expected_version?: number | null;
};

export type TransitionResult =
  | {
      ok: true;
      next: RecoveryItem;
      amount_delta: number;
      closed: boolean;
    }
  | { ok: false; status: 400 | 403 | 409; error: string };

export function isRecoveryState(s: string): s is RecoveryState {
  return (RECOVERY_STATES as readonly string[]).includes(s);
}

export function canEnterState(user: AppUser, to: RecoveryState, amount = 0): boolean {
  const perms = TRANSITION_PERMS[to];
  if (!perms.length) return false;
  if (!perms.some((p) => hasPermission(user.role, p))) return false;
  if (to === "written_off" && Math.abs(amount) >= HIGH_VALUE_INR) return hasPermission(user.role, "approve_high_value");
  return true;
}

/** States this user may move the item to next (for the UI). */
export function allowedNextStates(user: AppUser, item: RecoveryItem): RecoveryState[] {
  return TRANSITIONS[item.state].filter((to) => {
    const amt = to === "written_off" ? item.expected_amount - item.recovered_amount : 0;
    if (!canEnterState(user, to, amt)) return false;
    if (to === "closed" && item.last_actor === user.id) return false;
    return true;
  });
}

function isoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));
}

/** Validate a transition and compute the next item. Never touches the database. */
export function applyTransition(user: AppUser, item: RecoveryItem, input: TransitionInput): TransitionResult {
  const to = String(input.to || "");
  if (!isRecoveryState(to)) return { ok: false, status: 400, error: `Unknown state "${to}".` };
  if (input.expected_version != null && Number(input.expected_version) !== item.version) {
    return { ok: false, status: 409, error: `Item changed (version ${item.version}); reload and retry.` };
  }
  if (!TRANSITIONS[item.state].includes(to)) {
    return { ok: false, status: 400, error: `Cannot move from ${item.state} to ${to}.` };
  }
  const expected = normalizeAmount(item.expected_amount);
  const already = normalizeAmount(item.recovered_amount);
  const outstanding = normalizeAmount(expected - already);
  const woAmount = to === "written_off" ? outstanding : 0;
  if (!canEnterState(user, to, woAmount)) {
    return { ok: false, status: 403, error: `Your role (${user.role}) cannot move an item to ${to}.` };
  }
  if (to === "closed" && item.last_actor === user.id) {
    return { ok: false, status: 403, error: "Maker-checker: a different user must close an item you last updated." };
  }
  const note = String(input.note ?? "").trim();
  if ((to === "written_off" || to === "closed" || to === "disputed") && !note) {
    return { ok: false, status: 400, error: `A note is required to move to ${to}.` };
  }
  let delta = 0;
  if (to === "partially_recovered") {
    delta = normalizeAmount(input.amount ?? 0);
    if (!(delta > 0)) return { ok: false, status: 400, error: "Enter the amount recovered (greater than 0)." };
    if (already + delta >= expected - 0.005) {
      return { ok: false, status: 400, error: "That amount completes the recovery; use Recovered instead." };
    }
  } else if (to === "recovered") {
    delta = input.amount == null || input.amount === 0 ? outstanding : normalizeAmount(input.amount);
    if (!(delta > 0)) return { ok: false, status: 400, error: "Nothing outstanding to recover." };
    if (Math.abs(already + delta - expected) > 0.005) {
      return { ok: false, status: 400, error: `Recovered must bring the total to the expected ${expected.toFixed(2)} (outstanding ${outstanding.toFixed(2)}). Use Partially recovered for less.` };
    }
  } else if (input.amount != null && Number(input.amount) !== 0) {
    return { ok: false, status: 400, error: `No amount is recorded when moving to ${to}.` };
  }
  let due = item.due_date;
  if (input.due_date != null && input.due_date !== "") {
    if (!isoDate(String(input.due_date))) return { ok: false, status: 400, error: "due_date must be YYYY-MM-DD." };
    due = String(input.due_date);
  }
  const owner = input.owner != null && String(input.owner).trim() ? String(input.owner).trim().slice(0, 120) : item.owner ?? user.id;
  const next: RecoveryItem = {
    ...item,
    state: to,
    recovered_amount: normalizeAmount(already + delta),
    written_off_amount: to === "written_off" ? outstanding : item.written_off_amount,
    owner,
    due_date: due,
    version: item.version + 1,
    last_actor: user.id,
  };
  return { ok: true, next, amount_delta: delta, closed: to === "closed" };
}

export type TrackerRow = { state: string; expected_amount: number; recovered_amount: number; written_off_amount: number; potential_amount: number };

/** Totals the tracker and executive tiles show; the Worker computes the same in SQL and the tests compare. */
export function recoveryTotals(rows: TrackerRow[]) {
  const by_state: Record<string, { n: number; expected: number; recovered: number }> = {};
  let potential = 0;
  let recovered = 0;
  let written_off = 0;
  for (const r of rows) {
    potential += Number(r.potential_amount || 0);
    recovered += Number(r.recovered_amount || 0);
    written_off += Number(r.written_off_amount || 0);
    const b = (by_state[r.state] ??= { n: 0, expected: 0, recovered: 0 });
    b.n += 1;
    b.expected += Number(r.expected_amount || 0);
    b.recovered += Number(r.recovered_amount || 0);
  }
  for (const b of Object.values(by_state)) {
    b.expected = normalizeAmount(b.expected);
    b.recovered = normalizeAmount(b.recovered);
  }
  potential = normalizeAmount(potential);
  recovered = normalizeAmount(recovered);
  written_off = normalizeAmount(written_off);
  return {
    potential,
    recovered,
    written_off,
    open: normalizeAmount(potential - recovered - written_off),
    recovery_rate: potential > 0 ? Math.round((recovered / potential) * 10_000) / 10_000 : 0,
    by_state,
  };
}
