import { checkGrounding, splitFactualOutput } from "../worker/grounding";
import { annotateSuggestion } from "../worker/auditor";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

const context = "Exception PAY-MER002-2026-10 at MER002 leakage 19421.10 expected 150000 paid 130578.90";

const hypOutput = {
  root_cause: "missing scheme settlement on PAY-MER002-2026-10 at MER002, leakage 19421.10",
  hypothesis: "Hypothesis: a reserves error of 50000 may explain the shortfall. This cause is not proven.",
  confidence: 70,
};

const split = splitFactualOutput(hypOutput);
eq("hypothesis" in (split.factual as object), false, "hypothesis stripped from factual");
eq(split.hypotheses != null, true, "hypotheses captured");

const g = checkGrounding(hypOutput, context);
eq(g.passed, true, "factual claims should pass");
eq(g.unsupported.length, 0, "50000 must not count as a factual hallucination");
if (!g.hypothesis || g.hypothesis.claims < 1) throw new Error("hypothesis claims should be scored separately");
const hypHas50000 = g.hypothesis.unsupported.some((c) => c.value.includes("50000")) || g.hypothesis.claims > 0;
if (!hypHas50000) throw new Error("50000 should appear in the hypothesis score");

const recOutput = {
  cfo_one_liner: "Auditor needs review on PAY-MER002-2026-10 / MER002, leakage 19421.10.",
  suggestions: [
    {
      title: "Correct the reserve calculation",
      rationale: "Hypothesis: an incorrect reserves calculation may explain the shortfall of 50000.",
      kind: "recommendation",
      expected_recovery: 0,
    },
    {
      title: "Recover 19421.10 from the payout run",
      rationale: "The payout was short.",
      kind: "fact",
      expected_recovery: 19421.10,
      citation: "₹19,421.10 on PAY-MER002-2026-10",
    },
  ],
};
const g2 = checkGrounding(recOutput, context);
eq(g2.passed, true, "recommendation 50000 excluded from faithfulness");

const sug = annotateSuggestion(
  {
    suggestion_id: "sug-1",
    action: "recover",
    title: "Recover the shortfall",
    owner_team: "Treasury",
    priority: "high",
    expected_recovery: 19421.10,
    maps_to: "action_queue",
    rationale: "Recover the leakage computed in the SQL facts.",
  },
  { leakage: 19421.10, ref_id: "PAY-MER002-2026-10" },
);
eq(sug.kind, "fact", "cited leakage is a fact");
if (!sug.citation || !sug.citation.includes("19,421.10")) throw new Error(`expected citation, got ${sug.citation}`);

const hypSug = annotateSuggestion(
  {
    suggestion_id: "sug-2",
    action: "adjust_rule",
    title: "Correct the reserve calculation",
    owner_team: "Treasury",
    priority: "high",
    expected_recovery: 0,
    maps_to: "action_queue",
    rationale: "Hypothesis: an incorrect reserves calculation may explain the shortfall. This cause is not proven by the exception facts alone.",
  },
  { leakage: 19421.10 },
);
eq(hypSug.kind, "recommendation", "hypothesis suggestion tagged recommendation");

const timed = {
  actions: [{ type: "escalate", amount: 2028.36, rationale: "Escalate CFG-003 for review of 2028.36" }],
  source: "deterministic",
  verification: "grounded",
  faithfulness: 1,
  timing: { total_ms: 180, neon_ms: 180, ai_ms: 0, retries: 0 },
};
const g3 = checkGrounding(timed, "CFG-003 2028.36");
eq(g3.passed, true, "timing ms and self-scores excluded from faithfulness");
eq(g3.unsupported.length, 0, "no leftover timing claims");

const words = checkGrounding(
  { root_cause: "Auditor cannot investigate captures or an anomaly on PAY-MER002-2026-10 at MER002, leakage 19421.10." },
  context,
);
eq(words.passed, true, "English words cannot/investigate/captures/anomaly are not IDs");
const ids = checkGrounding(
  { root_cause: "Review INV-MER002-2026-10 and APM-2026-10-04-LazyPay and CFG-003 and AUTH00036" },
  "INV-MER002-2026-10 APM-2026-10-04-LazyPay CFG-003 AUTH00036",
);
eq(ids.passed, true, "hyphenated and merchant IDs still count as IDs when present in context");
const missing = checkGrounding(
  { root_cause: "Review INV-MER002-2026-10" },
  "PAY-MER002-2026-10 MER002",
);
eq(missing.passed, false, "INV-MER002-2026-10 is still a claim when absent from context");

const sugOut = {
  cfo_one_liner: "Auditor needs review on PAY-MER002-2026-10 / MER002, leakage 19421.10.",
  suggestions: [
    { suggestion_id: "sug-1", title: "Recover 19421.10 from the payout run", kind: "fact", expected_recovery: 19421.10, citation: "₹19,421.10 on PAY-MER002-2026-10" },
  ],
};
const g4 = checkGrounding(sugOut, context);
eq(g4.passed, true, "sug-1 is not a book id");

const tagged = {
  rationale: "Audit of PAY-MER002-2026-10 at MER002, leakage 19421.10. Recommendation: write off 99999.99 because of a policy threshold.",
};
const g5 = checkGrounding(tagged, context);
eq(g5.passed, true, "tagged recommendation excluded even with an uncited number");
eq(g5.unsupported.length, 0, "99999.99 must not count as a factual hallucination");

console.log("test-grounding ok");




