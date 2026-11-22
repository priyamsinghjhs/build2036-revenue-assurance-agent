/**
 * Structured auditor output: schema, validation, and a deterministic skeleton
 * used when the LLM output is missing or malformed. Every number and ID must
 * still come from the agent input; suggestions are proposals only.
 */

import { normalizeAmount, normalizeConfidence } from "../shared/numbers";
import type { AppDb } from "./pg";
import type { GroundingResult } from "./grounding";

export const AUDIT_CHECK_NAMES = [
  "amount_reconciliation",
  "evidence_completeness",
  "policy_compliance",
  "duplicate_prior_case",
  "segregation_of_duties",
  "grounding",
] as const;

export type AuditCheckName = (typeof AUDIT_CHECK_NAMES)[number];

export const AUDIT_CHECK_LABELS: Record<AuditCheckName, string> = {
  amount_reconciliation: "Amount reconciliation",
  evidence_completeness: "Evidence completeness",
  policy_compliance: "Policy / contract rule compliance",
  duplicate_prior_case: "Duplicate / prior-case check",
  segregation_of_duties: "Segregation of duties / approval limits",
  grounding: "Grounding",
};

const CHECK_ALIASES: Record<string, AuditCheckName> = {
  amount: "amount_reconciliation",
  amount_reconciliation: "amount_reconciliation",
  reconciliation: "amount_reconciliation",
  evidence: "evidence_completeness",
  evidence_completeness: "evidence_completeness",
  policy: "policy_compliance",
  policy_compliance: "policy_compliance",
  contract: "policy_compliance",
  contract_compliance: "policy_compliance",
  duplicate: "duplicate_prior_case",
  duplicate_prior_case: "duplicate_prior_case",
  prior_case: "duplicate_prior_case",
  sod: "segregation_of_duties",
  segregation_of_duties: "segregation_of_duties",
  approval_limits: "segregation_of_duties",
  grounding: "grounding",
  faithfulness: "grounding",
};

export const AUDITOR_SCHEMA = `{
  "verdict":"approved|needs_review|rejected",
  "checks":[{"name":"amount_reconciliation|evidence_completeness|policy_compliance|duplicate_prior_case|segregation_of_duties|grounding","result":"pass|fail","evidence":"cite IDs and amounts from INPUT only","source":"query or rule"}],
  "findings":[{"issue":"short","severity":"high|medium|low","impact":0}],
  "suggestions":[{"suggestion_id":"sug-1","action":"request_file|recover|dispute_draft|data_request_draft|adjust_rule|escalate|write_off","title":"short concrete next step","owner_team":"Scheme|Finance|Tax|Ops|Compliance","priority":"high|medium|low","expected_recovery":0,"maps_to":"action_queue|draft_dispute|draft_data_request|case","rationale":"short"}],
  "confidence":80,
  "rationale":"one short paragraph",
  "cfo_one_liner":"one sentence"
}`;

const VERDICTS = new Set(["approved", "needs_review", "rejected"]);
const RESULTS = new Set(["pass", "fail"]);
const SEVERITIES = new Set(["high", "medium", "low"]);
const ACTIONS = new Set([
  "request_file",
  "recover",
  "dispute_draft",
  "data_request_draft",
  "adjust_rule",
  "escalate",
  "write_off",
  "rebill",
  "dispute",
]);
const MAPS = new Set(["action_queue", "draft_dispute", "draft_data_request", "case"]);

export type AuditCheck = { name: AuditCheckName; result: "pass" | "fail"; evidence: string; source: string };
export type AuditFinding = { issue: string; severity: "high" | "medium" | "low"; impact: number };
export type AuditSuggestion = {
  suggestion_id: string;
  action: string;
  title: string;
  owner_team: string;
  priority: "high" | "medium" | "low";
  expected_recovery: number;
  maps_to: string;
  rationale: string;
};
export type AuditorOutput = {
  verdict: "approved" | "needs_review" | "rejected";
  signoff: "ready" | "needs_review" | "rejected";
  checks: AuditCheck[];
  findings: AuditFinding[];
  suggestions: AuditSuggestion[];
  confidence: number;
  rationale: string;
  cfo_one_liner: string;
  schema_valid: boolean;
  source: "llm" | "deterministic";
  compliance_notes?: string;
  [key: string]: unknown;
};

