/**
 * Recovery lifecycle: transitions, RBAC per state, maker-checker on closure,
 * amount rules, and totals (the same sums the SQL view returns).
 * Usage: npx tsx scripts/test-recovery.ts
 */
import { USERS, type AppUser } from "../shared/roles";
import { allowedNextStates, applyTransition, recoveryTotals, type RecoveryItem } from "../shared/recovery";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const u = (role: string) => USERS.find((x) => x.role === role) as AppUser;
const ops = u("recon_ops"), treasury = u("treasury"), cfo = u("cfo"), auditor = u("auditor"), viewer = u("viewer"), admin = u("admin");

let item: RecoveryItem = { exception_id: "apm:apm_report_mismatch:APM0008", state: "identified", expected_amount: 14135.2, recovered_amount: 0, written_off_amount: 0, owner: null, due_date: null, version: 0, last_actor: null };

// RBAC
assert(!applyTransition(viewer, item, { to: "claimed" }).ok, "viewer cannot claim");
assert(!applyTransition(auditor, item, { to: "claimed" }).ok, "auditor cannot claim");
assert(!applyTransition(cfo, item, { to: "claimed" }).ok, "cfo cannot claim (no action_draft)");
assert(allowedNextStates(viewer, item).length === 0, "viewer has no next states");
assert(!applyTransition(ops, item, { to: "recovered" }).ok, "identified -> recovered is not allowed");
assert(!applyTransition(ops, item, { to: "bogus" }).ok, "unknown state rejected");

// identified -> claimed
let r = applyTransition(ops, item, { to: "claimed", owner: "recon_ops@ra.local", due_date: "2026-12-15" });
assert(r.ok, "ops claims");
if (!r.ok) throw new Error();
item = r.next;
assert(item.version === 1 && item.state === "claimed" && item.due_date === "2026-12-15", "claimed with owner/due");
assert(!applyTransition(ops, item, { to: "claimed", expected_version: 0 }).ok, "stale version rejected");

// partial recovery, then over-recovery guard
r = applyTransition(ops, item, { to: "partially_recovered", amount: 5000 });
assert(r.ok && r.next.recovered_amount === 5000 && r.amount_delta === 5000, "partial 5000");
if (!r.ok) throw new Error();
item = r.next;
assert(!applyTransition(ops, item, { to: "partially_recovered", amount: 9135.2 }).ok, "partial that completes is rejected");
assert(!applyTransition(ops, item, { to: "partially_recovered", amount: 0 }).ok, "zero partial rejected");
assert(!applyTransition(ops, item, { to: "recovered", amount: 100 }).ok, "recovered must complete the total");
assert(!applyTransition(ops, item, { to: "disputed" }).ok, "dispute needs a note");

// recovered (defaults to outstanding)
r = applyTransition(treasury, item, { to: "recovered" });
assert(r.ok && r.next.recovered_amount === 14135.2 && r.amount_delta === 9135.2, "recovered outstanding 9135.20");
if (!r.ok) throw new Error();
item = r.next;

// closure: maker-checker and RBAC
assert(!applyTransition(treasury, item, { to: "closed", note: "done" }).ok, "last actor cannot close");
assert(!applyTransition(ops, item, { to: "closed", note: "done" }).ok, "recon_ops cannot close");
assert(!applyTransition(auditor, item, { to: "closed" }).ok, "close needs a note");
r = applyTransition(auditor, item, { to: "closed", note: "verified bank credit" });
assert(r.ok && r.closed && r.next.state === "closed", "auditor closes");
if (!r.ok) throw new Error();
assert(allowedNextStates(admin, r.next).length === 0, "closed is terminal");

// write-off RBAC and high value
const big: RecoveryItem = { ...item, state: "claimed", expected_amount: 60000, recovered_amount: 0, version: 3, last_actor: ops.id };
assert(!applyTransition(ops, big, { to: "written_off", note: "x" }).ok, "ops cannot write off");
assert(!applyTransition(treasury, big, { to: "written_off", note: "x" }).ok, "treasury cannot write off >= 50,000");
const wo = applyTransition(cfo, big, { to: "written_off", note: "uneconomic" });
assert(wo.ok && wo.next.written_off_amount === 60000, "cfo writes off high value");
const small: RecoveryItem = { ...big, expected_amount: 900 };
assert(applyTransition(treasury, small, { to: "written_off", note: "small" }).ok, "treasury writes off below threshold");

// Totals: potential = sum of book leakage, open = potential - recovered - written off, rate = recovered / potential.
const t = recoveryTotals([
  { state: "closed", potential_amount: 14135.2, expected_amount: 14135.2, recovered_amount: 14135.2, written_off_amount: 0 },
  { state: "written_off", potential_amount: 900, expected_amount: 900, recovered_amount: 0, written_off_amount: 900 },
  { state: "partially_recovered", potential_amount: 1000.1, expected_amount: 1000.1, recovered_amount: 400.05, written_off_amount: 0 },
  { state: "identified", potential_amount: 2500.33, expected_amount: 2500.33, recovered_amount: 0, written_off_amount: 0 },
  { state: "identified", potential_amount: -100, expected_amount: -100, recovered_amount: 0, written_off_amount: 0 },
]);
assert(t.potential === 18435.63, `potential ${t.potential}`);
assert(t.recovered === 14535.25, `recovered ${t.recovered}`);
assert(t.written_off === 900, "written off");
assert(t.open === 3000.38, `open ${t.open}`);
assert(t.recovery_rate === Math.round((14535.25 / 18435.63) * 10000) / 10000, "rate");
assert(t.by_state.identified.n === 2 && t.by_state.identified.expected === 2400.33, "by_state identified");
const stateSum = Object.values(t.by_state).reduce((s, b) => s + b.expected, 0);
assert(Math.abs(stateSum - t.potential) < 0.005, "state buckets sum to potential");

console.log("test-recovery: transitions, RBAC, maker-checker, amounts, totals ok");
