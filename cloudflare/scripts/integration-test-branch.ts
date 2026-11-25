/**
 * Integration run of the new endpoints' SQL against a Neon TEST branch (never prod):
 * rule propose -> maker-checker -> approve/reject, recovery transitions to closure,
 * and a background recon job to completion. Uses the real handlers in a mini Hono app.
 * Usage: REGRESSION_DATABASE_URL_FILE=<test branch url file> npx tsx scripts/integration-test-branch.ts
 */
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { USERS } from "../shared/roles";
import { decideRules, getRuleHistory, getRules, proposeRules } from "../worker/reconConfig";
import { recoveryItem, recoveryList, recoverySummary, recoveryTransition } from "../worker/recovery";
import { createReconJob, getReconJob } from "../worker/reconJobs";
import { DEFAULT_RECON_CONFIG } from "../shared/reconConfig";

const file = process.env.REGRESSION_DATABASE_URL_FILE;
if (!file || /neon_database_url$/.test(file)) throw new Error("Point REGRESSION_DATABASE_URL_FILE at a TEST branch");
const env = { DATABASE_URL: readFileSync(file, "utf8").trim() } as Record<string, unknown>;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };

const app = new Hono<{ Bindings: typeof env; Variables: { user?: unknown } }>();
app.use("*", async (c, next) => {
  const id = c.req.header("x-user") || "admin@ra.local";
  c.set("user", USERS.find((u) => u.id === id));
  await next();
});
app.onError((err, c) => c.json({ error: err.message }, (err instanceof HTTPException ? err.status : (err as { status?: number }).status ?? 500) as 500));
app.get("/rules", (c) => getRules(c as never));
app.get("/rules/history", (c) => getRuleHistory(c as never));
app.post("/rules/proposals", (c) => proposeRules(c as never));
app.post("/rules/proposals/:version/decision", (c) => decideRules(c as never));
app.get("/recovery", (c) => recoveryList(c as never));
app.get("/recovery/summary", (c) => recoverySummary(c as never));
app.get("/recovery/items/:id", (c) => recoveryItem(c as never));
app.post("/recovery/items/:id/transition", (c) => recoveryTransition(c as never));
app.post("/jobs", (c) => createReconJob(c as never));
app.get("/jobs/:id", (c) => getReconJob(c as never));

async function call(method: string, path: string, user: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, { method, headers: { "content-type": "application/json", "x-user": user, ...headers }, body: body ? JSON.stringify(body) : undefined }, env, ctx as never);
  const json = (await res.json()) as Record<string, any>;
  return { status: res.status, json };
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const out: Record<string, unknown> = {};

// ---- Rules: maker-checker
const r0 = await call("GET", "/rules", "viewer@ra.local");
assert(r0.status === 200 && r0.json.active.version >= 1, "rules readable");
const base = r0.json.active.version as number;
const cfg = JSON.parse(JSON.stringify(r0.json.active.config));
cfg.areas.apm.amount_tolerance = 25;
assert((await call("POST", "/rules/proposals", "cfo@ra.local", { config: cfg, note: "x", base_version: base })).status === 403, "cfo cannot propose");
assert((await call("POST", "/rules/proposals", "admin@ra.local", { config: { ...cfg, areas: { ...cfg.areas, apm: { ...cfg.areas.apm, amount_tolerance: -5 } } }, note: "x", base_version: base })).status === 400, "invalid rejected");
const p1 = await call("POST", "/rules/proposals", "admin@ra.local", { config: cfg, note: "integration: apm tolerance 25", base_version: base });
assert(p1.status === 201, `propose ${JSON.stringify(p1.json)}`);
assert((await call("POST", `/rules/proposals/${p1.json.version}/decision`, "admin@ra.local", { decision: "approve" })).status === 403, "maker cannot approve");
const a1 = await call("POST", `/rules/proposals/${p1.json.version}/decision`, "cfo@ra.local", { decision: "approve", note: "ok" });
assert(a1.status === 200 && a1.json.status === "active", `approve ${JSON.stringify(a1.json)}`);
const r1 = await call("GET", "/rules", "viewer@ra.local");
assert(r1.json.active.version === p1.json.version && r1.json.active.config.areas.apm.amount_tolerance === 25, "new version active");
// Revert to defaults through the same workflow so the branch ends where it started.
const p2 = await call("POST", "/rules/proposals", "admin@ra.local", { config: DEFAULT_RECON_CONFIG, note: "integration: revert to defaults", base_version: p1.json.version });
const a2 = await call("POST", `/rules/proposals/${p2.json.version}/decision`, "auditor@ra.local", { decision: "approve", note: "revert" });
assert(a2.status === 200, "revert approved");
const p3 = await call("POST", "/rules/proposals", "admin@ra.local", { config: cfg, note: "integration: to be rejected", base_version: p2.json.version });
const rj = await call("POST", `/rules/proposals/${p3.json.version}/decision`, "auditor@ra.local", { decision: "reject", note: "no" });
assert(rj.status === 200 && rj.json.status === "rejected", "reject");
const hist = await call("GET", "/rules/history", "viewer@ra.local");
const actions = (hist.json.history as { version: number; action: string; actor: string }[]).filter((h) => h.version >= p1.json.version).map((h) => `${h.version}:${h.action}:${h.actor}`);
assert(actions.length === 6, `audit rows: ${actions}`);
out.rules = { from_version: base, proposed_approved: p1.json.version, reverted: p2.json.version, rejected: p3.json.version, audit: actions };

