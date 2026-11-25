/**
 * Background recon jobs: POST creates a job row and returns 202; processing
 * runs in ctx.waitUntil one chunk per invocation, advanced by status polls and
 * swept by the cron trigger. Steps are idempotent (a done step never re-runs)
 * and a lease stops two invocations processing the same job.
 */
import type { Context } from "hono";
import { getDb, type AppDb } from "./pg";
import { requireUser } from "./auth";
import type { Env } from "./types";
import { AGENT_ROSTER, RUN_ALL_SEQUENCE, sequenceForDomain, type AgentId } from "./agentRoster";
import { completeRun, runAgentStep, startRun } from "./agentRunner";
import { activeReconConfig } from "./reconConfig";
import {
  LEASE_SECONDS,
  MAX_STEP_ATTEMPTS,
  jobFinalStatus,
  jobSequence,
  nextChunk,
  progress,
  type JobStep,
} from "../shared/reconJobs";

type JobRow = {
  job_id: string;
  scope: string;
  domain: string | null;
  mode: string;
  status: string;
  run_id: string | null;
  total_steps: number;
  done_steps: number;
  failed_steps: number;
  lease_until: string | null;
  chunks: number;
  requested_by: string;
  rule_version: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

async function loadSteps(db: AppDb, jobId: string): Promise<(JobStep & { output_id: string | null; ms: number | null; error: string | null })[]> {
  const { results } = await db
    .prepare("SELECT seq, agent_id, status, attempts, output_id, ms, error FROM ra_recon_job_steps WHERE job_id = ? ORDER BY seq")
    .bind(jobId)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({
    seq: Number(r.seq),
    agent_id: String(r.agent_id),
    status: String(r.status) as JobStep["status"],
    attempts: Number(r.attempts ?? 0),
    output_id: r.output_id == null ? null : String(r.output_id),
    ms: r.ms == null ? null : Number(r.ms),
    error: r.error == null ? null : String(r.error),
  }));
}

/** Process one chunk of a job if its lease is free. Safe to call from anywhere, any number of times. */
export async function processJobChunk(env: Env, jobId: string): Promise<{ processed: number; status: string }> {
  const db = getDb(env);
  const job = await db
    .prepare(
      `UPDATE ra_recon_jobs
       SET status = 'running', started_at = COALESCE(started_at, now()),
           lease_until = now() + (?::int * interval '1 second'), chunks = chunks + 1
       WHERE job_id = ? AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until < now())
       RETURNING *`,
    )
    .bind(LEASE_SECONDS, jobId)
    .first<JobRow>();
  if (!job) return { processed: 0, status: "leased_or_finished" };
  try {
    // We hold the lease, so any 'running' step belongs to a dead invocation: retry it, or fail it after MAX attempts.
    await db
      .prepare(
        `UPDATE ra_recon_job_steps
         SET status = CASE WHEN attempts >= ?::int THEN 'failed' ELSE 'pending' END,
             error = CASE WHEN attempts >= ?::int THEN 'gave up after repeated interruptions' ELSE error END
         WHERE job_id = ? AND status = 'running'`,
      )
      .bind(MAX_STEP_ATTEMPTS, MAX_STEP_ATTEMPTS, jobId)
      .run();
    const steps = await loadSteps(db, jobId);
    const chunk = nextChunk(steps);
    if (chunk.length) {
      const seqs = chunk.map((s) => s.seq);
      await db
        .prepare(
          `UPDATE ra_recon_job_steps SET status = 'running', attempts = attempts + 1, started_at = now()
           WHERE job_id = ? AND status = 'pending' AND seq IN (SELECT (jsonb_array_elements_text(?::jsonb))::int)`,
        )
        .bind(jobId, JSON.stringify(seqs))
        .run();
      await Promise.all(
        chunk.map(async (s) => {
          const t0 = Date.now();
          try {
            const out = await runAgentStep(env, {
              runId: String(job.run_id),
              agentId: s.agent_id as AgentId,
              scope: job.scope,
              domain: job.domain || undefined,
              mode: job.mode === "deterministic" ? "deterministic" : undefined,
            });
            await db
              .prepare(
                `UPDATE ra_recon_job_steps SET status = 'done', output_id = ?, ms = ?::int, ended_at = now(), error = NULL
                 WHERE job_id = ? AND seq = ?::int AND status = 'running'`,
              )
              .bind(String((out as { output_id?: string }).output_id ?? ""), Date.now() - t0, jobId, s.seq)
              .run();
          } catch (err) {
            const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
            const final = s.attempts + 1 >= MAX_STEP_ATTEMPTS;
            await db
              .prepare(
                `UPDATE ra_recon_job_steps SET status = ?, error = ?, ms = ?::int, ended_at = now()
                 WHERE job_id = ? AND seq = ?::int AND status = 'running'`,
              )
              .bind(final ? "failed" : "pending", msg, Date.now() - t0, jobId, s.seq)
              .run();
          }
        }),
      );
    }
    const after = await loadSteps(db, jobId);
    const p = progress(after);
    const final = jobFinalStatus(after);
    if (final !== "running") {
      if (job.run_id) await completeRun(db, job.run_id).catch(() => undefined);
      const { clearAgentSummaryCache } = await import("./recon");
      clearAgentSummaryCache();
    }
    await db
      .prepare(
        `UPDATE ra_recon_jobs SET done_steps = ?::int, failed_steps = ?::int, status = ?,
           finished_at = CASE WHEN ? = 'running' THEN NULL ELSE now() END,
           lease_until = now()
         WHERE job_id = ?`,
      )
      .bind(p.done, p.failed, final, final, jobId)
      .run();
    return { processed: chunk.length, status: final };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await db
      .prepare("UPDATE ra_recon_jobs SET error = ?, lease_until = now() WHERE job_id = ?")
      .bind(msg, jobId)
      .run()
      .catch(() => undefined);
    return { processed: 0, status: "error" };
  }
}