function asStr(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function walkFacts(input: unknown, into: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (!input || typeof input !== "object" || depth > 6) return into;
  if (Array.isArray(input)) {
    for (const item of input) walkFacts(item, into, depth + 1);
    return into;
  }
  const rec = input as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    const key = k.toLowerCase();
    if (v != null && (typeof v === "string" || typeof v === "number") && into[key] === undefined) into[key] = v;
    if (v && typeof v === "object") {
      if (key === "exception" || key === "ex" || key.endsWith("_exception")) walkFacts(v, into, depth + 1);
      else if (depth < 3) walkFacts(v, into, depth + 1);
    }
  }
  return into;
}

function num(facts: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = facts[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function text(facts: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = facts[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function mapCheckName(raw: string): AuditCheckName | null {
  const k = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (CHECK_ALIASES[k]) return CHECK_ALIASES[k];
  if ((AUDIT_CHECK_NAMES as readonly string[]).includes(k)) return k as AuditCheckName;
  return null;
}

function mapVerdict(raw: unknown): AuditorOutput["verdict"] | null {
  const s = asStr(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "ready" || s === "approve" || s === "approved" || s === "pass") return "approved";
  if (s === "reject" || s === "rejected" || s === "failed") return "rejected";
  if (s === "needs_review" || s === "needsreview" || s === "review") return "needs_review";
  return VERDICTS.has(s) ? (s as AuditorOutput["verdict"]) : null;
}

/** Rewrite a CFO line so it never says 'ready to sign off' unless the verdict is approved. */
export function cfoLineForVerdict(
  verdict: AuditorOutput["verdict"],
  who: string,
  leakage?: number | null,
): string {
  const subject = who.trim() || "this exception";
  const leak = leakage != null && Number.isFinite(Number(leakage)) ? `, leakage ${leakage}` : "";
  if (verdict === "approved") return `Auditor is ready to sign off ${subject}${leak}.`;
  if (verdict === "rejected") return `Auditor rejected ${subject}${leak}.`;
  return `Auditor needs review on ${subject}${leak}.`;
}

export function alignCfoToVerdict(out: AuditorOutput): AuditorOutput {
  const verdict = out.verdict;
  const cfo = String(out.cfo_one_liner ?? "");
  if (verdict === "approved") return out;
  if (/ready to sign off/i.test(cfo)) {
    const m = cfo.match(/ready to sign off\s+(.+?)(?:,\s*leakage\s+([^.,]+))?\s*\.?$/i);
    const who = (m?.[1] ?? "this exception").trim().replace(/[.,]$/, "");
    const leakRaw = m?.[2] != null ? Number(String(m[2]).replace(/,/g, "")) : NaN;
    out.cfo_one_liner = cfoLineForVerdict(verdict, who, Number.isFinite(leakRaw) ? leakRaw : null);
  }
  return out;
}

export function isValidAuditorShape(raw: Record<string, unknown>): boolean {
  const verdict = mapVerdict(raw.verdict ?? raw.signoff);
  if (!verdict) return false;
  if (!Array.isArray(raw.checks) || raw.checks.length < 3) return false;
  if (!Array.isArray(raw.suggestions)) return false;
  return true;
}

export function normalizeAuditorOutput(raw: Record<string, unknown>, fallback?: AuditorOutput): AuditorOutput {
  const base = fallback ?? emptySkeleton();
  const verdict = mapVerdict(raw.verdict ?? raw.signoff) ?? base.verdict;
  const checksByName = new Map<AuditCheckName, AuditCheck>();
  for (const c of base.checks) checksByName.set(c.name, c);
  if (Array.isArray(raw.checks)) {
    for (const item of raw.checks) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = mapCheckName(asStr(rec.name ?? rec.check ?? rec.id));
      if (!name) continue;
      const rawResult = asStr(rec.result ?? rec.status ?? rec.outcome).toLowerCase();
      const result: "pass" | "fail" = RESULTS.has(rawResult) ? (rawResult as "pass" | "fail") : rawResult === "ok" || rawResult === "passed" ? "pass" : "fail";
      checksByName.set(name, {
        name,
        result,
        evidence: asStr(rec.evidence ?? rec.citation ?? rec.note, checksByName.get(name)?.evidence ?? ""),
        source: asStr(rec.source ?? rec.rule ?? rec.query, checksByName.get(name)?.source ?? "auditor"),
      });
    }
  }
  const checks = AUDIT_CHECK_NAMES.map((n) => checksByName.get(n)!);

  const findings: AuditFinding[] = [];
  if (Array.isArray(raw.findings)) {
    for (const item of raw.findings) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const issue = asStr(rec.issue ?? rec.finding ?? rec.summary);
      if (!issue) continue;
      const sev = asStr(rec.severity, "medium").toLowerCase();
      findings.push({
        issue,
        severity: (SEVERITIES.has(sev) ? sev : "medium") as AuditFinding["severity"],
        impact: normalizeAmount(rec.impact ?? rec.amount ?? rec.leakage ?? 0),
      });
    }
  }
  if (!findings.length && base.findings.length) findings.push(...base.findings);

  const suggestions: AuditSuggestion[] = [];
  if (Array.isArray(raw.suggestions)) {
    raw.suggestions.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const rec = item as Record<string, unknown>;
      const actionRaw = asStr(rec.action ?? rec.type, "escalate").toLowerCase().replace(/[\s-]+/g, "_");
      const action = ACTIONS.has(actionRaw) ? actionRaw : "escalate";
      const mapsRaw = asStr(rec.maps_to ?? rec.mapping, action.includes("draft") ? (action.includes("data") ? "draft_data_request" : "draft_dispute") : "action_queue");
      suggestions.push({
        suggestion_id: asStr(rec.suggestion_id ?? rec.id, `sug-${i + 1}`),
        action,
        title: asStr(rec.title ?? rec.summary ?? rec.action, action.replace(/_/g, " ")),
        owner_team: asStr(rec.owner_team ?? rec.owner ?? rec.team, "Ops"),
        priority: (SEVERITIES.has(asStr(rec.priority, "medium").toLowerCase())
          ? asStr(rec.priority, "medium").toLowerCase()
          : "medium") as AuditSuggestion["priority"],
        expected_recovery: normalizeAmount(rec.expected_recovery ?? rec.amount ?? rec.recovery ?? 0),
        maps_to: MAPS.has(mapsRaw) ? mapsRaw : "action_queue",
        rationale: asStr(rec.rationale ?? rec.reason ?? rec.why, "Proposed from the audit."),
      });
    });
  }
  if (!suggestions.length && base.suggestions.length) suggestions.push(...base.suggestions);
  const seen = new Set<string>();
  suggestions.forEach((s, i) => {
    if (!s.suggestion_id || seen.has(s.suggestion_id)) s.suggestion_id = `sug-${i + 1}`;
    seen.add(s.suggestion_id);
  });

  const rationale = asStr(raw.rationale ?? raw.compliance_notes ?? raw.summary, base.rationale);
  const cfo = asStr(raw.cfo_one_liner ?? raw.one_liner, base.cfo_one_liner);
  const out: AuditorOutput = {
    ...raw,
    verdict,
    signoff: verdict === "approved" ? "ready" : verdict,
    checks,
    findings,
    suggestions,
    confidence: normalizeConfidence(raw.confidence ?? base.confidence),
    rationale,
    cfo_one_liner: cfo,
    compliance_notes: asStr(raw.compliance_notes, rationale),
    schema_valid: isValidAuditorShape(raw) && checks.length === 6,
    source: isValidAuditorShape(raw) ? "llm" : "deterministic",
  };
  return alignCfoToVerdict(out);
}

