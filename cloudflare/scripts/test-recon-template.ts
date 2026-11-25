/**
 * Recon template: offline unit checks plus (optionally) every recon area on a Neon
 * branch, read-only. Each template output must pass the grounding check against
 * the exact SQL pack it was built from, and the LLM post-check must strip
 * invented IDs and amounts.
 *
 * Usage: npx tsx scripts/test-recon-template.ts
 *        REGRESSION_DATABASE_URL_FILE=/workspace/secrets/neon_regression_tmp npx tsx scripts/test-recon-template.ts
 */
import { readFileSync } from "node:fs";
import { checkGrounding } from "../worker/grounding";
import { matchQualityOf, pruneUncitedRecon, reconTemplateOutput, type ReconPack } from "../worker/reconNarrative";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pack: ReconPack = {
  area: "scheme",
  label: "Scheme Settlement",
  match_rate: 0.9928,
  matched: 1526,
  unmatched: 7,
  variance: 4,
  leakage: 947962.5,
  exception_count: 11,
  rows_count: 11,
  rows_leakage: 947962.59,
  total_items: 1537,
  top_leakage_sum: 26122.52,
  top_exceptions: [
    { exception_id: "scheme:missing_scheme_settlement:CAP00241", category: "missing_scheme_settlement", status: "unmatched", leakage: 14825.07, severity: "high", merchant_id: "MER004", ref: "CAP00241" },
    { exception_id: "scheme:missing_scheme_settlement:CAP00078", category: "missing_scheme_settlement", status: "unmatched", leakage: 11297.45, severity: "high", merchant_id: "MER003", ref: "CAP00078" },
  ],
};
const ctx = JSON.stringify({ summaries: [pack] });
const out = reconTemplateOutput("scheme", [pack]);
const g = checkGrounding(out, ctx);
assert(g.passed, `template must be grounded: ${JSON.stringify(g.unsupported)}`);
assert(String(out.assessment).includes("₹9,47,962.50"), "Indian-grouped lakh amount is cited");
assert(out.match_quality === "good", "0.9928 is good");
assert(out.confidence === 85, `row-sum mismatch of ₹0.09 lowers confidence to 85, got ${out.confidence}`);
assert(String(out.assessment).includes("Data check (does not reconcile):"), "failed check is stated, not hidden");
assert(String(out.recommended_focus).startsWith("Recommendation:"), "advice is tagged");
assert(matchQualityOf(0.95) === "watch" && matchQualityOf(0.85) === "poor", "thresholds");

const empty = reconTemplateOutput("gl", []);
assert(/insufficient data/i.test(String(empty.assessment)), "no pack -> insufficient data");

// Post-check removes an invented gap and an uncited sentence, keeps tagged advice.
const llm = {
  domain: "scheme",
  assessment: "Scheme Settlement has a 99.28% match rate. A missing file REF20261005 caused 50000.55 of loss.",
  top_gaps: [
    { ref: "CAP00241", issue: "missing", amount: 14825.07, priority: "high" },
    { ref: "INV-MER007-2026-10", issue: "invented", amount: 10146.4, priority: "high" },
  ],
  recommended_focus: "Recommendation: chase the scheme for CAP00241.",
};
const pruned = pruneUncitedRecon(llm, ctx, out);
assert(pruned.removed.length === 2, `expected 2 removals, got ${JSON.stringify(pruned.removed)}`);
assert(checkGrounding(pruned.output, ctx).passed, "pruned output is grounded");
assert((pruned.output.top_gaps as unknown[]).length === 1, "invented gap dropped");

let live = 0;
const file = process.env.REGRESSION_DATABASE_URL_FILE;
if (file) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(readFileSync(file, "utf8").trim());
  const areas = (await sql.query("SELECT area FROM ra_area_summary ORDER BY area", [])) as { area: string }[];
  const { domainSummaryForAgent } = await import("../worker/recon");
  const db = {
    prepare(q: string) {
      let args: unknown[] = [];
      const text = () => { let i = 0; return q.replace(/\?/g, () => `$${++i}`); };
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async all<T>() { return { results: (await sql.query(text(), args)) as T[] }; },
        async first<T>() { const r = (await sql.query(text(), args)) as T[]; return r[0] ?? null; },
        async run() { await sql.query(text(), args); return {}; },
      };
      return stmt;
    },
  };
  for (const { area } of areas) {
    const p = await domainSummaryForAgent(db as never, area as never);
    const o = reconTemplateOutput(area, [p as ReconPack]);
    const gr = checkGrounding(o, JSON.stringify({ task: "x", summaries: [p] }));
    assert(gr.passed, `${area}: ${JSON.stringify(gr.unsupported)}`);
    console.log(`${area.padEnd(16)} faithfulness ${gr.faithfulness.toFixed(3)} claims ${gr.claims} conf ${o.confidence} ${o.match_quality}`);
    live += 1;
  }
}
console.log(`recon template tests passed (${live} live areas)`);
