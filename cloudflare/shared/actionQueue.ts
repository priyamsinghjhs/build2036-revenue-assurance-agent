/**
 * Action-queue idempotency. A pending proposal is unique per (exception_id, action): repeated agent
 * runs refresh the existing proposal instead of inserting another one. Pure helpers, unit-tested.
 */
export const PENDING_STATUS = "proposed";
export const SUPERSEDED_STATUS = "superseded";

/** Idempotency key for a pending proposal; null when the proposal is not tied to an exception. */
export function actionKey(row: { exception_id?: unknown; action?: unknown }): string | null {
  const id = row.exception_id == null ? "" : String(row.exception_id).trim();
  if (!id) return null;
  return `${id}|${String(row.action ?? "").trim().toLowerCase()}`;
}

/**
 * Collapse duplicate pending proposals (same exception and action), keeping the most recent.
 * Decided rows (approved/rejected/done) are history and are all kept; superseded rows are dropped.
 */
export function dedupeActions<T extends { exception_id?: unknown; action?: unknown; status?: unknown; created_at?: unknown; rationale?: unknown }>(
  rows: T[],
): T[] {
  const sorted = [...rows].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of sorted) {
    const status = String(r.status ?? "");
    if (status === SUPERSEDED_STATUS) continue;
    if (status === PENDING_STATUS) {
      const key = actionKey(r) ?? `∅|${String(r.action ?? "")}|${String(r.rationale ?? "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

/** Upsert SQL for a pending proposal; relies on the partial unique index from migration 028. */
export const UPSERT_PROPOSED_ACTION_SQL = `INSERT INTO ra_action_queue (action_id, run_id, exception_id, action, amount, currency, confidence, rationale, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
ON CONFLICT (exception_id, action) WHERE status = 'proposed' AND exception_id IS NOT NULL
DO UPDATE SET run_id = EXCLUDED.run_id, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
  confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale
RETURNING action_id, (xmax = 0) AS inserted`;
