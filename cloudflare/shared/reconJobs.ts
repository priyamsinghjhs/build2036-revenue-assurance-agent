/**
 * Pure planning rules for DB-backed background recon jobs (no Queues on Workers Free).
 * One chunk per Worker invocation keeps each invocation inside the free CPU budget;
 * the status poll, the creating request and the daily cron each advance one chunk.
 */
/**
 * Up to 8 SQL-template recon steps run in parallel per chunk. Budget (Workers Free: 50 subrequests
 * per invocation): ~4 job round-trips + 2 for priming the evidence packs + 2 per recon step
 * (combined output/eval write, step update) + ~9 for an orchestrator riding along = ~31.
 */
export const RECON_BATCH = 8;
/** Narrative steps that can share the first chunk because nothing they read depends on it. */
export const PARALLEL_WITH_RECON = new Set(["orchestrator"]);
/** Background-job cap on one Workers AI call for the light narrative steps (auditor keeps the default). */
export const JOB_AI_TIMEOUT_MS: Record<string, number> = { gap_detection: 8000, investigator: 8000, action: 8000 };
export const LEASE_SECONDS = 45;
export const MAX_STEP_ATTEMPTS = 2;

export type JobStep = { seq: number; agent_id: string; status: "pending" | "running" | "done" | "failed"; attempts: number };

export function isTemplateRecon(agentId: string): boolean {
  return agentId.startsWith("recon_");
}

/** Next chunk: up to RECON_BATCH consecutive SQL-template recon steps in parallel, otherwise one step (order matters for gap/investigator/action/auditor). */
export function nextChunk(steps: JobStep[]): JobStep[] {
  const pending = steps.filter((s) => s.status === "pending").sort((a, b) => a.seq - b.seq);
  if (!pending.length) return [];
  // Never start a step while an earlier non-recon step is still running (narrative order matters).
  const running = steps.filter((s) => s.status === "running");
  if (running.some((r) => !isTemplateRecon(r.agent_id) && !PARALLEL_WITH_RECON.has(r.agent_id))) return [];
  const out: JobStep[] = [];
  let rest = pending;
  // The orchestrator reads only the book, not recon outputs, so it runs alongside the first recon batch.
  if (PARALLEL_WITH_RECON.has(pending[0].agent_id) && pending[1] && isTemplateRecon(pending[1].agent_id)) {
    out.push(pending[0]);
    rest = pending.slice(1);
  } else if (!isTemplateRecon(pending[0].agent_id)) {
    return [pending[0]];
  }
  let n = 0;
  for (const s of rest) {
    if (!isTemplateRecon(s.agent_id) || n >= RECON_BATCH) break;
    out.push(s);
    n++;
  }
  return out;
}

export function jobFinalStatus(steps: JobStep[]): "running" | "succeeded" | "failed" {
  if (steps.some((s) => s.status === "pending" || s.status === "running")) return "running";
  const done = steps.filter((s) => s.status === "done").length;
  return done === 0 && steps.length > 0 ? "failed" : "succeeded";
}

export function progress(steps: JobStep[]) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  return { total, done, failed, pct: total ? Math.round(((done + failed) / total) * 100) : 100 };
}

/** Steps for a job. Recon steps always run from the SQL template (no neurons); narrative agents only when asked. */
export function jobSequence(sequence: string[], includeNarrative: boolean): string[] {
  return includeNarrative ? sequence : sequence.filter(isTemplateRecon);
}
