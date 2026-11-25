/**
 * Action-queue dedupe. Unit part always runs; DB part runs against a TEST branch when
 * REGRESSION_DATABASE_URL_FILE is set (refuses the prod URL file).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionKey, dedupeActions, UPSERT_PROPOSED_ACTION_SQL } from "../shared/actionQueue";

// Unit: five identical pending ESCALATE proposals collapse to one (most recent kept).
const ex = "scheme:missing_scheme_settlement:CAP00216";
const rows = [1, 2, 3, 4, 5].map((i) => ({
  action_id: `a${i}`, exception_id: ex, action: "escalate", status: "proposed", created_at: `2026-11-25T1${i}:00:00Z`, rationale: "x",
}));
rows.push({ action_id: "r1", exception_id: ex, action: "recover", status: "proposed", created_at: "2026-11-25T10:00:00Z", rationale: "y" });
rows.push({ action_id: "d1", exception_id: ex, action: "escalate", status: "approved", created_at: "2026-11-20T10:00:00Z", rationale: "z" });
rows.push({ action_id: "d2", exception_id: ex, action: "escalate", status: "approved", created_at: "2026-11-21T10:00:00Z", rationale: "z" });
rows.push({ action_id: "s1", exception_id: ex, action: "escalate", status: "superseded", created_at: "2026-11-26T10:00:00Z", rationale: "x" });
const d = dedupeActions(rows);
assert.deepEqual(d.filter((r) => r.status === "proposed" && r.action === "escalate").map((r) => r.action_id), ["a5"]);
assert.equal(d.filter((r) => r.action === "recover").length, 1, "different action type is a different key");
assert.equal(d.filter((r) => r.status === "approved").length, 2, "decided history is kept");
assert.ok(!d.some((r) => r.status === "superseded"), "superseded rows hidden");
assert.equal(actionKey({ exception_id: ex, action: "ESCALATE" }), `${ex}|escalate`);
assert.equal(actionKey({ exception_id: null, action: "escalate" }), null);
assert.match(UPSERT_PROPOSED_ACTION_SQL, /ON CONFLICT \(exception_id, action\) WHERE status = 'proposed'/);

const file = process.env.REGRESSION_DATABASE_URL_FILE;
if (file) {
  if (/neon_database_url$/.test(file)) throw new Error("Point REGRESSION_DATABASE_URL_FILE at a TEST branch");
  const { getDb } = await import("../worker/pg");
  const db = getDb({ DATABASE_URL: readFileSync(file, "utf8").trim() } as never);
  const testEx = `test:dedupe:${Date.now()}`;
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await db
      .prepare(UPSERT_PROPOSED_ACTION_SQL)
      .bind(crypto.randomUUID(), `run-${i}`, testEx, "escalate", 14825, "INR", 40, `run ${i}`, new Date().toISOString())
      .first<{ action_id: string; inserted: boolean }>();
    ids.push(String(r?.action_id));
    assert.equal(Boolean(r?.inserted), i === 0, "only the first run inserts");
  }
  assert.equal(new Set(ids).size, 1, "all runs return the same action_id");
  const row = await db
    .prepare("SELECT COUNT(*)::int AS n, MAX(run_id) AS run_id, MAX(rationale) AS rationale FROM ra_action_queue WHERE exception_id = ? AND status = 'proposed'")
    .bind(testEx)
    .first<{ n: number; run_id: string; rationale: string }>();
  assert.equal(row?.n, 1);
  assert.equal(row?.run_id, "run-4", "latest run refreshes the proposal");
  // Once decided, a new proposal for the same key is allowed (pending-only uniqueness).
  await db.prepare("UPDATE ra_action_queue SET status = 'approved' WHERE exception_id = ?").bind(testEx).run();
  const again = await db
    .prepare(UPSERT_PROPOSED_ACTION_SQL)
    .bind(crypto.randomUUID(), "run-5", testEx, "escalate", 1, "INR", 40, "new", new Date().toISOString())
    .first<{ inserted: boolean }>();
  assert.equal(Boolean(again?.inserted), true);
  const dupes = await db
    .prepare("SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM ra_action_queue WHERE status='proposed' AND exception_id IS NOT NULL GROUP BY exception_id, action HAVING COUNT(*) > 1) d")
    .first<{ n: number }>();
  assert.equal(dupes?.n, 0, "no duplicate pending keys remain");
  // Clean up only the rows this test created (test branch).
  await db.prepare("DELETE FROM ra_action_queue WHERE exception_id = ?").bind(testEx).run();
  console.log("test-action-dedupe: unit + test-branch upsert ok");
} else {
  console.log("test-action-dedupe: unit ok");
}
