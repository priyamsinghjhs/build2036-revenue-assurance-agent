/**
 * Recovery tracking to closure. Every figure is read from SQL
 * (v_ra_recovery_tracker over ra_exception_rows + ra_recovery_items);
 * transitions are validated by shared/recovery.ts and written in one statement
 * with an optimistic version check and an audit history row.
 */
import type { Context } from "hono";
import { getDb, type AppDb } from "./pg";
import { requireUser } from "./auth";
import { assertRecordVisible, filterRowsByScope, loadAssignedIds } from "./scopeAccess";
import { areaFromExceptionId, roleSeesAllAreas } from "../shared/scope";
import { exceptionIdParts } from "../shared/reviewAmount";
import { normalizeAmount } from "../shared/numbers";
import { BOOK_LEAKAGE_SQL } from "../shared/bookLeakage";
import {
  DEFAULT_SLA_DAYS,
  RECOVERY_STATES,
  allowedNextStates,
  applyTransition,
  isRecoveryState,
  recoveryTotals,
  type RecoveryItem,
  type RecoveryState,
  type TrackerRow,
} from "../shared/recovery";
import { invalidateMem } from "./cache";

type ViewRow = Record<string, unknown>;

/** Explicit columns: dates as text so the driver never shifts them through a JS Date. */
const TRACKER_COLS = `exception_id, area, category, ref_id, merchant_id, ts, potential_amount::float AS potential_amount,
  state, expected_amount::float AS expected_amount, recovered_amount::float AS recovered_amount,
  written_off_amount::float AS written_off_amount, owner, due_date::text AS due_date, sla_days,
  opened_at, updated_at, closed_at, version, overdue`;

function mapRow(r: ViewRow) {
  return {
    exception_id: String(r.exception_id),
    area: String(r.area),
    category: String(r.category),
    ref_id: String(r.ref_id),
    merchant_id: r.merchant_id == null ? null : String(r.merchant_id),
    ts: r.ts == null ? null : String(r.ts),
    state: String(r.state) as RecoveryState,
    potential_amount: normalizeAmount(r.potential_amount),
    expected_amount: normalizeAmount(r.expected_amount),
    recovered_amount: normalizeAmount(r.recovered_amount),
    written_off_amount: normalizeAmount(r.written_off_amount),
    outstanding: normalizeAmount(Number(r.expected_amount) - Number(r.recovered_amount) - Number(r.written_off_amount)),
    owner: r.owner == null ? null : String(r.owner),
    due_date: r.due_date == null ? null : String(r.due_date).slice(0, 10),
    sla_days: r.sla_days == null ? null : Number(r.sla_days),
    opened_at: r.opened_at ?? null,
    updated_at: r.updated_at ?? null,
    closed_at: r.closed_at ?? null,
    version: Number(r.version ?? 0),
    overdue: r.overdue === true || r.overdue === "t",
  };
}

