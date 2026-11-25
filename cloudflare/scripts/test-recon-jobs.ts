/**
 * Background recon job lifecycle against an in-memory model of the job tables:
 * chunking, leases, idempotent steps, retry of interrupted steps, final status.
 * Usage: npx tsx scripts/test-recon-jobs.ts
 */
import { MAX_STEP_ATTEMPTS, jobFinalStatus, jobSequence, nextChunk,
  RECON_BATCH, progress, type JobStep } from "../shared/reconJobs";
import { RUN_ALL_SEQUENCE, sequenceForDomain } from "../worker/agentRoster";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const seq = RUN_ALL_SEQUENCE as string[];
assert(seq[0] === "orchestrator", "orchestrator first");
assert(jobSequence(seq, false).every((s) => s.startsWith("recon_")), "deterministic job = recon template steps only");
assert(jobSequence(sequenceForDomain("apm"), true).join(",") === "orchestrator,recon_apm,gap_detection,investigator,action,auditor", "domain sequence");

// Simulated processor: one chunk per invocation, done steps never re-run.
type Step = JobStep & { runs: number };
const steps: Step[] = seq.map((agent_id, i) => ({ seq: i + 1, agent_id, status: "pending", attempts: 0, runs: 0 }));
let invocations = 0;
let leaseHeld = false;
function invoke(opts: { crashOn?: string } = {}) {
  if (leaseHeld) return "leased";
  leaseHeld = true;
  invocations += 1;
  for (const s of steps) if (s.status === "running") s.status = s.attempts >= MAX_STEP_ATTEMPTS ? "failed" : "pending";
  const chunk = nextChunk(steps);
  for (const c of chunk) {
    const s = steps.find((x) => x.seq === c.seq)!;
    s.status = "running";
    s.attempts += 1;
  }
  if (opts.crashOn && chunk.some((c) => c.agent_id === opts.crashOn)) {
    leaseHeld = false; // lease expires later; the step is left 'running'
    return "crashed";
  }
  for (const c of chunk) {
    const s = steps.find((x) => x.seq === c.seq)!;
    s.runs += 1;
    s.status = "done";
  }
  leaseHeld = false;
  return jobFinalStatus(steps);
}

// First chunk: the orchestrator alongside the first RECON_BATCH recon steps; then recon batches;
// narrative steps (gap, investigator, action, auditor) one at a time, in order.
const c1 = nextChunk(steps);
assert(c1[0].agent_id === "orchestrator" && c1.length === 1 + RECON_BATCH && c1.slice(1).every((s) => s.agent_id.startsWith("recon_")), "chunk 1 is orchestrator + a recon batch");
invoke();
const c2 = nextChunk(steps);
assert(c2.length >= 1 && c2.length <= RECON_BATCH && c2.every((s) => s.agent_id.startsWith("recon_")), "chunk 2 is recon steps only");
// A narrative step never shares a chunk with anything else.
const narrativeOnly = [
  { seq: 1, agent_id: "gap_detection", status: "pending" as const, attempts: 0 },
  { seq: 2, agent_id: "investigator", status: "pending" as const, attempts: 0 },
];
assert(nextChunk(narrativeOnly).map((s) => s.agent_id).join() === "gap_detection", "narrative steps run one at a time");
assert(
  nextChunk([{ seq: 1, agent_id: "gap_detection", status: "running", attempts: 1 }, { seq: 2, agent_id: "investigator", status: "pending", attempts: 0 }]).length === 0,
  "no step starts while an earlier narrative step is running",
);

// Concurrent invocation is refused while the lease is held.
leaseHeld = true;
assert(invoke() === "leased", "second invocation blocked by lease");
leaseHeld = false;

// A crash mid-chunk leaves steps running; the next invocation retries them once.
invoke({ crashOn: c2[0].agent_id });
assert(steps.filter((s) => s.status === "running").length === c2.length, "crashed steps still running");
let status = invoke();
assert(steps.filter((s) => s.seq <= 1 + RECON_BATCH + c2.length).every((s) => s.status === "done" && s.runs === 1), "retried steps ran exactly once to completion");
let guard = 0;
while (status === "running" && guard++ < 100) status = invoke();
assert(status === "succeeded", `job succeeded (${status})`);
assert(steps.every((s) => s.runs === 1), "every step ran exactly once (idempotent)");
assert(progress(steps).pct === 100 && progress(steps).done === steps.length, "progress 100%");
assert(invocations < steps.length, `chunked: ${invocations} invocations for ${steps.length} steps`);

// A step that keeps crashing is failed after MAX attempts; a job with no done steps is failed.
const lone: JobStep[] = [{ seq: 1, agent_id: "recon_gl", status: "running", attempts: MAX_STEP_ATTEMPTS }];
for (const s of lone) if (s.status === "running") s.status = s.attempts >= MAX_STEP_ATTEMPTS ? "failed" : "pending";
assert(jobFinalStatus(lone) === "failed", "all-failed job is failed");
assert(jobFinalStatus([{ seq: 1, agent_id: "a", status: "done", attempts: 1 }, { seq: 2, agent_id: "b", status: "failed", attempts: 2 }]) === "succeeded", "partial failure still completes");

console.log(`test-recon-jobs: lifecycle ok (${steps.length} steps in ${invocations} chunks)`);
