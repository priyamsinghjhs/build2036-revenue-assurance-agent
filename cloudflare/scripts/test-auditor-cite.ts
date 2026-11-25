import { buildAuditorSkeleton, finalizeAuditorOutput, citeOrTagSentence, buildEvidencePack, packCitation } from "../worker/auditor";
import { checkGrounding } from "../worker/grounding";
import { compactContext } from "../worker/compact";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

const exception = {
  exception_id: "payouts:under_payout:PAY-MER002-2026-10",
  area: "payouts",
  category: "under_payout",
  ref_id: "PAY-MER002-2026-10",
  merchant_id: "MER002",
  expected_amount: 647368.44,
  actual_amount: 627947.34,
  leakage: 19421.10,
};
const input = { task: "Investigate this single exception.", exception };
const priors = [{
  agent: "investigator",
  output: {
    root_cause: "missing scheme settlement on PAY-MER002-2026-10 at MER002, leakage 19421.10",
    evidence: ["PAY-MER002-2026-10", "MER002"],
    confidence: 70,
  },
}];

const pack = buildEvidencePack(input, priors);
eq(packCitation(pack).includes("19,421.10"), true, "pack citation includes leakage");
eq(packCitation(pack).includes("PAY-MER002-2026-10"), true, "pack citation includes ref");

const hyp = citeOrTagSentence("An incorrect reserves calculation may explain the shortfall.", pack);
if (!hyp.startsWith("Hypothesis:")) throw new Error(`expected Hypothesis tag, got ${hyp}`);
if (!hyp.includes("19,421.10") && !hyp.includes("19421.10") && !hyp.includes("PAY-MER002")) {
  throw new Error(`hypothesis should cite the figure: ${hyp}`);
}

const skel = buildAuditorSkeleton(input, priors);
const reserve = skel.suggestions.find((s) => /reserve/i.test(s.title + s.rationale));
if (!reserve) throw new Error("expected reserve suggestion");
if (!/^Hypothesis:/i.test(reserve.rationale)) throw new Error(`reserve advice should be Hypothesis:, got ${reserve.rationale}`);
if (!reserve.rationale.includes("19,421.10") && !reserve.rationale.includes("19421.10")) {
  throw new Error(`reserve advice must cite leakage: ${reserve.rationale}`);
}
const next = skel.suggestions.find((s) => /next payout/i.test(s.title + s.rationale));
if (!next) throw new Error("expected next-payout suggestion");
if (!/^Recommendation:/i.test(next.rationale)) throw new Error(`next payout should be Recommendation:, got ${next.rationale}`);

const context = compactContext({ input, prior_agents: priors }, 4000, "INPUT");
const g = checkGrounding(skel, context);
eq(g.passed, true, "skeleton must be fully grounded after cite-or-tag");

const dirty = finalizeAuditorOutput({
  verdict: "needs_review",
  checks: [
    { name: "amount_reconciliation", result: "fail", evidence: "The shortfall is 36144.56 and also 636145.", source: "model" },
    { name: "evidence_completeness", result: "pass", evidence: "Investigator evidence is present for PAY-MER002-2026-10.", source: "input" },
    { name: "policy_compliance", result: "fail", evidence: "Payout does not equal expected net.", source: "policy" },
    { name: "duplicate_prior_case", result: "pass", evidence: "No prior linked case was present in the input; no duplicate was asserted.", source: "cases" },
    { name: "segregation_of_duties", result: "pass", evidence: "Suggestions stay in the in-app Action Queue or as drafts.", source: "policy" },
    { name: "grounding", result: "pass", evidence: "All cited numbers and IDs are present in the SQL facts.", source: "grounding" },
  ],
  findings: [{ issue: "under payout on PAY-MER002-2026-10 at MER002", severity: "high", impact: 19421.10 }],
  suggestions: [
    { suggestion_id: "sug-1", action: "recover", title: "Recover the shortfall", owner_team: "Treasury", priority: "high", expected_recovery: 19421.10, maps_to: "action_queue", rationale: "Recover the leakage." },
  ],
  confidence: 70,
  rationale: "The merchant underpaid by 36144.56 according to an unofficial worksheet.",
  cfo_one_liner: "Auditor needs review on PAY-MER002-2026-10 / MER002, leakage 19421.10.",
  source: "llm",
}, input, priors);

const g2 = checkGrounding(dirty, context);
eq(g2.passed, true, "finalize must cite or tag invented LLM figures so faithfulness stays 1");
if (/36144\.56/.test(JSON.stringify(dirty.rationale) + JSON.stringify(dirty.checks)) && !/Hypothesis:|Recommendation:/.test(JSON.stringify(dirty))) {
  throw new Error("invented 36144.56 must be tagged if it is kept");
}
const recover = dirty.suggestions.find((s) => s.action === "recover" && s.kind === "fact") || dirty.suggestions[0];
if (!/19,421\.10|19421/.test(recover.rationale + recover.title + (recover.citation || ""))) {
  throw new Error(`fact recover advice must cite leakage, got ${recover.rationale}`);
}

console.log("test-auditor-cite ok");
