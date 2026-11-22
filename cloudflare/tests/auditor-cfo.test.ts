/**
 * The CFO one-liner must match the verdict. Never "ready to sign off"
 * when the verdict is needs_review or rejected.
 */
import {
  alignCfoToVerdict,
  cfoLineForVerdict,
  finalizeAuditorOutput,
  normalizeAuditorOutput,
  type AuditorOutput,
} from "../worker/auditor.ts";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function signOffOk(out: { verdict?: unknown; cfo_one_liner?: unknown }, label: string) {
  const verdict = String(out.verdict ?? "");
  const cfo = String(out.cfo_one_liner ?? "");
  const bad = (verdict === "needs_review" || verdict === "rejected") && /ready to sign off/i.test(cfo);
  check(label, !bad, `verdict=${verdict} cfo=${JSON.stringify(cfo)}`);
}

check(
  "cfoLineForVerdict needs_review",
  cfoLineForVerdict("needs_review", "CFG-003 / MER006", 2028.36) ===
    "Auditor needs review on CFG-003 / MER006, leakage 2028.36.",
);

check(
  "cfoLineForVerdict rejected",
  cfoLineForVerdict("rejected", "CFG-003", 2028.36) === "Auditor rejected CFG-003, leakage 2028.36.",
);

check(
  "cfoLineForVerdict approved",
  cfoLineForVerdict("approved", "CFG-003", 2028.36) === "Auditor is ready to sign off CFG-003, leakage 2028.36.",
);

const rewritten = alignCfoToVerdict({
  verdict: "needs_review",
  signoff: "needs_review",
  checks: [],
  findings: [],
  suggestions: [],
  confidence: 85,
  rationale: "passed",
  cfo_one_liner: "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
  schema_valid: true,
  source: "deterministic",
} as AuditorOutput);
check(
  "alignCfoToVerdict rewrites ready-to-sign-off when needs_review",
  rewritten.cfo_one_liner === "Auditor needs review on CFG-003 / MER006, leakage 2028.36.",
  rewritten.cfo_one_liner,
);
signOffOk(rewritten, "aligned needs_review line has no sign-off phrasing");

const rejected = alignCfoToVerdict({
  ...rewritten,
  verdict: "rejected",
  signoff: "rejected",
  cfo_one_liner: "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
});
check(
  "alignCfoToVerdict rewrites ready-to-sign-off when rejected",
  rejected.cfo_one_liner === "Auditor rejected CFG-003 / MER006, leakage 2028.36.",
  rejected.cfo_one_liner,
);
signOffOk(rejected, "aligned rejected line has no sign-off phrasing");

const approved = alignCfoToVerdict({
  ...rewritten,
  verdict: "approved",
  signoff: "ready",
  cfo_one_liner: "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
});
check(
  "alignCfoToVerdict leaves approved sign-off wording intact",
  approved.cfo_one_liner === "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
);

const input = {
  exception: {
    exception_id: "config:config_unapproved:CFG-003",
    ref_id: "CFG-003",
    recon_ref: "CFG-003",
    merchant_id: "MER006",
    area: "config",
    expected_amount: 0,
    actual_amount: 2028.36,
    leakage: 2028.36,
  },
};
const priors = [
  { agent: "investigator", output: { root_cause: "unapproved config change", evidence: ["CFG-003"], confidence: 80 } },
  { agent: "action", output: { actions: [{ type: "recover", amount: 2028.36 }] } },
];

// Mimic a skeleton that would approve, then a forced review (CFG-003 fallback path).
const forced = finalizeAuditorOutput({ parse_error: true, source: "deterministic" }, input, priors);
forced.verdict = "needs_review";
forced.signoff = "needs_review";
alignCfoToVerdict(forced);
signOffOk(forced, "finalize + forced needs_review (CFG-003 fallback) CFO matches verdict");
check("forced review verdict is needs_review", forced.verdict === "needs_review");
check("forced review has six checks", forced.checks.length === 6);

const normalized = normalizeAuditorOutput({
  verdict: "needs_review",
  signoff: "needs_review",
  checks: forced.checks,
  suggestions: forced.suggestions,
  cfo_one_liner: "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
  rationale: "ok",
  confidence: 85,
});
signOffOk(normalized, "normalizeAuditorOutput rewrites mismatched CFO line");

const groundedFail = finalizeAuditorOutput(
  {
    verdict: "approved",
    signoff: "ready",
    checks: forced.checks.map((c) => ({ ...c, result: "pass" })),
    suggestions: [],
    cfo_one_liner: "Auditor is ready to sign off CFG-003 / MER006, leakage 2028.36.",
    rationale: "ok",
    confidence: 90,
  },
  input,
  priors,
  { passed: false, faithfulness: 0.2, claims: 2, supported: 0, unsupported: [{ kind: "amount", value: "99999" }] },
);
signOffOk(groundedFail, "finalizeAuditorOutput grounding-fail does not keep sign-off wording");
check("grounding-fail verdict is needs_review", groundedFail.verdict === "needs_review");


const kept = finalizeAuditorOutput(
  { ...forced, parse_error: undefined, source: "deterministic" },
  input,
  priors,
);
check("finalize keeps source deterministic when marked", kept.source === "deterministic", String(kept.source));
signOffOk(kept, "deterministic re-finalize CFO still matches verdict");

if (failures) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("auditor CFO/verdict alignment: all passed");