/** Cron sweep: advance any job left behind (e.g. the browser tab closed). Bounded so the cron stays small. */
export async function sweepReconJobs(env: Env, maxChunks = 6): Promise<number> {
  const db = getDb(env);
  let ran = 0;
  try {
    for (let i = 0; i < maxChunks; i++) {
      const row = await db
        .prepare(
          `SELECT job_id FROM ra_recon_jobs
           WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until < now())
             AND created_at > now() - interval '2 days'
           ORDER BY created_at LIMIT 1`,
        )
        .first<{ job_id: string }>();
      if (!row) break;
      const r = await processJobChunk(env, row.job_id);
      if (!r.processed && r.status !== "succeeded" && r.status !== "failed") break;
      ran += 1;
    }
  } catch {
    /* table missing before migration 026 */
  }
  return ran;
}

function jobView(job: JobRow, steps: Awaited<ReturnType<typeof loadSteps>>) {
  const p = progress(steps);
  return {
    job_id: job.job_id,
    status: job.status,
    scope: job.scope,
    domain: job.domain,
    mode: job.mode,
    run_id: job.run_id,
    rule_version: job.rule_version,
    requested_by: job.requested_by,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    chunks: Number(job.chunks),
    error: job.error,
    progress: p,
    steps: steps.map((s) => ({ seq: s.seq, agent_id: s.agent_id, status: s.status, attempts: s.attempts, ms: s.ms, output_id: s.output_id, error: s.error })),
  };
}