/** Book-level totals straight from SQL. potential equals the executive book leakage. */
export async function recoverySqlTotals(db: AppDb) {
  const [tot, states, book] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*)::int AS n,
                COALESCE(ROUND(SUM(potential_amount), 2), 0)::float AS potential,
                COALESCE(ROUND(SUM(recovered_amount), 2), 0)::float AS recovered,
                COALESCE(ROUND(SUM(written_off_amount), 2), 0)::float AS written_off,
                COUNT(*) FILTER (WHERE overdue)::int AS overdue,
                COUNT(*) FILTER (WHERE state <> 'identified')::int AS tracked,
                COUNT(*) FILTER (WHERE state = 'closed')::int AS closed
         FROM v_ra_recovery_tracker`,
      )
      .first<Record<string, number>>(),
    db
      .prepare(
        `SELECT state, COUNT(*)::int AS n,
                COALESCE(ROUND(SUM(expected_amount), 2), 0)::float AS expected,
                COALESCE(ROUND(SUM(recovered_amount), 2), 0)::float AS recovered
         FROM v_ra_recovery_tracker GROUP BY state`,
      )
      .all<{ state: string; n: number; expected: number; recovered: number }>(),
    db
      .prepare(`SELECT COALESCE(ROUND(SUM(leakage)::numeric, 2), 0)::float AS leakage FROM ra_exception_rows WHERE ${BOOK_LEAKAGE_SQL}`)
      .first<{ leakage: number }>(),
  ]);
  const potential = normalizeAmount(tot?.potential);
  const recovered = normalizeAmount(tot?.recovered);
  const written_off = normalizeAmount(tot?.written_off);
  const by_state: Record<string, { n: number; expected: number; recovered: number }> = {};
  for (const s of RECOVERY_STATES) by_state[s] = { n: 0, expected: 0, recovered: 0 };
  for (const r of states.results ?? []) {
    by_state[r.state] = { n: Number(r.n), expected: normalizeAmount(r.expected), recovered: normalizeAmount(r.recovered) };
  }
  return {
    n: Number(tot?.n ?? 0),
    tracked: Number(tot?.tracked ?? 0),
    closed: Number(tot?.closed ?? 0),
    overdue: Number(tot?.overdue ?? 0),
    potential,
    recovered,
    written_off,
    open: normalizeAmount(potential - recovered - written_off),
    recovery_rate: potential > 0 ? Math.round((recovered / potential) * 10_000) / 10_000 : 0,
    by_state,
    check: {
      book_leakage: normalizeAmount(book?.leakage),
      potential_equals_book_leakage: Math.abs(normalizeAmount(book?.leakage) - potential) <= 0.009,
    },
    source: "sql:v_ra_recovery_tracker",
  };
}

export async function recoverySummary(c: Context) {
  requireUser(c);
  return c.json(await recoverySqlTotals(getDb(c.env)));
}

export async function recoveryList(c: Context) {
  const user = requireUser(c);
  const db = getDb(c.env);
  const state = c.req.query("state") || "";
  const area = c.req.query("area") || "";
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") || 50)));
  const offset = Math.max(0, Number(c.req.query("offset") || 0));
  const [{ results }, sql] = await Promise.all([
    db.prepare(`SELECT ${TRACKER_COLS} FROM v_ra_recovery_tracker ORDER BY potential_amount DESC, exception_id`).all<ViewRow>(),
    recoverySqlTotals(db),
  ]);
  const all = (results ?? []).map(mapRow);
  const assigned = roleSeesAllAreas(user.role) ? undefined : await loadAssignedIds(db, user.id, ["exception", "review"]);
  const visible = filterRowsByScope(user, all, (r) => r.area, assigned, (r) => r.exception_id);
  const scoped = visible.length !== all.length;
  const totals = scoped ? { ...recoveryTotals(visible as TrackerRow[]), scoped: true } : { ...sql, scoped: false };
  const filtered = visible.filter((r) => (!state || r.state === state) && (!area || r.area === area));
  return c.json({
    totals,
    rows: filtered.slice(offset, offset + limit),
    page: { offset, limit, total: filtered.length },
  });
}

async function loadItem(db: AppDb, exceptionId: string) {
  const parts = exceptionIdParts(exceptionId);
  if (!parts) return null;
  const row = await db
    .prepare(`SELECT ${TRACKER_COLS} FROM v_ra_recovery_tracker WHERE area = ? AND category = ? AND ref_id = ? LIMIT 1`)
    .bind(parts.area, parts.category, parts.ref_id)
    .first<ViewRow>();
  if (!row) return null;
  const last = await db
    .prepare("SELECT last_actor FROM ra_recovery_items WHERE exception_id = ?")
    .bind(exceptionId)
    .first<{ last_actor: string | null }>();
  return { row: mapRow(row), last_actor: last?.last_actor ?? null };
}

export async function recoveryItem(c: Context) {
  const user = requireUser(c);
  const db = getDb(c.env);
  const id = c.req.param("id") ?? "";
  await assertRecordVisible(db, user, { type: "exception", id, area: areaFromExceptionId(id) });
  const found = await loadItem(db, id);
  if (!found) return c.json({ error: "Not a book exception, so it has no recovery item." }, 404);
  const { results } = await db
    .prepare(
      `SELECT id, from_state, to_state, amount_delta::float AS amount_delta, recovered_total::float AS recovered_total,
              owner, due_date::text AS due_date, actor, role, note, at
       FROM ra_recovery_history WHERE exception_id = ? ORDER BY at DESC, id DESC LIMIT 100`,
    )
    .bind(id)
    .all<Record<string, unknown>>();
  const item: RecoveryItem = { ...found.row, last_actor: found.last_actor };
  return c.json({
    item: { ...found.row, last_actor: found.last_actor },
    history: results ?? [],
    allowed_next: allowedNextStates(user, item),
  });
}

export async function recoveryTransition(c: Context) {
  const user = requireUser(c);
  const db = getDb(c.env);
  const id = c.req.param("id") ?? "";
  await assertRecordVisible(db, user, { type: "exception", id, area: areaFromExceptionId(id) });
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const found = await loadItem(db, id);
  if (!found) return c.json({ error: "Not a book exception, so it has no recovery item." }, 404);
  const item: RecoveryItem = { ...found.row, last_actor: found.last_actor };
  const to = String(body.to || "");
  if (!isRecoveryState(to)) return c.json({ error: `Unknown state "${to}".` }, 400);
  const res = applyTransition(user, item, {
    to,
    amount: body.amount == null || body.amount === "" ? null : Number(body.amount),
    owner: body.owner == null ? null : String(body.owner),
    due_date: body.due_date == null ? null : String(body.due_date),
    note: body.note == null ? null : String(body.note),
    expected_version: body.expected_version == null ? item.version : Number(body.expected_version),
  });
  if (!res.ok) return c.json({ error: res.error }, res.status);
  const n = res.next;
  const parts = exceptionIdParts(id)!;
  const note = String(body.note ?? "").slice(0, 1000) || null;
  // One statement: upsert with optimistic version check, history row, and the legacy recovery event.
  const row = await db
    .prepare(
      `WITH up AS (
         INSERT INTO ra_recovery_items AS r (exception_id, area, category, state, expected_amount, recovered_amount,
           written_off_amount, owner, due_date, sla_days, last_actor, version, closed_at, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?::date, CURRENT_DATE + ?::int), ?, ?, 1,
                 CASE WHEN ?::boolean THEN now() END, now(), now())
         ON CONFLICT (exception_id) DO UPDATE SET
           state = EXCLUDED.state,
           recovered_amount = EXCLUDED.recovered_amount,
           written_off_amount = EXCLUDED.written_off_amount,
           owner = EXCLUDED.owner,
           due_date = COALESCE(?::date, r.due_date),
           last_actor = EXCLUDED.last_actor,
           version = r.version + 1,
           closed_at = EXCLUDED.closed_at,
           updated_at = now()
         WHERE r.version = ?::int
         RETURNING r.exception_id, r.state, r.version, r.recovered_amount, r.owner, r.due_date
       ), hist AS (
         INSERT INTO ra_recovery_history (exception_id, from_state, to_state, amount_delta, recovered_total, owner, due_date, actor, role, note)
         SELECT exception_id, ?::text, state, ?::numeric, recovered_amount, owner, due_date, ?::text, ?::text, ?::text FROM up
         RETURNING id
       ), ev AS (
         INSERT INTO ra_recovery_events (exception_id, amount, recovered_by, method, note)
         SELECT exception_id, ?::numeric, ?::text, state, ?::text FROM up WHERE ?::numeric > 0
         RETURNING id
       )
       SELECT up.*, (SELECT COUNT(*) FROM hist)::int AS hist FROM up`,
    )
    .bind(
      id, parts.area, parts.category, n.state, item.expected_amount, n.recovered_amount, n.written_off_amount, n.owner,
      n.due_date, DEFAULT_SLA_DAYS, DEFAULT_SLA_DAYS, user.id, res.closed,
      n.due_date, item.version,
      item.state, res.amount_delta, user.id, user.role, note,
      res.amount_delta, user.id, note, res.amount_delta,
    )
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Item changed while you were editing; reload and retry." }, 409);
  invalidateMem("executive");
  return c.json({ ok: true, exception_id: id, from: item.state, to: n.state, amount_delta: res.amount_delta, version: Number(row.version) });
}