// ---- Recovery: totals equal book leakage, then a full lifecycle on one item
const s0 = await call("GET", "/recovery/summary", "viewer@ra.local");
assert(s0.json.check.potential_equals_book_leakage === true, `potential ${s0.json.potential} vs book ${s0.json.check.book_leakage}`);
const list = await call("GET", "/recovery?limit=5", "admin@ra.local");
assert(list.json.totals.potential === s0.json.potential && list.json.page.total === s0.json.n, "list totals = summary");
const ops = await call("GET", "/recovery?limit=500", "recon_ops@ra.local");
// The lifecycle needs an item both recon_ops (claim) and treasury (record recoveries) can see.
const tre = await call("GET", "/recovery?limit=500", "treasury@ra.local");
const treIds = new Set((tre.json.rows as { exception_id: string }[]).map((r) => r.exception_id));
const cand = (ops.json.rows as { exception_id: string; state: string; expected_amount: number }[]).find(
  (r) => r.state === "identified" && r.expected_amount > 100 && r.expected_amount < 50000 && treIds.has(r.exception_id),
);
assert(cand, "an identified item in recon_ops and treasury scope");
const id = cand!.exception_id;
const it0 = await call("GET", `/recovery/items/${encodeURIComponent(id)}`, "recon_ops@ra.local");
assert(it0.status === 200, `item ${JSON.stringify(it0.json)}`);
const expected = it0.json.item.expected_amount as number;
const startState = it0.json.item.state as string;
let v = it0.json.item.version as number;
const steps: string[] = [];
async function tr(user: string, body: Record<string, unknown>, want = 200) {
  const r = await call("POST", `/recovery/items/${encodeURIComponent(id)}/transition`, user, { expected_version: v, ...body });
  assert(r.status === want, `${user} -> ${body.to}: ${r.status} ${JSON.stringify(r.json)}`);
  if (r.status === 200) { v = r.json.version; steps.push(`${r.json.from}->${r.json.to}`); }
  return r;
}
if (startState === "identified") {
  await tr("auditor@ra.local", { to: "claimed" }, 403);
  await tr("recon_ops@ra.local", { to: "claimed", owner: "recon_ops@ra.local", due_date: "2026-12-31" });
  await tr("recon_ops@ra.local", { to: "disputed", note: "stale", expected_version: v - 1 }, 409); // optimistic version check
  const part = Math.round(expected * 40) / 100;
  await tr("treasury@ra.local", { to: "partially_recovered", amount: part, note: "bank credit 1" });
  await tr("treasury@ra.local", { to: "recovered", note: "final bank credit" });
  await tr("treasury@ra.local", { to: "closed", note: "self-close" }, 403);
  await tr("auditor@ra.local", { to: "closed", note: "verified against bank statement" });
}
const it1 = await call("GET", `/recovery/items/${encodeURIComponent(id)}`, "auditor@ra.local");
assert(it1.json.item.state === "closed" && Math.abs(it1.json.item.recovered_amount - expected) < 0.005, "closed fully recovered");
const s1 = await call("GET", "/recovery/summary", "viewer@ra.local");
assert(Math.abs(s1.json.recovered - (s0.json.recovered + (startState === "identified" ? expected : 0))) < 0.01, "summary recovered moved by expected");
assert(s1.json.potential === s0.json.potential, "potential unchanged");
assert(Math.abs(s1.json.open - (s1.json.potential - s1.json.recovered - s1.json.written_off)) < 0.01, "open identity");
out.recovery = {
  item: id, expected, steps, history_rows: it1.json.history.length,
  before: { potential: s0.json.potential, recovered: s0.json.recovered, rate: s0.json.recovery_rate },
  after: { potential: s1.json.potential, recovered: s1.json.recovered, rate: s1.json.recovery_rate, closed: s1.json.closed },
  recon_ops_scoped_rows: ops.json.page.total, recon_ops_scoped: ops.json.totals.scoped,
};

// ---- Background job (deterministic, no Workers AI) to completion, idempotency
const key = `it-${Date.now()}`;
const t0 = Date.now();
const j = await call("POST", "/jobs", "recon_ops@ra.local", { scope: "all", include_narrative: false }, { "idempotency-key": key });
assert(j.status === 202 && j.json.job_id, `job ${j.status} ${JSON.stringify(j.json)}`);
const again = await call("POST", "/jobs", "recon_ops@ra.local", { scope: "all", include_narrative: false }, { "idempotency-key": key });
assert(again.status === 200 && again.json.job_id === j.json.job_id && again.json.reused, "idempotent create");
let st = j.json;
let polls = 0;
while (polls < 40) {
  await Promise.all(pending.splice(0));
  const g = await call("GET", `/jobs/${j.json.job_id}?outputs=1`, "viewer@ra.local");
  st = g.json;
  polls += 1;
  if (st.status === "succeeded" || st.status === "failed") break;
}
await Promise.all(pending.splice(0));
assert(st.status === "succeeded", `job status ${st.status} ${JSON.stringify(st.steps?.filter((s: any) => s.status !== "done"))}`);
assert(st.outputs.length === st.progress.total, "every step has an output");
const grounded = st.outputs.filter((o: any) => o.output?.verification === "grounded").length;
out.job = { job_id: j.json.job_id, steps: st.progress.total, chunks: st.chunks, polls, ms: Date.now() - t0, grounded, rule_version: st.rule_version, create_status: j.status };
console.log(JSON.stringify(out, null, 2));
