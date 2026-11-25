/**
 * Deterministic, SQL-templated narration for reconciliation agents.
 *
 * Recon agents only restate figures SQL already computed, so the LLM adds
 * latency and hallucination risk without adding facts. Every factual sentence
 * here quotes a figure or ID from the evidence pack; advice starts with
 * "Recommendation:" and is scored separately by the grounding check.
 */
import { inrExact } from "../shared/money";
import { checkGrounding, SENTENCE_TAG_RE } from "./grounding";
import { matchQualityWith, DEFAULT_RECON_CONFIG } from "../shared/reconConfig";

export type ReconPack = {
  area: string;
  label: string;
  match_rate: number;
  matched: number;
  unmatched: number;
  variance: number;
  leakage: number;
  exception_count?: number;
  rows_count?: number;
  rows_leakage?: number;
  total_items?: number;
  top_leakage_sum?: number;
  rule_version?: number;
  match_thresholds?: { match_good: number; match_watch: number };
  matching_keys?: string[];
  within_tolerance?: { n: number; leakage: number; by_rule?: Record<string, number> };
  top_exceptions: {
    exception_id: string;
    category: string;
    status: string;
    leakage: number;
    severity: string;
    merchant_id: string | null;
    ref: string;
  }[];
};

/** Thresholds come from the active rule config (defaults 0.98 / 0.90) so the label is reproducible. */
export function matchQualityOf(rate: number, g = DEFAULT_RECON_CONFIG.global): "good" | "watch" | "poor" {
  return matchQualityWith(rate, g);
}

