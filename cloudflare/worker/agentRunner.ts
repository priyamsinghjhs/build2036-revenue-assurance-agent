import { complete, classifyAIError, DEFAULT_AI_TIMEOUT_MS } from "./llm";
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
import { checkGrounding, retryPrompt } from "./grounding";
import { AUDITOR_SCHEMA, finalizeAuditorOutput } from "./auditor";

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
      recon_files: ["files"],
      recon_false_declines: ["false_declines"],
      contract_extract: ["contracts"],
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
    const { graphTools } = await import("./intel");
    const graph = await graphTools(db, { merchant_id: ex?.merchant_id ?? undefined, exception_id: exceptionId }).catch(() => null);
    return { task: "Investigate this single exception. Use the attached graph_tools results (paths, refund/chargeback rings, proximity) as evidence; do not invent graph edges.", exception: ex, graph_tools: graph, policy: await policyText(db, ex?.area ?? "synthetic") };
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
    recon_files: reconSchema("files"),
    recon_false_declines: reconSchema("false_declines"),
    contract_extract: reconSchema("contracts"),
    gap_detection: `{"severity":"critical|high|medium|low","themes":["short theme"],"priority_gaps":[{"exception_id":"","issue":"","amount":0,"priority":"high|medium|low"}],"narrative":"one sentence"}`,
    investigator: `{"root_cause":"short","evidence":["chip"],"affected":"who/what","confidence":80}` /* confidence is an integer 0-100 */,
    action: `{"actions":[{"type":"dispute|recover|rebill|escalate|adjust|mark_known","target":"ref or merchant","amount":0,"currency":"INR","confidence":80,"rationale":"short"}]}`,
    auditor: AUDITOR_SCHEMA,
  };
  const extra = agentId === "auditor" ? [
    "You must audit and suggest, not only sign off.",
    "Include all six checks (amount_reconciliation, evidence_completeness, policy_compliance, duplicate_prior_case, segregation_of_duties, grounding).",
    "Suggestions are in-app proposals only: they may map to the Action Queue, an in-app dispute/data-request draft, or a case. Never send email or call an external API.",
    "verdict is approved, needs_review, or rejected. Every number and ID must appear in INPUT.",
  ] : [];
  return [
    `You are the ${meta?.name} agent for a payment-acquiring revenue assurance platform.`,
    meta?.role ?? "",
    "SQL has already computed matches, variances and leakage. Only interpret the provided summaries.",
    "Answer only from the provided INPUT context. If a fact is missing, say \"insufficient data\" — do not invent numbers, IDs, dates, merchants or amounts.",
    "Data is synthetic, for demo only. Be concise.",
    "confidence is an integer 0-100, not a 0-1 fraction. amounts are plain numbers (no currency symbols or words).",
    JSON_HINT,
    `Schema: ${schemas[agentId]}`,
    ...extra,
  ].join("\n");
}

function reconSchema(domain: string) {
  return `{"domain":"${domain}","assessment":"one sentence","match_quality":"good|watch|poor","top_gaps":[{"ref":"","issue":"","amount":0,"priority":"high|medium|low"}],"recommended_focus":"short"}`;
}

const STEP_BUDGET_MS = 22_000;

function factBag(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const rec = input as Record<string, unknown>;
  const ex = rec.exception && typeof rec.exception === "object" ? rec.exception as Record<string, unknown> : rec;
  return { ...rec, ...ex };
}

function deterministicStepOutput(
  agentId: AgentId,
  input: unknown,
  priors: { agent: string; output: unknown }[],
  reason: string,
): Record<string, unknown> {
  const facts = factBag(input);
  const leakage = facts.leakage ?? facts.amount ?? facts.expected_amount;
  const ref = String(facts.recon_ref ?? facts.ref_id ?? facts.exception_id ?? "this exception");
  const area = String(facts.area ?? facts.domain ?? "revenue assurance");
  if (agentId === "auditor") {
    const out = finalizeAuditorOutput({ parse_error: true, source: "deterministic" }, input, priors);
    out.source = "deterministic";
    out.verdict = "needs_review";
    out.signoff = "needs_review";
    const note = `Deterministic auditor fallback (${reason}). The LLM step did not complete or was unavailable. Routed to human review.`;
    out.compliance_notes = `${note} ${String(out.compliance_notes ?? "")}`.trim();
    out.rationale = String(out.rationale ?? note);
    return out as unknown as Record<string, unknown>;
  }
  if (agentId === "action") {
    return {
      actions: [
        {
          type: "escalate",
          action: "escalate",
          amount: leakage ?? null,
          currency: String(facts.currency ?? "INR"),
          confidence: 40,
          rationale: `Deterministic proposal for ${ref}: the action agent could not finish (${reason}). Escalate for human review.`,
        },
      ],
      source: "deterministic",
    };
  }
  return {
    root_cause: `Deterministic summary for ${ref} in ${area}: the investigator could not finish (${reason}). Review the SQL facts before acting.`,
    evidence: [ref, area].filter(Boolean),
    affected: [ref],
    confidence: 40,
    source: "deterministic",
  };
}

