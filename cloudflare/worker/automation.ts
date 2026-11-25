import { UPSERT_PROPOSED_ACTION_SQL } from "../shared/actionQueue";
import { completeRun, startRun } from "./agentRunner";
import { executiveSummary, type ExecPayload } from "./executive";
import { deterministicBullets } from "./brief";
import { complete } from "./llm";
import { getDb, type AppDb } from "./pg";
import type { Env } from "./types";
import { normalizeAmount, normalizeConfidence } from "../shared/numbers";
import { investigateAnomaly } from "./intel";
import { runInvestigation } from "./investigateFlow";
import { syncDue } from "./dataSources/store";

const ACTION_FOR: Record<string, string> = {
  billed_not_invoiced: "raise_invoice",
  gst_mismatch: "adjust_gst",
  invoice_wrong_rate: "reissue_invoice",
  vendor_unpaid: "process_vendor_payment",
  vendor_duplicate_payment: "recover_duplicate_payment",
  vendor_overcharge: "dispute_vendor_invoice",
  chargeback_unrecovered: "recover_from_merchant",
  auth_capture_mismatch: "review_capture",
  gl_unposted: "post_journal",
  unapplied_cash: "apply_cash",
  unbilled_usage: "raise_usage_charge",
  settlement_missing_txn: "include_in_batch",
  settlement_duplicate_txn: "reverse_duplicate",
  settlement_wrong_cutoff: "rebatch",
  settlement_fee_overcharge: "refund_excess_mdr",
  settlement_net_mismatch: "recast_net",
  funding_short: "top_up_funding",
  funding_late: "expedite_funding",
  funding_failed: "retry_funding",
  funding_returned: "retry_funding",
  funding_duplicate: "recover_duplicate_funding",
  funding_wrong_account: "recall_and_refire",
  funding_held: "review_hold",
  acquirer_fee_overcharge: "dispute_acquirer_invoice",
  acquirer_passthrough_markup: "dispute_passthrough",
  acquirer_settlement_late: "chase_acquirer",
  acquirer_statement_unmatched: "match_statement",
  config_unapproved: "escalate_approval",
  tax_gst_wrong_rate: "adjust_gst",
  tax_tds_shortfall: "withhold_tds",
  tax_zero_mdr_illustrative: "reverse_mdr",
  tax_daily_limit_breach: "review_limit",
  kyc_expired_transacting: "block_and_refresh_kyc",
  kyc_pending_transacting: "complete_kyc",
  kyc_mcc_pricing_mismatch: "reprices_mcc",
  kyc_limit_breach: "review_limit",
  kyc_commission_misconfig: "fix_hierarchy_commission",
  interface_drop: "replay_messages",
  interface_duplicates: "dedupe_batch",
  interface_latency: "investigate_latency",
  aml_structuring: "file_str",
  aml_refund_abuse: "hold_refunds",
  aml_round_trip: "escalate_aml",
  aml_velocity_spike: "review_velocity",
  aml_dormant_burst: "review_dormant",
  network_known_bad: "escalate_risk",
  network_shared_device: "review_shared_device",
  network_shared_account: "review_shared_account",
  network_changed_account: "verify_beneficiary",
  network_bad_proximity: "escalate_risk",
  success_low_approval: "review_auth_quality",
};