function pct2(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function human(cat: string): string {
  return String(cat || "exception").replace(/_/g, " ");
}

type Check = { check: string; passed: boolean; detail: string };

/**
 * Confidence is derived from reconciliation self-checks, not from the model:
 * 95 when the summary and the exception rows agree, minus 10 per failed check,
 * floor 50. It says how far the figures agree with each other, not how likely a cause is.
 */
export function reconChecks(p: ReconPack): { checks: Check[]; confidence: number } {
  const checks: Check[] = [];
  const total = p.total_items ?? p.matched + p.unmatched + p.variance;
  if (total > 0) {
    const implied = p.matched / total;
    checks.push({
      check: "match rate equals matched / (matched + unmatched + variance)",
      passed: Math.abs(implied - p.match_rate) <= 0.0001,
      detail: `${p.matched} / ${total} = ${pct2(implied)} vs reported ${pct2(p.match_rate)}`,
    });
  }
  if (p.rows_leakage != null) {
    const diff = Math.round((p.leakage - p.rows_leakage) * 100) / 100;
    checks.push({
      check: "area leakage equals the sum of its exception rows",
      passed: Math.abs(diff) <= 0.05,
      detail: `summary leakage ${inrExact(p.leakage)} vs exception rows ${inrExact(p.rows_leakage)}`,
    });
  }
  if (p.rows_count != null && p.exception_count != null) {
    checks.push({
      check: "exception count equals the number of exception rows",
      passed: p.rows_count === p.exception_count,
      detail: `summary count ${p.exception_count} vs ${p.rows_count} exception rows`,
    });
  }
  const listed = p.top_leakage_sum ?? p.top_exceptions.reduce((s, e) => s + Number(e.leakage || 0), 0);
  checks.push({
    check: "listed gaps do not exceed area leakage",
    passed: listed <= p.leakage + 0.05,
    detail: `top ${p.top_exceptions.length} gaps ${inrExact(listed)} vs area ${inrExact(p.leakage)}`,
  });
  const failed = checks.filter((c) => !c.passed).length;
  return { checks, confidence: Math.max(50, 95 - failed * 10) };
}

export function reconTemplateOutput(
  domain: string,
  packs: ReconPack[],
  rules: { version?: number; global?: { match_good: number; match_watch: number } } = {},
): Record<string, unknown> {
  if (!packs.length) {
    return {
      domain,
      assessment: "Insufficient data: no reconciliation summary was returned for this domain.",
      match_quality: "watch",
      top_gaps: [],
      confidence: 40,
      source: "sql_template",
    };
  }
  rules = {
    version: rules.version ?? packs.find((p) => p.rule_version != null)?.rule_version,
    global: rules.global ?? packs.find((p) => p.match_thresholds)?.match_thresholds,
  };
  const sentences: string[] = [];
  const allChecks: Check[] = [];
  let conf = 95;
  for (const p of packs) {
    const total = p.total_items ?? p.matched + p.unmatched + p.variance;
    sentences.push(
      `${p.label}: match rate ${pct2(p.match_rate)} (${p.matched} matched, ${p.unmatched} unmatched, ${p.variance} with a variance, of ${total}).`,
    );
    if (p.leakage > 0) {
      sentences.push(
        `Leakage is ${inrExact(p.leakage)} across ${p.exception_count ?? p.top_exceptions.length} exceptions.`,
      );
    } else {
      sentences.push(`No leakage is booked for ${p.label}.`);
    }
    if (p.within_tolerance && p.within_tolerance.n > 0) {
      sentences.push(
        `${p.within_tolerance.n} exception rows totalling ${inrExact(p.within_tolerance.leakage)} are within the configured tolerance (rule version ${p.rule_version ?? rules.version ?? 0}) and are excluded from leakage.`,
      );
    }
    const r = reconChecks(p);
    allChecks.push(...r.checks.map((c) => ({ ...c, check: packs.length > 1 ? `${p.label}: ${c.check}` : c.check })));
    conf = Math.min(conf, r.confidence);
    const failed = r.checks.filter((c) => !c.passed);
    if (failed.length) {
      sentences.push(`Data check (does not reconcile): ${failed.map((c) => c.detail).join("; ")}.`);
    }
  }
  const gaps = packs
    .flatMap((p) => p.top_exceptions)
    .filter((e) => Number(e.leakage) > 0)
    .sort((a, b) => Number(b.leakage) - Number(a.leakage))
    .slice(0, 5)
    .map((e) => ({
      ref: e.ref,
      exception_id: e.exception_id,
      category: e.category,
      issue: human(e.category),
      merchant_id: e.merchant_id,
      amount: Number(e.leakage),
      leakage: Number(e.leakage),
      priority: e.severity,
    }));
  const top = gaps[0];
  if (top) {
    sentences.push(
      `Largest gap: ${top.issue} on ${top.ref}${top.merchant_id && top.merchant_id !== top.ref ? ` (${top.merchant_id})` : ""} at ${inrExact(top.amount)}.`,
    );
  }
  const rateMin = Math.min(...packs.map((p) => p.match_rate));
  return {
    domain,
    assessment: sentences.join(" "),
    match_quality: matchQualityOf(rateMin, rules.global),
    top_gaps: gaps,
    recommended_focus: top
      ? `Recommendation: start with ${top.issue} on ${top.ref}, the largest open item at ${inrExact(top.amount)}.`
      : "Recommendation: no open leakage; keep the daily match-rate check.",
    checks: allChecks,
    confidence: conf,
    confidence_basis: "Derived from reconciliation self-checks on the SQL figures (95 when all agree, minus 10 per failed check).",
    source: "sql_template",
    ...(rules.version != null ? { rule_version: rules.version } : {}),
  };
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Post-check for model-written recon output: drop gaps and sentences whose
 * numbers, IDs or entities are not in the context, then fill any emptied field
 * from the SQL template. Tagged Recommendation:/Hypothesis: sentences are kept.
 */
export function pruneUncitedRecon(
  output: Record<string, unknown>,
  context: string,
  template: Record<string, unknown>,
): { output: Record<string, unknown>; removed: string[] } {
  const removed: string[] = [];
  const next: Record<string, unknown> = { ...output };
  for (const key of ["assessment", "recommended_focus"]) {
    const v = next[key];
    if (typeof v !== "string") continue;
    const kept = splitSentences(v).filter((s) => {
      if (SENTENCE_TAG_RE.test(s)) return true;
      const ok = checkGrounding({ s }, context).passed;
      if (!ok) removed.push(`${key}: ${s}`);
      return ok;
    });
    next[key] = kept.join(" ");
  }
  if (Array.isArray(next.top_gaps)) {
    next.top_gaps = (next.top_gaps as unknown[]).filter((g) => {
      const ok = checkGrounding(g, context).passed;
      if (!ok) removed.push(`top_gaps: ${JSON.stringify(g)}`);
      return ok;
    });
  }
  if (!next.assessment) next.assessment = template.assessment;
  if (!Array.isArray(next.top_gaps) || !(next.top_gaps as unknown[]).length) next.top_gaps = template.top_gaps;
  if (!next.recommended_focus) next.recommended_focus = template.recommended_focus;
  next.match_quality = template.match_quality;
  next.confidence = template.confidence;
  next.checks = template.checks;
  return { output: next, removed };
}
