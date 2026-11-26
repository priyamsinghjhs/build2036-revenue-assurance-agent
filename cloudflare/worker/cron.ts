import { invalidateMem } from "./cache";
import { runDailyAutomation } from "./automation";
import { sweepReconJobs } from "./reconJobs";
import { reconcileRange } from "./incrementalRecon";
import type { Env } from "./types";

/** Daily cron: incremental recon, then automation, then job sweep. */
export async function runDailyCron(env: Env): Promise<void> {
  await reconcileRange(env, { area: "all" });
  await runDailyAutomation(env, { force: false });
  invalidateMem();
  await sweepReconJobs(env);
}
