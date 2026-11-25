/**
 * Recon rule config: defaults reproduce the pre-config results exactly,
 * validation rejects bad input, tolerances clear only what they should, and
 * the template stays grounded and self-consistent after a tolerance applies.
 * Usage: npx tsx scripts/test-recon-config.ts
 */
import { applyRuleTolerances, mapException, type AgentDomainSummary } from "../worker/recon";
import { reconChecks, reconTemplateOutput, type ReconPack } from "../worker/reconNarrative";
import { checkGrounding } from "../worker/grounding";
import {
  DEFAULT_RECON_CONFIG,
  diffReconConfig,
  validateReconConfig,
  withinTolerance,
  hasActiveTolerance,
} from "../shared/reconConfig";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Defaults validate and round-trip unchanged.
const v = validateReconConfig(DEFAULT_RECON_CONFIG);
assert(v.ok, "defaults validate");
assert(v.ok && diffReconConfig(DEFAULT_RECON_CONFIG, v.config).length === 0, "defaults round-trip");
for (const a of Object.values(DEFAULT_RECON_CONFIG.areas)) assert(!hasActiveTolerance(a), "default tolerances are inactive");

// Validation.
const bad = validateReconConfig({ global: { match_good: 0.8, match_watch: 0.9 }, areas: { scheme: { amount_tolerance: -1, matching_keys: ["drop table"] }, nope: {} } });
assert(!bad.ok && bad.errors.length >= 4, `bad config rejected: ${JSON.stringify(!bad.ok && bad.errors)}`);
const big = validateReconConfig({ areas: { gl: { ...DEFAULT_RECON_CONFIG.areas.gl, date_window_days: 2.5 } } });
assert(!big.ok, "fractional date window rejected");

// Raw rows shaped like ra_exception_rows.
const raw = [
  { ref_id: "A1", area: "apm", status: "unmatched", category: "apm_report_mismatch", merchant_id: "M1", ts: "2026-10-30", expected_amount: 1000, actual_amount: 0, leakage: 14135.2, recon_ref: null, method: "UPI", scheme: null, currency: "INR" },
  { ref_id: "A2", area: "apm", status: "variance", category: "apm_fee_variance", merchant_id: "M2", ts: "2026-10-29", expected_amount: 20000, actual_amount: 19990, leakage: 10, recon_ref: null, method: "UPI", scheme: null, currency: "INR" },
  { ref_id: "A3", area: "apm", status: "variance", category: "apm_report_mismatch", merchant_id: "M3", ts: "2026-10-01", expected_amount: 0, actual_amount: 0, leakage: 0, recon_ref: null, method: "UPI", scheme: null, currency: "INR" },
  { ref_id: "A4", area: "apm", status: "unmatched", category: "apm_report_mismatch", merchant_id: "M4", ts: "2026-10-02", expected_amount: 500, actual_amount: 600, leakage: -100, recon_ref: null, method: "UPI", scheme: null, currency: "INR" },
  { ref_id: "A5", area: "apm", status: "variance", category: "apm_fx_markup", merchant_id: "M5", ts: "2026-10-03", expected_amount: 100000, actual_amount: 99950, leakage: 50, recon_ref: null, method: "UPI", scheme: null, currency: "USD" },
];
const rows = raw.map((r) => mapException(r));
const sum = Math.round(rows.reduce((s, r) => s + r.leakage, 0) * 100) / 100;
const pack = {
  area: "apm",
  label: "APM",
  match_rate: Number((95 / 100).toFixed(4)),
  matched: 95,
  unmatched: 2,
  variance: 3,
  leakage: sum,
  exception_count: rows.length,
  rows_count: rows.length,
  rows_leakage: sum,
  total_items: 100,
  top_leakage_sum: sum,
  top_exceptions: rows
    .slice()
    .sort((a, b) => b.leakage - a.leakage)
    .map((e) => ({ exception_id: e.exception_id, category: e.category, status: e.status, leakage: e.leakage, severity: e.severity, merchant_id: e.merchant_id, ref: e.recon_ref || e.ref_id })),
} as AgentDomainSummary;