export async function createReconJob(c: Context) {
  const user = requireUser(c);
  const env = c.env as Env;
  const db = getDb(env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = typeof body.scope === "string" && body.scope ? body.scope : "all";
  const domain = scope === "all" ? null : String(body.domain || scope);
  if (domain && !AGENT_ROSTER.some((a) => a.kind === "reconciliation" && a.domain === domain)) {
    return c.json({ error: `Unknown recon domain "${domain}".` }, 400);
  }
  const includeNarrative = body.include_narrative !== false;
  const mode = body.mode === "deterministic" || !includeNarrative ? "deterministic" : "default";
  const idem = String(c.req.header("idempotency-key") || body.idempotency_key || "").slice(0, 120) || null;

  if (idem) {
    const existing = await db.prepare("SELECT * FROM ra_recon_jobs WHERE idempotency_key = ?").bind(idem).first<JobRow>();
    if (existing) return c.json({ ...jobView(existing, await loadSteps(db, existing.job_id)), reused: true }, 200);
  }
  const open = await db
    .prepare(
      `SELECT * FROM ra_recon_jobs WHERE status IN ('queued','running') AND scope = ? AND COALESCE(domain,'') = ?
         AND mode = ? AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(scope, domain ?? "", mode)
    .first<JobRow>();
  if (open) return c.json({ ...jobView(open, await loadSteps(db, open.job_id)), reused: true }, 200);

  const sequence = jobSequence(scope === "all" ? RUN_ALL_SEQUENCE : sequenceForDomain(domain!), includeNarrative);
  const rules = await activeReconConfig(db);
  const run = await startRun(db, scope);
  const jobId = crypto.randomUUID();
  const created = await db
    .prepare(
      `WITH j AS (
         INSERT INTO ra_recon_jobs (job_id, idempotency_key, scope, domain, mode, status, run_id, total_steps, requested_by, rule_version)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?::int, ?, ?::int)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING job_id
       ), s AS (
         INSERT INTO ra_recon_job_steps (job_id, seq, agent_id, status)
         SELECT j.job_id, t.ord::int, t.agent, 'pending'
         FROM j, jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS t(agent, ord)
         RETURNING seq
       )
       SELECT (SELECT job_id FROM j) AS job_id, (SELECT COUNT(*) FROM s)::int AS steps`,
    )
    .bind(jobId, idem, scope, domain, mode, run.run_id, sequence.length, user.id, rules.version, JSON.stringify(sequence))
    .first<{ job_id: string | null; steps: number }>();
  if (!created?.job_id) {
    const existing = await db.prepare("SELECT * FROM ra_recon_jobs WHERE idempotency_key = ?").bind(idem).first<JobRow>();
    if (existing) return c.json({ ...jobView(existing, await loadSteps(db, existing.job_id)), reused: true }, 200);
    return c.json({ error: "Could not create the job." }, 500);
  }
  c.executionCtx.waitUntil(processJobChunk(env, jobId).catch(() => undefined));
  return c.json(
    {
      job_id: jobId,
      status: "queued",
      run_id: run.run_id,
      scope,
      domain,
      mode,
      rule_version: rules.version,
      sequence,
      progress: { total: sequence.length, done: 0, failed: 0, pct: 0 },
      poll: `/api/recon/jobs/${jobId}`,
    },
    202,
  );
}

export async function getReconJob(c: Context) {
  requireUser(c);
  const env = c.env as Env;
  const db = getDb(env);
  const jobId = c.req.param("id") ?? "";
  const job = await db.prepare("SELECT * FROM ra_recon_jobs WHERE job_id = ?").bind(jobId).first<JobRow>();
  if (!job) return c.json({ error: "Job not found" }, 404);
  const steps = await loadSteps(db, jobId);
  let resumed = false;
  const leaseFree = !job.lease_until || Date.parse(String(job.lease_until)) < Date.now();
  if ((job.status === "queued" || job.status === "running") && leaseFree) {
    c.executionCtx.waitUntil(processJobChunk(env, jobId).catch(() => undefined));
    resumed = true;
  }
  const view = jobView(job, steps);
  let outputs: { agent_id: string; output: unknown }[] | undefined;
  if (c.req.query("outputs") === "1") {
    const ids = steps.map((s) => s.output_id).filter((x): x is string => !!x);
    if (ids.length) {
      const { results } = await db
        .prepare(
          `SELECT agent_id, output_json FROM ra_agent_outputs
           WHERE output_id IN (SELECT jsonb_array_elements_text(?::jsonb))`,
        )
        .bind(JSON.stringify(ids))
        .all<{ agent_id: string; output_json: string }>();
      outputs = (results ?? []).map((r) => {
        let output: unknown = r.output_json;
        try {
          output = JSON.parse(r.output_json);
        } catch {
          /* keep text */
        }
        return { agent_id: r.agent_id, output };
      });
    } else outputs = [];
  }
  return c.json({ ...view, resumed, ...(outputs ? { outputs } : {}) });
}

export async function listReconJobs(c: Context) {
  requireUser(c);
  const { results } = await getDb(c.env)
    .prepare(
      `SELECT job_id, scope, domain, mode, status, total_steps, done_steps, failed_steps, chunks, requested_by,
              rule_version, created_at, started_at, finished_at,
              EXTRACT(EPOCH FROM (COALESCE(finished_at, now()) - created_at))::int AS elapsed_s
       FROM ra_recon_jobs ORDER BY created_at DESC LIMIT 20`,
    )
    .all<Record<string, unknown>>();
  return c.json({ jobs: results ?? [] });
}
