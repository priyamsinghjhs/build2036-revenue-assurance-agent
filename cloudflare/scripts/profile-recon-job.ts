/**
 * Profile a background recon job against a TEST branch: wall time per chunk, Neon round-trips
 * (subrequests) per chunk, and steps per chunk. Workers AI is stubbed (fails fast), so narrative
 * steps take the deterministic path; numbers measure orchestration overhead, not model latency.
 * Usage: REGRESSION_DATABASE_URL_FILE=<test url file> npx tsx scripts/profile-recon-job.ts [all|deterministic]
 */
import { readFileSync } from "node:fs";
import { RUN_ALL_SEQUENCE } from "../worker/agentRoster";
import { processJobChunk } from "../worker/reconJobs";
import { jobSequence } from "../shared/reconJobs";
import { getDb } from "../worker/pg";
import { startRun } from "../worker/agentRunner";

const file = process.env.REGRESSION_DATABASE_URL_FILE;
if (!file || /neon_database_url$/.test(file)) throw new Error("Point REGRESSION_DATABASE_URL_FILE at a TEST branch");
const mode = process.argv[2] === "all" ? "default" : "deterministic";
let fetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
  fetches++;
  return realFetch(...a);
}) as typeof fetch;
const env = {
  DATABASE_URL: readFileSync(file, "utf8").trim(),
  AI: { run: async () => { throw new Error("AI stubbed in profiler"); } },
} as never;
const db = getDb(env);
const seq = jobSequence(RUN_ALL_SEQUENCE, mode === "default");
const run = await startRun(db, "all");
const jobId = crypto.randomUUID();
await db
  .prepare(
    `WITH j AS (INSERT INTO ra_recon_jobs (job_id, scope, mode, status, run_id, total_steps, requested_by)
       VALUES (?, 'all', ?, 'queued', ?, ?::int, 'profiler') RETURNING job_id)
     INSERT INTO ra_recon_job_steps (job_id, seq, agent_id, status)
     SELECT j.job_id, t.ord::int, t.agent, 'pending' FROM j, jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS t(agent, ord)`,
  )
  .bind(jobId, mode, run.run_id, seq.length, JSON.stringify(seq))
  .run();
const t0 = Date.now();
const chunks: { ms: number; cpu_ms: number; fetches: number; processed: number; status: string }[] = [];
for (let i = 0; i < 40; i++) {
  const f0 = fetches;
  const c0 = Date.now();
  const cpu0 = process.cpuUsage();
  const { clearAgentSummaryCache } = await import("../worker/recon");
  clearAgentSummaryCache(); // each chunk may land on a cold isolate in production
  const r = await processJobChunk(env, jobId);
  const cpu = process.cpuUsage(cpu0);
  chunks.push({ ms: Date.now() - c0, cpu_ms: Math.round((cpu.user + cpu.system) / 1000), fetches: fetches - f0, processed: r.processed, status: r.status });
  if (r.status === "succeeded" || r.status === "failed" || r.status === "error") break;
}
const total = Date.now() - t0;
const out = { mode, steps: seq.length, chunks: chunks.length, total_ms: total, max_fetches_per_invocation: Math.max(...chunks.map((c) => c.fetches)), chunk_detail: chunks };
console.log(JSON.stringify(out));