export async function runAgentStep(
  env: Env,
  opts: { runId: string; agentId: AgentId; scope: string; domain?: string; exceptionId?: string; mode?: "llm" | "deterministic" },
) {
  const input = await buildInput(env, opts.agentId, opts.scope, opts.domain, opts.exceptionId);
  const priors = await priorOutputs(getDb(env), opts.runId);
  const briefPriors = priors.slice(-4).map((p) => ({ agent: p.agent_id, output: p.output }));
  const user = JSON.stringify({ input, prior_agents: briefPriors }).slice(0, 6000);
  const basePrompt = `${systemPrompt(opts.agentId)}\n\nINPUT:\n${user}`;
  let output: Record<string, unknown> = {};
  let grounding = checkGrounding({}, user);
  let retries = 0;
  let prompt = basePrompt;
  const started = Date.now();
  const deadline = started + STEP_BUDGET_MS;
  if (opts.mode === "deterministic") {
    output = sanitizeAgentOutput(deterministicStepOutput(opts.agentId, input, briefPriors, "requested"));
    if (opts.agentId === "auditor") {
      output = finalizeAuditorOutput(output, input, briefPriors, checkGrounding(output, user));
      output.source = "deterministic";
      output.verdict = "needs_review";
      output.signoff = "needs_review";
    }
    grounding = checkGrounding(output, user);
  } else {
    for (let attempt = 0; attempt <= 1; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 2000) {
        output = sanitizeAgentOutput(deterministicStepOutput(opts.agentId, input, briefPriors, "step budget exhausted"));
        if (opts.agentId === "auditor") {
          output = finalizeAuditorOutput(output, input, briefPriors, checkGrounding(output, user));
          output.source = "deterministic";
          output.verdict = "needs_review";
          output.signoff = "needs_review";
        }
        break;
      }
      const timeoutMs = Math.min(DEFAULT_AI_TIMEOUT_MS, Math.max(2000, remaining - 500));
      try {
        const raw = await complete(env.AI, prompt, {
          json: opts.agentId === "auditor",
          timeout_ms: timeoutMs,
        });
        try {
          output = parseJson(raw);
        } catch {
          output = { raw, parse_error: true };
        }
        output = sanitizeAgentOutput(output);
        if (opts.agentId === "auditor") {
          output = finalizeAuditorOutput(output, input, briefPriors, checkGrounding(output, user));
        }
        grounding = checkGrounding(output, user);
        if (grounding.passed) break;
        if (attempt === 1 || deadline - Date.now() < 4000) break;
        retries += 1;
        prompt = `${basePrompt}\n\n${retryPrompt(grounding.unsupported)}\n\nPREVIOUS_OUTPUT:\n${JSON.stringify(output).slice(0, 2000)}`;
      } catch (err) {
        const classified = classifyAIError(err);
        const reason = classified.kind === "cap"
          ? "Workers AI quota or neuron cap"
          : classified.kind === "timeout"
            ? "Workers AI timeout"
            : classified.message;
        output = sanitizeAgentOutput(deterministicStepOutput(opts.agentId, input, briefPriors, reason));
        if (opts.agentId === "auditor") {
          output = finalizeAuditorOutput(output, input, briefPriors, checkGrounding(output, user));
          output.source = "deterministic";
          output.verdict = "needs_review";
          output.signoff = "needs_review";
        }
        break;
      }
    }
  }
  const passed = grounding.passed;
  output.verification = passed ? "grounded" : "unverified";
  output.faithfulness = Math.round(grounding.faithfulness * 1000) / 1000;
  if (!passed) {
    output.unsupported_claims = grounding.unsupported.map((c) => `${c.kind}:${c.value}`);
    if (opts.agentId === "auditor") {
      output = finalizeAuditorOutput(output, input, briefPriors, grounding);
      output.verdict = "needs_review";
      output.signoff = "needs_review";
      const reason = `Grounding check failed after ${retries} rework(s): ${(output.unsupported_claims as string[]).join(", ")}. Treat as unverified, not as fact.`;
      output.compliance_notes = `${String(output.compliance_notes ?? "")} ${reason}`.trim();
      output.rationale = String(output.rationale ?? output.compliance_notes);
    }
  }
  const outputId = crypto.randomUUID();
  const created = new Date().toISOString();
  const db = getDb(env);
  await db.prepare(
    "INSERT INTO ra_agent_outputs (output_id, run_id, agent_id, domain, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(outputId, opts.runId, opts.agentId, opts.domain ?? null, JSON.stringify(output), created)
    .run();
  try {
    await db
      .prepare(
        `INSERT INTO ra_eval_scores (eval_id, run_id, output_id, agent_id, faithfulness, claims, supported, retries, verification, unsupported, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        opts.runId,
        outputId,
        opts.agentId,
        grounding.faithfulness,
        grounding.claims,
        grounding.supported,
        retries,
        passed ? "grounded" : "unverified",
        JSON.stringify(grounding.unsupported),
        created,
      )
      .run();
  } catch {
    /* table may not exist on a stale schema */
  }
  if (!passed && (opts.exceptionId || (opts.scope || "").startsWith("exception:"))) {
    const exceptionId = opts.exceptionId || String(opts.scope).replace(/^exception:/, "");
    if (opts.agentId !== "auditor") {
      try {
        await db
          .prepare(
            "INSERT INTO ra_agent_outputs (output_id, run_id, agent_id, domain, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            opts.runId,
            "auditor",
            opts.domain ?? null,
            JSON.stringify(finalizeAuditorOutput({
              verdict: "needs_review",
              signoff: "needs_review",
              compliance_notes: `Upstream ${opts.agentId} output marked unverified after grounding rework. Unsupported: ${(output.unsupported_claims as string[]).join(", ")}. Do not treat as fact.`,
              cfo_one_liner: "An agent output could not be grounded in the SQL facts and needs human review.",
              verification: "unverified",
              faithfulness: output.faithfulness,
            }, input, briefPriors)),
            created,
          )
          .run();
      } catch { /* ignore duplicate-path errors */ }
    }
    void exceptionId;
  }

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
    .bind(Math.max(limit, 80))
    .all<Record<string, unknown>>();
  const rows = results ?? [];
  const refs = [...new Set(rows.map((r) => {
    const id = String(r.exception_id ?? "");
    const parts = id.split(":");
    return parts.length >= 3 ? parts.slice(2).join(":") : id;
  }).filter(Boolean))];
  const scores = new Map<string, { chargeback_score: number; dispute_win_score: number }>();
  if (refs.length) {
    const ph = refs.map(() => "?").join(",");
    const { results: sc } = await db
      .prepare(
        `SELECT subject_id, model_id, score FROM ra_model_scores
         WHERE model_id IN ('chargeback','dispute_win') AND subject_id IN (${ph})`,
      )
      .bind(...refs)
      .all<{ subject_id: string; model_id: string; score: number }>();
    for (const s of sc ?? []) {
      const cur = scores.get(s.subject_id) ?? { chargeback_score: 0, dispute_win_score: 0 };
      if (s.model_id === "chargeback") cur.chargeback_score = Number(s.score);
      if (s.model_id === "dispute_win") cur.dispute_win_score = Number(s.score);
      scores.set(s.subject_id, cur);
    }
  }
  const enriched = rows.map((r) => {
    const id = String(r.exception_id ?? "");
    const parts = id.split(":");
    const ref = parts.length >= 3 ? parts.slice(2).join(":") : id;
    const sc = scores.get(ref);
    return {
      ...r,
      amount: r.amount,
      chargeback_score: sc?.chargeback_score ?? null,
      dispute_win_score: sc?.dispute_win_score ?? null,
    };
  });
  enriched.sort((a, b) => {
    const cb = Number(b.chargeback_score ?? 0) - Number(a.chargeback_score ?? 0);
    if (cb) return cb;
    return Number(b.amount ?? 0) - Number(a.amount ?? 0);
  });
  return enriched.slice(0, limit);
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