// 1) Defaults: identical pack and identical template output.
const same = applyRuleTolerances(pack, rows, DEFAULT_RECON_CONFIG.areas.apm);
assert(same === pack, "defaults leave the pack untouched (same object)");
const before = reconTemplateOutput("apm", [pack as ReconPack]);
const after = reconTemplateOutput("apm", [same as ReconPack], { version: 1, global: DEFAULT_RECON_CONFIG.global });
for (const k of ["assessment", "match_quality", "confidence", "recommended_focus"]) {
  assert(JSON.stringify(before[k]) === JSON.stringify(after[k]), `default output field ${k} unchanged`);
}
assert(JSON.stringify(before.top_gaps) === JSON.stringify(after.top_gaps), "default top_gaps unchanged");

// 2) withinTolerance semantics: strict "<", zero never clears, negative rows use |leakage|.
const cfg = { ...DEFAULT_RECON_CONFIG.areas.apm, amount_tolerance: 20 };
assert(withinTolerance(rows[1], cfg) === "amount_tolerance", "10 < 20 cleared");
assert(withinTolerance(rows[2], cfg) === "amount_tolerance", "0 < 20 cleared");
assert(withinTolerance(rows[0], cfg) === null, "large row stays a break");
assert(withinTolerance({ category: "x", leakage: 20 }, cfg) === null, "equal to limit is not cleared");
assert(withinTolerance(rows[4], { ...DEFAULT_RECON_CONFIG.areas.apm, fx_tolerance_bps: 10 }) === "fx_tolerance_bps", "50 < 0.1% of 100000 on USD");
assert(withinTolerance(rows[1], { ...DEFAULT_RECON_CONFIG.areas.apm, fee_variance_bps: 10 }) === "fee_variance_bps", "10 < 0.1% of 20000 on fee row");
assert(withinTolerance(rows[3], { ...DEFAULT_RECON_CONFIG.areas.apm, date_window_days: 2 }, "2026-10-30") === null, "old row outside window");
assert(withinTolerance(rows[1], { ...DEFAULT_RECON_CONFIG.areas.apm, date_window_days: 2 }, "2026-10-30") === "date_window_days", "1 day old row in window");

// 3) Active tolerance: figures move consistently and the template stays grounded.
const tol = applyRuleTolerances(pack, rows, cfg);
assert(tol.within_tolerance?.n === 2 && tol.within_tolerance.leakage === 10, `2 rows / 10 cleared: ${JSON.stringify(tol.within_tolerance)}`);
assert(Math.abs(tol.leakage - (sum - 10)) < 0.001 && tol.exception_count === 3, "leakage and count reduced");
assert(tol.matched === 97 && tol.variance === 1 && tol.unmatched === 2, `counts moved: ${tol.matched}/${tol.unmatched}/${tol.variance}`);
const chk = reconChecks(tol as ReconPack);
assert(chk.checks.every((c) => c.passed), `self-checks pass after tolerance: ${JSON.stringify(chk.checks)}`);
const out = reconTemplateOutput("apm", [{ ...tol, rule_version: 2 } as ReconPack]);
assert(String(out.assessment).includes("within the configured tolerance (rule version 2)"), "tolerance sentence present");
const gr = checkGrounding(out, JSON.stringify({ summaries: [{ ...tol, rule_version: 2 }] }));
assert(gr.passed, `grounded with tolerance: ${JSON.stringify(gr.unsupported)}`);
assert(out.rule_version === 2, "rule_version on output");

// 4) Match-quality thresholds come from config.
const strict = reconTemplateOutput("apm", [{ ...pack, match_thresholds: { match_good: 0.99, match_watch: 0.96 } } as ReconPack]);
assert(strict.match_quality === "poor", `config thresholds applied: ${strict.match_quality}`);

// 5) Diff for the audit trail.
const d = diffReconConfig(DEFAULT_RECON_CONFIG, { ...DEFAULT_RECON_CONFIG, areas: { ...DEFAULT_RECON_CONFIG.areas, apm: cfg } });
assert(d.length === 1 && d[0].path === "apm.amount_tolerance" && d[0].old === 0 && d[0].new === 20, "diff old -> new");

console.log("test-recon-config: defaults reproduce results, validation, tolerances, grounding, diff ok");
