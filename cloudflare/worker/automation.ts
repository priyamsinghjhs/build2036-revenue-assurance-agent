import { completeRun, runAgentStep, startRun } from "./agentRunner";
import { executiveSummary, type ExecPayload } from "./executive";
import { complete } from "./llm";
import { getDb, type AppDb } from "./pg";
import type { Env } from "./types";

function inr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function deterministicBullets(exec: ExecPayload): string[] {
  const k = exec.kpis;
  const top = exec.top_drivers[0];
  const worst = [...exec.heatmap].sort((a, b) => a.match_rate - b.match_rate)[0];
  const ageing = exec.ageing.find((a) => a.bucket === "61+ days") ?? exec.ageing[exec.ageing.length - 1];
  const bullets = [
    `Gross acquiring volume of ${inr(k.revenue)} in ${exec.period.label} carried ${inr(k.leakage)} of leakage (${pct(k.leakage_pct)} of revenue) across ${k.exception_count} open exceptions.`,
    top
      ? `The largest driver is ${top.category.replace(/_/g, " ")} in ${top.area} (${inr(top.leakage)}, ${top.n} cases).`
      : `Overall match rate is ${pct(k.match_rate)}.`,
    worst
      ? `${worst.label} is the weakest domain at ${pct(worst.match_rate)} match and ${inr(worst.leakage)} leakage.`
      : `Recoverable leakage stands at ${inr(k.recoverable)}.`,
    `Recovery position: ${inr(k.recovered)} recovered, ${inr(k.recoverable)} still recoverable, ${inr(k.written_off)} written off.`,
  ];
  if (ageing && ageing.n > 0) {
    bullets.push(`${ageing.n} exceptions in the ${ageing.bucket} SLA bucket represent ${inr(ageing.leakage)} at risk of ageing out.`);
  } else {
    bullets.push(`Book-level match rate is ${pct(k.match_rate)} on ${k.auth_count.toLocaleString("en-IN")} authorizations.`);
  }
  return bullets.slice(0, 5);
}

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
};

export async function seedProposedActions(db: AppDb, runId: string, limit = 8) {
  const { results } = await db
    .prepare(
      "SELECT area, category, ref_id, leakage, currency FROM ra_exception_rows ORDER BY leakage DESC LIMIT ?",
    )
    .bind(limit)
    .all<{ area: string; category: string; ref_id: string; leakage: number; currency: string }>();
  let created = 0;
  for (const row of results ?? []) {
    const exceptionId = `${row.area}:${row.category}:${row.ref_id}`;
    const existing = await db
      .prepare("SELECT action_id FROM ra_action_queue WHERE exception_id = ? LIMIT 1")
      .bind(exceptionId)
      .first();
    if (existing) continue;
    const action = ACTION_FOR[row.category] ?? "escalate";
    await db
      .prepare(
        `INSERT INTO ra_action_queue (action_id, run_id, exception_id, action, amount, currency, confidence, rationale, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        runId,
        exceptionId,
        action,
        Number(row.leakage ?? 0),
        row.currency || "INR",
        70,
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

export async function investigateTop(env: Env, runId: string) {
  const db = getDb(env);
  const top = await db
    .prepare("SELECT area, category, ref_id, leakage FROM ra_exception_rows ORDER BY leakage DESC LIMIT 1")
    .first<{ area: string; category: string; ref_id: string; leakage: number }>();
  if (!top) return { skipped: true };
  const exceptionId = `${top.area}:${top.category}:${top.ref_id}`;
  const steps = ["investigator", "action", "auditor"] as const;
  const outputs: string[] = [];
  for (const agentId of steps) {
    await runAgentStep(env, {
      runId,
      agentId,
      scope: `exception:${exceptionId}`,
      domain: top.area,
      exceptionId,
    });
    outputs.push(agentId);
  }
  return { skipped: false, exception_id: exceptionId, leakage: top.leakage, steps: outputs };
}

export async function runDailyAutomation(env: Env, opts: { force?: boolean } = {}) {
  const db = getDb(env);
  const logId = crypto.randomUUID();
  const started = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO ra_automation_log (log_id, started_at, status, detail) VALUES (?, ?, 'running', '{}'::jsonb)")
      .bind(logId, started)
      .run();
  } catch {
    // table might not exist yet on a stale deploy; continue
  }
  const detail: Record<string, unknown> = {};
  try {
    const run = await startRun(db, opts.force ? "automation:manual" : "automation:daily");
    const exec = await executiveSummary(db);
    detail.narrative = await upsertNarrative(env, exec, Boolean(opts.force));
    detail.actions_seeded = await seedProposedActions(db, run.run_id);
    try {
      detail.investigation = await investigateTop(env, run.run_id);
    } catch (err) {
      detail.investigation_error = err instanceof Error ? err.message : String(err);
    }
    await completeRun(db, run.run_id);
    detail.run_id = run.run_id;
    await db
      .prepare("UPDATE ra_automation_log SET finished_at = ?, status = 'completed', detail = ?::jsonb WHERE log_id = ?")
      .bind(new Date().toISOString(), JSON.stringify(detail), logId)
      .run()
      .catch(() => undefined);
    return { ok: true, log_id: logId, ...detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .prepare("UPDATE ra_automation_log SET finished_at = ?, status = 'failed', detail = ?::jsonb WHERE log_id = ?")
      .bind(new Date().toISOString(), JSON.stringify({ ...detail, error: message }), logId)
      .run()
      .catch(() => undefined);
    return { ok: false, log_id: logId, error: message, ...detail };
  }
}

export async function setActionStatus(db: AppDb, actionId: string, status: "approved" | "rejected" | "done", note?: string) {
  const row = await db.prepare("SELECT action_id FROM ra_action_queue WHERE action_id = ?").bind(actionId).first();
  if (!row) return false;
  await db
    .prepare("UPDATE ra_action_queue SET status = ?, decided_at = ?, decision_note = ? WHERE action_id = ?")
    .bind(status, new Date().toISOString(), note ?? null, actionId)
    .run();
  return true;
}

export async function latestAutomation(db: AppDb) {
  return db
    .prepare("SELECT log_id, started_at, finished_at, status, detail FROM ra_automation_log ORDER BY started_at DESC LIMIT 1")
    .first<Record<string, unknown>>();
}
