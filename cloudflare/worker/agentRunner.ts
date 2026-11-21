import { complete } from "./llm";
import {
  AGENT_ROSTER,
  type AgentId,
} from "./agentRoster";
import {
  domainSummaryForAgent,
  getException,
  kpiCounts,
  listExceptions,
  policyText,
  summarizeAll,
  type AreaId,
} from "./recon";
import type { Env } from "./types";
import { getDb, type AppDb } from "./pg";
import { normalizeAmount, normalizeConfidence } from "../shared/numbers";

const JSON_HINT = "Reply with compact JSON only. No markdown fences, no prose outside JSON.";

function parseJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const startObj = trimmed.indexOf("{");
  const startArr = trimmed.indexOf("[");
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) {
    const end = trimmed.lastIndexOf("]");
    const arr = JSON.parse(trimmed.slice(startArr, end + 1)) as unknown;
    if (Array.isArray(arr) && arr[0] && typeof arr[0] === "object" && !Array.isArray(arr[0])) {
      return arr[0] as Record<string, unknown>;
    }
    return { items: arr };
  }
  const start = startObj;
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
  return { raw: text };
}

async function priorOutputs(db: AppDb, runId: string) {
  const { results } = await db
    .prepare(
      "SELECT agent_id, domain, output_json FROM ra_agent_outputs WHERE run_id = ? ORDER BY created_at",
    )
    .bind(runId)
    .all<{ agent_id: string; domain: string | null; output_json: string }>();
  return (results ?? []).map((r) => ({
    agent_id: r.agent_id,
    domain: r.domain,
    output: safeParse(r.output_json),
  }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export async function buildInput(env: Env, agentId: AgentId, scope: string, domain?: string, exceptionId?: string) {
  const db = getDb(env);
  if (agentId === "orchestrator") {
    const kpis = await kpiCounts(db);
    const areas = await summarizeAll(db);
    return {
      task: "Prioritise revenue-assurance domains for this synthetic acquirer book.",
      kpis,
      areas: areas.map((a) => ({
        area: a.area,
        match_rate: Number(a.match_rate.toFixed(4)),
        leakage: a.leakage,
        exceptions: a.exception_count,
      })),
      scope,
    };
  }
  if (agentId.startsWith("recon_")) {
    const map: Record<string, AreaId[]> = {
      recon_authorization: ["authorization"],
      recon_scheme: ["scheme"],
      recon_network_gateway: ["network", "gateway"],
      recon_partner: ["partner"],
      recon_terminal: ["terminal"],
      recon_bank: ["bank_trs"],
      recon_apm: ["apm"],
      recon_fx: ["fx"],
      recon_billing: ["billing"],
      recon_invoicing: ["invoicing"],
      recon_cash: ["cash_ar"],
      recon_vendor: ["vendor"],
      recon_gl: ["gl"],
      recon_settlement: ["settlement"],
      recon_funding: ["funding"],
      recon_acquirer: ["acquirer"],
      recon_config: ["config"],
      recon_tax: ["tax"],
      recon_kyc: ["kyc"],
      recon_interfaces: ["interfaces"],
      recon_aml: ["aml"],
      recon_network: ["network_risk"],
      recon_success: ["success"],
    };
    const areas = map[agentId] ?? (domain ? [domain as AreaId] : []);
    const summaries = [];
    for (const a of areas) summaries.push(await domainSummaryForAgent(db, a));
    const topic = areas[0] === "bank_trs" ? "bank_trs" : areas[0] === "gateway" || areas[0] === "network" ? "fees" : areas[0] ?? "synthetic";
    return { task: "Interpret these SQL reconciliation summaries. Do not recompute totals.", summaries, policy: await policyText(db, topic) };
  }
  if (agentId === "gap_detection") {
    const areas = await summarizeAll(db);
    const top = await listExceptions(db, undefined, 12);
    return {
      task: "Identify the most material leakage gaps and themes.",
      areas: areas.filter((a) => a.leakage > 0).map((a) => ({ area: a.area, leakage: a.leakage, exceptions: a.exception_count, match_rate: Number(a.match_rate.toFixed(4)) })),
      top_exceptions: top.slice(0, 12),
    };
  }
  if (exceptionId) {
    const ex = await getException(db, exceptionId);
    return { task: "Investigate this single exception.", exception: ex, policy: await policyText(db, ex?.area ?? "synthetic") };
  }
  const top = await listExceptions(db, domain, 8);
  return {
    task: agentId === "action" ? "Propose concrete recovery actions with amounts." : agentId === "auditor" ? "Audit the case and recommend sign-off." : "Explain root causes of the priority gaps.",
    focus_domain: domain ?? scope,
    top_exceptions: top,
  };
}

export function systemPrompt(agentId: AgentId): string {
  const meta = AGENT_ROSTER.find((a) => a.id === agentId);
  const schemas: Record<AgentId, string> = {
    orchestrator: `{"priority_domains":["area_id"],"run_order":["area_id"],"attention":"one sentence","risk_level":"high|medium|low"}`,
    recon_authorization: reconSchema("authorization"),
    recon_scheme: reconSchema("scheme"),
    recon_network_gateway: reconSchema("fees"),
    recon_partner: reconSchema("partner"),
    recon_terminal: reconSchema("terminal"),
    recon_bank: reconSchema("bank_trs"),
    recon_apm: reconSchema("apm"),
    recon_fx: reconSchema("fx"),
    recon_billing: reconSchema("billing"),
    recon_invoicing: reconSchema("invoicing"),
    recon_cash: reconSchema("cash_ar"),
    recon_vendor: reconSchema("vendor"),
    recon_gl: reconSchema("gl"),
    recon_settlement: reconSchema("settlement"),
    recon_funding: reconSchema("funding"),
    recon_acquirer: reconSchema("acquirer"),
    recon_config: reconSchema("config"),
    recon_tax: reconSchema("tax"),
    recon_kyc: reconSchema("kyc"),
    recon_interfaces: reconSchema("interfaces"),
    recon_aml: reconSchema("aml"),
    recon_network: reconSchema("network_risk"),
    recon_success: reconSchema("success"),
    gap_detection: `{"severity":"critical|high|medium|low","themes":["short theme"],"priority_gaps":[{"exception_id":"","issue":"","amount":0,"priority":"high|medium|low"}],"narrative":"one sentence"}`,
    investigator: `{"root_cause":"short","evidence":["chip"],"affected":"who/what","confidence":80}` /* confidence is an integer 0-100 */,
    action: `{"actions":[{"type":"dispute|recover|rebill|escalate|adjust|mark_known","target":"ref or merchant","amount":0,"currency":"INR","confidence":80,"rationale":"short"}]}`,
    auditor: `{"signoff":"ready|needs_review","compliance_notes":"short","audit_points":["point"],"cfo_one_liner":"one sentence"}`,
  };
  return [
    `You are the ${meta?.name} agent for a payment-acquiring revenue assurance platform.`,
    meta?.role ?? "",
    "SQL has already computed matches, variances and leakage. Only interpret the provided summaries.",
    "Data is synthetic, for demo only. Be concise.",
    "confidence is an integer 0-100, not a 0-1 fraction. amounts are plain numbers (no currency symbols or words).",
    JSON_HINT,
    `Schema: ${schemas[agentId]}`,
  ].join("\n");
}

function reconSchema(domain: string) {
  return `{"domain":"${domain}","assessment":"one sentence","match_quality":"good|watch|poor","top_gaps":[{"ref":"","issue":"","amount":0,"priority":"high|medium|low"}],"recommended_focus":"short"}`;
}

export async function runAgentStep(
  env: Env,
  opts: { runId: string; agentId: AgentId; scope: string; domain?: string; exceptionId?: string },
) {
  const input = await buildInput(env, opts.agentId, opts.scope, opts.domain, opts.exceptionId);
  const priors = await priorOutputs(getDb(env), opts.runId);
  const briefPriors = priors.slice(-4).map((p) => ({ agent: p.agent_id, output: p.output }));
  const user = JSON.stringify({ input, prior_agents: briefPriors }).slice(0, 6000);
  const prompt = `${systemPrompt(opts.agentId)}\n\nINPUT:\n${user}`;
  const raw = await complete(env.AI, prompt);
  let output: Record<string, unknown>;
  try {
    output = parseJson(raw);
  } catch {
    output = { raw, parse_error: true };
  }
  output = sanitizeAgentOutput(output);
  const outputId = crypto.randomUUID();
  const created = new Date().toISOString();
  await getDb(env).prepare(
    "INSERT INTO ra_agent_outputs (output_id, run_id, agent_id, domain, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(outputId, opts.runId, opts.agentId, opts.domain ?? null, JSON.stringify(output), created)
    .run();

  if (opts.agentId === "action") {
    const actions = Array.isArray(output.actions) ? (output.actions as Record<string, unknown>[]) : [];
    for (const act of actions) {
      await getDb(env).prepare(
        `INSERT INTO ra_action_queue (action_id, run_id, exception_id, action, amount, currency, confidence, rationale, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
      )
        .bind(
          crypto.randomUUID(),
          opts.runId,
          opts.exceptionId ?? null,
          String(act.type ?? "escalate"),
          normalizeAmount(act.amount),
          String(act.currency ?? "INR"),
          normalizeConfidence(act.confidence),
          String(act.rationale ?? ""),
          created,
        )
        .run();
    }
  }
  return { output_id: outputId, agent_id: opts.agentId, output, created_at: created };
}

export async function startRun(db: AppDb, scope: string) {
  const runId = crypto.randomUUID();
  const started = new Date().toISOString();
  await db
    .prepare("INSERT INTO ra_agent_runs (run_id, scope, started_at, status) VALUES (?, ?, ?, 'running')")
    .bind(runId, scope, started)
    .run();
  return { run_id: runId, started_at: started, status: "running" as const };
}

export async function completeRun(db: AppDb, runId: string) {
  await db
    .prepare("UPDATE ra_agent_runs SET completed_at = ?, status = 'completed' WHERE run_id = ?")
    .bind(new Date().toISOString(), runId)
    .run();
}

export async function latestRun(db: AppDb, scope?: string) {
  const sql = scope
    ? "SELECT * FROM ra_agent_runs WHERE scope = ? ORDER BY started_at DESC LIMIT 1"
    : "SELECT * FROM ra_agent_runs ORDER BY started_at DESC LIMIT 1";
  const run = scope
    ? await db.prepare(sql).bind(scope).first<Record<string, unknown>>()
    : await db.prepare(sql).first<Record<string, unknown>>();
  if (!run) return null;
  const { results } = await db
    .prepare("SELECT agent_id, domain, output_json, created_at FROM ra_agent_outputs WHERE run_id = ? ORDER BY created_at")
    .bind(run.run_id)
    .all<{ agent_id: string; domain: string | null; output_json: string; created_at: string }>();
  const { results: actions } = await db
    .prepare("SELECT * FROM ra_action_queue WHERE run_id = ? ORDER BY created_at")
    .bind(run.run_id)
    .all();
  return {
    run,
    outputs: (results ?? []).map((r) => ({
      agent_id: r.agent_id,
      domain: r.domain,
      output: safeParse(r.output_json),
      created_at: r.created_at,
    })),
    actions: actions ?? [],
  };
}

export async function listActions(db: AppDb, limit = 50) {
  const { results } = await db
    .prepare("SELECT * FROM ra_action_queue ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all();
  return results ?? [];
}

function sanitizeAgentOutput(output: Record<string, unknown>): Record<string, unknown> {
  const next = { ...output };
  if (next.confidence !== undefined) next.confidence = normalizeConfidence(next.confidence);
  const actionRows = Array.isArray(next.actions) ? (next.actions as Record<string, unknown>[]) : null;
  if (actionRows) {
    next.actions = actionRows.map((act) => ({
      ...act,
      amount: act.amount !== undefined ? normalizeAmount(act.amount) : act.amount,
      confidence: act.confidence !== undefined ? normalizeConfidence(act.confidence) : act.confidence,
    }));
  }
  for (const key of ["top_gaps", "priority_gaps"] as const) {
    const rows = Array.isArray(next[key]) ? (next[key] as Record<string, unknown>[]) : null;
    if (!rows) continue;
    next[key] = rows.map((row) => ({
      ...row,
      amount: row.amount !== undefined ? normalizeAmount(row.amount) : row.amount,
    }));
  }
  return next;
}