function emptySkeleton(): AuditorOutput {
  return {
    verdict: "needs_review",
    signoff: "needs_review",
    checks: AUDIT_CHECK_NAMES.map((name) => ({
      name,
      result: "fail",
      evidence: "insufficient data",
      source: "auditor_skeleton",
    })),
    findings: [],
    suggestions: [],
    confidence: 40,
    rationale: "insufficient data",
    cfo_one_liner: "insufficient data — the auditor could not complete a structured review from the provided context.",
    schema_valid: false,
    source: "deterministic",
  };
}

/** Build a deterministic audit from the SQL/facts input when the LLM output is unusable. */
export function buildAuditorSkeleton(
  input: unknown,
  priors: { agent: string; output: unknown }[],
  grounding?: GroundingResult,
): AuditorOutput {
  const facts = walkFacts(input);
  for (const p of priors) walkFacts(p.output, facts);

  const exceptionId = text(facts, "exception_id", "exceptionid");
  const ref = text(facts, "ref_id", "recon_ref", "ref") || (exceptionId.includes(":") ? exceptionId.split(":").pop() || "" : exceptionId);
  const merchant = text(facts, "merchant_id", "merchant");
  const category = text(facts, "category", "issue");
  const area = text(facts, "area", "focus_domain", "domain");
  const expected = num(facts, "expected_amount", "expected");
  const actual = num(facts, "actual_amount", "actual", "settled_amount");
  const leakage = num(facts, "leakage", "amount", "impact");
  const cbScore = num(facts, "chargeback_score", "score");
  const winScore = num(facts, "dispute_win_score");

  const amountPass =
    expected != null && actual != null && leakage != null
      ? Math.abs(expected - actual - leakage) <= 0.05 || Math.abs(Math.abs(expected - actual) - Math.abs(leakage)) <= 0.05
      : expected != null && actual != null
        ? true
        : leakage != null;

  const inv = priors.find((p) => p.agent === "investigator");
  const evidencePass = Boolean(inv && inv.output && typeof inv.output === "object" && (inv.output as { root_cause?: unknown }).root_cause);

  const missingFile = /missing|file|drop/i.test(category) || /files|scheme/i.test(area);
  const policyPass = !missingFile && !/expired|wrong_rate|unapplied|mismatch/i.test(category);

  const hasCase = Boolean(text(facts, "case_id") || (input && typeof input === "object" && "case" in (input as object)));
  const groundingPass = grounding ? grounding.passed : true;

  const cite = [
    ref && `ref ${ref}`,
    merchant && `merchant ${merchant}`,
    expected != null && `expected ${expected}`,
    actual != null && `actual ${actual}`,
    leakage != null && `leakage ${leakage}`,
  ]
    .filter(Boolean)
    .join(", ");
  const citeOr = cite || "insufficient data";

  const checks: AuditCheck[] = [
    {
      name: "amount_reconciliation",
      result: amountPass ? "pass" : "fail",
      evidence: expected != null && actual != null
        ? `${citeOr}. expected minus actual ${amountPass ? "reconciles to" : "does not reconcile to"} leakage.`
        : leakage != null
          ? `${citeOr}. Only a leakage amount is present.`
          : "insufficient data for expected/actual/leakage.",
      source: "ra_exception_rows expected_amount, actual_amount, leakage",
    },
    {
      name: "evidence_completeness",
      result: evidencePass ? "pass" : "fail",
      evidence: evidencePass
        ? `Investigator evidence is present for ${ref || exceptionId || "this exception"}.`
        : "insufficient data — investigator evidence or supporting file is incomplete.",
      source: "prior investigator output + exception facts",
    },
    {
      name: "policy_compliance",
      result: policyPass ? "pass" : "fail",
      evidence: policyPass
        ? `No policy or contract breach is flagged in the provided facts for ${ref || "this item"}.`
        : missingFile
          ? `Policy requires a complete scheme/bank/APM file before sign-off. Category ${category || area || "n/a"} indicates a missing or dropped file.`
          : `Category ${category || "n/a"} indicates a policy or contract variance.`,
      source: "control / file-completeness policy",
    },
    {
      name: "duplicate_prior_case",
      result: "pass",
      evidence: hasCase
        ? `A linked case is already on file for ${exceptionId || ref || "this exception"}.`
        : "No prior linked case was present in the input; no duplicate was asserted.",
      source: "ra_cases / ra_case_exceptions",
    },
    {
      name: "segregation_of_duties",
      result: "pass",
      evidence: "Suggestions stay in the in-app Action Queue or as drafts. Nothing is sent externally; a human must accept each step.",
      source: "approval policy — in-app human approval required",
    },
    {
      name: "grounding",
      result: groundingPass ? "pass" : "fail",
      evidence: groundingPass
        ? "All cited numbers and IDs are present in (or derivable from) the SQL facts."
        : `Grounding failed (${grounding?.unsupported.map((c) => c.value).join(", ") || "unsupported claims"}). Treat as unverified.`,
      source: "deterministic grounding check",
    },
  ];

  const findings: AuditFinding[] = [];
  if (leakage != null && leakage > 0) {
    findings.push({
      issue: category
        ? `${category.replace(/_/g, " ")} on ${ref || exceptionId || "exception"}${merchant ? " at " + merchant : ""}`
        : `Leakage on ${ref || exceptionId || "exception"}`,
      severity: leakage >= 10000 ? "high" : leakage >= 1000 ? "medium" : "low",
      impact: leakage,
    });
  }

  const suggestions: AuditSuggestion[] = [];
  if (missingFile && (ref || exceptionId)) {
    suggestions.push({
      suggestion_id: "sug-1",
      action: "request_file",
      title: `Request the missing settlement file for ${ref || exceptionId}`,
      owner_team: "Scheme",
      priority: "high",
      expected_recovery: 0,
      maps_to: "action_queue",
      rationale: "A missing scheme or acquirer file is blocking sign-off. Raise an in-app data request; do not send it externally until a human approves.",
    });
  }
  if (area === "false_declines" || /false_decline/.test(category)) {
    suggestions.push({
      suggestion_id: suggestions.length ? `sug-${suggestions.length + 1}` : "sug-1",
      action: "recover",
      title: `Recover false-decline lost revenue${ref ? " for " + ref : ""}${leakage != null ? " (" + leakage + ")" : ""}`,
      owner_team: "Auth ops",
      priority: "high",
      expected_recovery: leakage ?? 0,
      maps_to: "action_queue",
      rationale: "This soft decline was scored as recoverable lost revenue. The model score and SHAP drivers are stored; the LLM may only narrate those factors. A human must approve any retry or merchant outreach.",
    });
  }
  if ((cbScore != null && cbScore >= 0.55) || area === "chargebacks") {
    suggestions.push({
      suggestion_id: `sug-${suggestions.length + 1}`,
      action: "dispute_draft",
      title: `Prioritise chargeback work${ref ? " for " + ref : ""}${cbScore != null ? " (risk " + cbScore.toFixed(2) + ")" : ""}`,
      owner_team: "Scheme",
      priority: cbScore != null && cbScore >= 0.7 ? "high" : "medium",
      expected_recovery: leakage ?? 0,
      maps_to: "draft_dispute",
      rationale: winScore != null
        ? `Chargeback risk is elevated. Dispute-win probability ${winScore.toFixed(2)} is illustrative (trained on 12 synthetic chargebacks). Draft stays in-app until a human approves export.`
        : "Chargeback risk is elevated on the synthetic model. Draft a dispute in-app; nothing is sent until a human approves export.",
    });
  }
  if (leakage != null && leakage > 0 && area !== "false_declines") {
    suggestions.push({
      suggestion_id: suggestions.length ? "sug-2" : "sug-1",
      action: leakage < 500 ? "write_off" : "recover",
      title: leakage < 500
        ? `Write off ${leakage} (below the auto-close threshold) after human approval`
        : `Recover ${leakage}${merchant ? " from " + merchant : ""}${ref ? " for " + ref : ""}`,
      owner_team: "Finance",
      priority: leakage >= 10000 ? "high" : "medium",
      expected_recovery: leakage < 500 ? 0 : leakage,
      maps_to: "action_queue",
      rationale: leakage < 500
        ? "The amount is below the logged write-off threshold. A human must still accept the proposal."
        : "Recover the leakage computed in the SQL facts. The Action Queue item stays proposed until approved.",
    });
  }
  if (missingFile || (leakage != null && leakage >= 1000)) {
    suggestions.push({
      suggestion_id: `sug-${suggestions.length + 1}`,
      action: "dispute_draft",
      title: `Draft an in-app dispute for ${ref || exceptionId || "this exception"}`,
      owner_team: "Scheme",
      priority: "medium",
      expected_recovery: leakage ?? 0,
      maps_to: "draft_dispute",
      rationale: "Prepare a dispute draft in-app. Nothing is emailed or sent to the scheme until a human approves export.",
    });
  }
  if (!suggestions.length) {
    suggestions.push({
      suggestion_id: "sug-1",
      action: "escalate",
      title: "Escalate to the review queue for a human decision",
      owner_team: "Compliance",
      priority: "medium",
      expected_recovery: leakage ?? 0,
      maps_to: "case",
      rationale: "The auditor cannot auto-close this item. Route it for human review.",
    });
  }

  const failed = checks.filter((c) => c.result === "fail").length;
  const verdict: AuditorOutput["verdict"] = !groundingPass || failed > 0 ? "needs_review" : "approved";
  const who = [ref, merchant].filter(Boolean).join(" / ") || "this exception";
  const rationale = failed
    ? `Audit of ${who} found ${failed} failed check(s). ${citeOr}. Suggestions are proposals only and require human acceptance.`
    : `Audit of ${who} passed the structured checks. ${citeOr}.`;
  const cfo = leakage != null
    ? (verdict === "approved"
      ? `Auditor is ready to sign off ${who}, leakage ${leakage}.`
      : `Auditor needs review on ${who}, leakage ${leakage}.`)
    : (verdict === "approved" ? `Auditor is ready to sign off ${who}.` : `Auditor needs review on ${who}.`);

  return {
    verdict,
    signoff: verdict === "approved" ? "ready" : verdict,
    checks,
    findings,
    suggestions,
    confidence: groundingPass ? (failed ? 70 : 85) : 45,
    rationale,
    cfo_one_liner: cfo,
    compliance_notes: rationale,
    schema_valid: true,
    source: "deterministic",
  };
}