export async function seedProposedActions(db: AppDb, runId: string, limit = 8) {
  const { results } = await db
    .prepare(
      "SELECT area, category, ref_id, leakage, currency FROM ra_exception_rows ORDER BY leakage DESC LIMIT ?",
    )
    .bind(limit)
    .all<{ area: string; category: string; ref_id: string; leakage: number; currency: string }>();
  const ids = (results ?? []).map((row) => `${row.area}:${row.category}:${row.ref_id}`);
  const existing = new Set<string>();
  if (ids.length) {
    const { results: have } = await db
      .prepare(`SELECT exception_id FROM ra_action_queue WHERE status <> 'superseded' AND exception_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ exception_id: string }>();
    for (const r of have ?? []) existing.add(String(r.exception_id));
  }
  let created = 0;
  for (const row of results ?? []) {
    const exceptionId = `${row.area}:${row.category}:${row.ref_id}`;
    if (existing.has(exceptionId)) continue;
    const action = ACTION_FOR[row.category] ?? "escalate";
    await db
      .prepare(UPSERT_PROPOSED_ACTION_SQL)
      .bind(
        crypto.randomUUID(),
        runId,
        exceptionId,
        action,
        normalizeAmount(row.leakage),
        row.currency || "INR",
        normalizeConfidence(70),
        `Deterministic recommendation from ${row.category.replace(/_/g, " ")} (${row.area}).`,
        new Date().toISOString(),
      )
      .run();
    created++;
  }
  return created;
}

export async function upsertNarrative(env: Env, exec: ExecPayload, force: boolean) {
  const db = getDb(env);
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    const current = await db.prepare("SELECT as_of FROM ra_exec_brief WHERE id = 1").first<{ as_of: string }>();
    if (current?.as_of === today) return { skipped: true, source: "cached" as const };
  }
  let bullets = deterministicBullets(exec);
  let source: "llm" | "deterministic" = "deterministic";
  if (!force) {
    await db
      .prepare(
        `INSERT INTO ra_exec_brief (id, as_of, bullets, source, generated_at)
         VALUES (1, ?, ?::jsonb, ?, now())
         ON CONFLICT (id) DO UPDATE SET as_of = EXCLUDED.as_of, bullets = EXCLUDED.bullets, source = EXCLUDED.source, generated_at = now()`,
      )
      .bind(today, JSON.stringify(bullets), source)
      .run();
    return { skipped: false, source };
  }
  try {
    const raw = await complete(
      env.AI,
      `You are the Chief Revenue Assurance Officer of a payment acquirer. Write 3 to 5 concise executive-brief bullets (no heading, no markdown, each bullet one sentence) for leadership about this SYNTHETIC October 2026 book. Use Indian rupee units (₹, lakh, crore). Do not invent numbers not in the JSON.\n\n${JSON.stringify({
        kpis: exec.kpis,
        top_drivers: exec.top_drivers,
        period_compare: exec.period_compare,
        weakest: [...exec.heatmap].sort((a, b) => a.match_rate - b.match_rate).slice(0, 3),
        ageing: exec.ageing,
      })}`,
    );
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\s*[-*•\d.]+\s*/, "").trim())
      .filter((l) => l.length > 20)
      .slice(0, 5);
    if (lines.length >= 3) {
      bullets = lines;
      source = "llm";
    }
  } catch {
    source = "deterministic";
  }
  await db
    .prepare(
      `INSERT INTO ra_exec_brief (id, as_of, bullets, source, generated_at)
       VALUES (1, ?, ?::jsonb, ?, now())
       ON CONFLICT (id) DO UPDATE SET as_of = EXCLUDED.as_of, bullets = EXCLUDED.bullets, source = EXCLUDED.source, generated_at = now()`,
    )
    .bind(today, JSON.stringify(bullets), source)
    .run();
  return { skipped: false, source };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(items.length, 1)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function investigateTop(env: Env, runId: string, opts: { limit?: number; concurrency?: number } = {}) {
  const db = getDb(env);
  const cap = Math.max(1, opts.limit ?? 1);
  const { results } = await db
    .prepare("SELECT area, category, ref_id, leakage FROM ra_exception_rows ORDER BY leakage DESC LIMIT ?")
    .bind(cap)
    .all<{ area: string; category: string; ref_id: string; leakage: number }>();
  if (!results?.length) return { skipped: true };
  const concurrency = Math.min(opts.concurrency ?? 2, 3);
  const cases = await mapLimit(results, concurrency, async (top) => {
    const exceptionId = `${top.area}:${top.category}:${top.ref_id}`;
    const inv = await runInvestigation(env, { exceptionId, domain: top.area, runId });
    return { exception_id: exceptionId, leakage: top.leakage, timing_ms: inv.timing_ms, steps: ["investigator", "action", "auditor"] };
  });
  return { skipped: false, cases, concurrency };
}

export async function runDailyAutomation(env: Env, opts: { force?: boolean; skipLlm?: boolean } = {}) {
  const db = getDb(env);
  const logId = crypto.randomUUID();
  const started = new Date().toISOString();
  const detail: Record<string, unknown> = {};
  const skipLlm = opts.skipLlm === true || opts.force !== true;
  try {
    await db
      .prepare("INSERT INTO ra_automation_log (log_id, started_at, status, detail) VALUES (?, ?, 'running', '{}'::jsonb)")
      .bind(logId, started)
      .run();
  } catch {
    // table might not exist yet on a stale deploy; continue
  }
  const finish = async (status: "completed" | "failed", extra: Record<string, unknown> = {}) => {
    const payload = { ...detail, ...extra };
    await db
      .prepare("UPDATE ra_automation_log SET finished_at = ?, status = ?, detail = ?::jsonb WHERE log_id = ?")
      .bind(new Date().toISOString(), status, JSON.stringify(payload), logId)
      .run()
      .catch(() => undefined);
  };
  try {
    const run = await startRun(db, opts.force ? "automation:manual" : "automation:daily");
    try {
      await db.prepare("SELECT refresh_ra_summaries()").first();
      detail.summaries_refreshed = true;
    } catch (err) {
      detail.summaries_refresh_error = err instanceof Error ? err.message : String(err);
    }
    const exec = await executiveSummary(db);
    detail.executive_leakage = exec.kpis.leakage;
    detail.executive_exceptions = exec.kpis.exception_count;
    // Daily cron uses the deterministic brief so a Workers AI timeout cannot leave the job 'running'.
    // A manual run (force) may still call the model, and falls back to deterministic bullets on error.
    detail.narrative = await upsertNarrative(env, exec, Boolean(opts.force) && !skipLlm);
    detail.actions_seeded = await seedProposedActions(db, run.run_id);
    try {
      const ds = await syncDue(db, env, 3);
      detail.data_sources_synced = ds.length;
    } catch (err) {
      detail.data_sources_error = err instanceof Error ? err.message : String(err);
    }
    if (skipLlm) {
      detail.investigation = { skipped: true, reason: "deterministic_cron", note: "Action proposals are seeded; investigator/auditor run when a human starts an investigation or a forced automation run." };
    } else {
      try {
        const ev = await db
          .prepare("SELECT event_id FROM ra_anomaly_events WHERE status='open' AND investigated_run IS NULL ORDER BY ABS(COALESCE(zscore,0)) DESC LIMIT 1")
          .first<{ event_id: string }>();
        const work = ev ? investigateAnomaly(env, ev.event_id) : investigateTop(env, run.run_id, { limit: 3, concurrency: 2 });
        const timeout = new Promise((_, reject) => {
          (globalThis as unknown as { setTimeout: (cb: () => void, ms: number) => void })
            .setTimeout(() => reject(new Error("investigation_timeout")), 45_000);
        });
        detail.investigation = await Promise.race([work, timeout]);
      } catch (err) {
        detail.investigation_error = err instanceof Error ? err.message : String(err);
      }
    }
    await completeRun(db, run.run_id);
    detail.run_id = run.run_id;
    await finish("completed");
    return { ok: true, log_id: logId, ...detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("failed", { error: message });
    return { ok: false, log_id: logId, error: message, ...detail };
  }
}

export async function setActionStatus(db: AppDb, actionId: string, status: "approved" | "rejected" | "done", note?: string, decidedBy?: string) {
  const row = await db.prepare("SELECT action_id FROM ra_action_queue WHERE action_id = ?").bind(actionId).first();
  if (!row) return false;
  await db
    .prepare("UPDATE ra_action_queue SET status = ?, decided_at = ?, decision_note = ?, decided_by = COALESCE(?, decided_by) WHERE action_id = ?")
    .bind(status, new Date().toISOString(), note ?? null, decidedBy ?? null, actionId)
    .run();
  return true;
}

export async function latestAutomation(db: AppDb) {
  return db
    .prepare("SELECT log_id, started_at, finished_at, status, detail FROM ra_automation_log ORDER BY started_at DESC LIMIT 1")
    .first<Record<string, unknown>>();
}
