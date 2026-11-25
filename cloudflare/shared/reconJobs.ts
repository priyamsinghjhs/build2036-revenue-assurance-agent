/**
 * Pure planning rules for DB-backed background recon jobs (no Queues on Workers Free).
 * One chunk per Worker invocation keeps each invocation inside the free CPU budget;
 * the status poll, the creating request and the daily cron each advance one chunk.
 */
export const RECON_BATCH = 3;
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
  const first = pending[0];
  if (!isTemplateRecon(first.agent_id)) return [first];
  const out: JobStep[] = [];
  for (const s of pending) {
    if (!isTemplateRecon(s.agent_id) || out.length >= RECON_BATCH) break;
    out.push(s);
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