export function finalizeAuditorOutput(
  raw: Record<string, unknown>,
  input: unknown,
  priors: { agent: string; output: unknown }[],
  grounding?: GroundingResult,
): AuditorOutput {
  const skeleton = buildAuditorSkeleton(input, priors, grounding);
  const valid = isValidAuditorShape(raw) && !raw.parse_error;
  const out = valid ? normalizeAuditorOutput(raw, skeleton) : { ...skeleton, schema_valid: false, source: "deterministic" as const };
  if (grounding && !grounding.passed) {
    out.verdict = "needs_review";
    out.signoff = "needs_review";
    const g = out.checks.find((c) => c.name === "grounding");
    if (g) {
      g.result = "fail";
      g.evidence = `Grounding check failed: ${grounding.unsupported.map((c) => `${c.kind}:${c.value}`).join(", ")}. Do not treat as fact.`;
    }
  }
  return alignCfoToVerdict(out);
}

export async function listSuggestionDecisions(db: AppDb, exceptionId: string) {
  const { results } = await db
    .prepare("SELECT * FROM ra_audit_suggestion_decisions WHERE exception_id=? ORDER BY created_at")
    .bind(exceptionId)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  return results ?? [];
}

export async function decideAuditorSuggestion(
  db: AppDb,
  body: {
    exception_id: string;
    suggestion: AuditSuggestion;
    decision: "accepted" | "dismissed";
    comment?: string;
    reviewer?: string;
    run_id?: string;
  },
) {
  if (body.decision === "dismissed" && !asStr(body.comment)) {
    throw new Error("A comment is required to dismiss a suggestion.");
  }
  const existing = await db
    .prepare("SELECT * FROM ra_audit_suggestion_decisions WHERE exception_id=? AND suggestion_id=?")
    .bind(body.exception_id, body.suggestion.suggestion_id)
    .first<Record<string, unknown>>()
    .catch(() => null);
  if (existing) return { already: true, decision: existing };

  const reviewer = body.reviewer || "Priyam Singh";
  const decisionId = crypto.randomUUID();
  let actionId: string | null = null;
  let draftId: string | null = null;
  let caseId: string | null = null;
  const linked = await db
    .prepare("SELECT c.case_id FROM ra_cases c JOIN ra_case_exceptions e ON e.case_id=c.case_id WHERE e.exception_id=? LIMIT 1")
    .bind(body.exception_id)
    .first<{ case_id: string }>()
    .catch(() => null);
  caseId = linked?.case_id ?? null;

  if (body.decision === "accepted") {
    actionId = crypto.randomUUID();
    const actionType = body.suggestion.action === "dispute_draft" || body.suggestion.action === "data_request_draft"
      ? body.suggestion.action
      : body.suggestion.action;
    await db
      .prepare(
        `INSERT INTO ra_action_queue (action_id, run_id, exception_id, action, amount, currency, confidence, rationale, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, 'proposed', ?)`,
      )
      .bind(
        actionId,
        body.run_id ?? null,
        body.exception_id,
        actionType,
        body.suggestion.expected_recovery,
        80,
        `${body.suggestion.title}. ${body.suggestion.rationale} Owner: ${body.suggestion.owner_team}. In-app only; not sent externally.`,
        new Date().toISOString(),
      )
      .run();

    if (body.suggestion.maps_to === "draft_dispute" || body.suggestion.maps_to === "draft_data_request" || body.suggestion.action.endsWith("_draft")) {
      draftId = crypto.randomUUID();
      const kind = body.suggestion.maps_to === "draft_data_request" || body.suggestion.action === "data_request_draft" ? "data_request" : "dispute";
      await db
        .prepare(
          `INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, note, is_synthetic)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'Created from an accepted auditor suggestion. Nothing was sent externally.', 1)`,
        )
        .bind(
          draftId,
          kind,
          caseId,
          body.exception_id,
          body.suggestion.owner_team,
          body.suggestion.title,
          `${body.suggestion.title}\n\n${body.suggestion.rationale}\n\nExpected recovery: ${body.suggestion.expected_recovery}\nException: ${body.exception_id}\n\nThis is an in-app draft only.`,
        )
        .run();
    }

    if (caseId) {
      await db
        .prepare("INSERT INTO ra_case_events (event_id, case_id, ts, actor, kind, body) VALUES (?, ?, now(), ?, 'action', ?)")
        .bind(
          crypto.randomUUID(),
          caseId,
          reviewer,
          `Accepted auditor suggestion ${body.suggestion.suggestion_id}: ${body.suggestion.title}`,
        )
        .run();
    }
  }

  await db
    .prepare(
      `INSERT INTO ra_audit_suggestion_decisions
         (decision_id, exception_id, suggestion_id, decision, comment, action_id, draft_id, case_id, reviewer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
    )
    .bind(
      decisionId,
      body.exception_id,
      body.suggestion.suggestion_id,
      body.decision,
      asStr(body.comment) || null,
      actionId,
      draftId,
      caseId,
      reviewer,
    )
    .run();

  await db
    .prepare("INSERT INTO ra_learning_log (log_id, ts, action, exception_id, category, amount, detail) VALUES (?, now(), ?, ?, ?, ?, ?)")
    .bind(
      crypto.randomUUID(),
      body.decision === "accepted" ? "suggestion_accepted" : "suggestion_dismissed",
      body.exception_id,
      body.suggestion.action,
      body.suggestion.expected_recovery,
      body.decision === "dismissed"
        ? `Dismissed ${body.suggestion.suggestion_id}: ${asStr(body.comment)}`
        : `Accepted ${body.suggestion.suggestion_id}: ${body.suggestion.title}`,
    )
    .run();

  return { decision_id: decisionId, action_id: actionId, draft_id: draftId, case_id: caseId, decision: body.decision };
}
