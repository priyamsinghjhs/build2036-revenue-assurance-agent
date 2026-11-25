/**
 * Run the auditor skeleton+finalize against live exception facts and score
 * faithfulness with the current grounding checker. No Workers AI calls.
 *
 * Usage: DATABASE_URL_FILE=... FRESH_OUT=/workspace/verify/v13-auditor-fresh-before.json \
 *        FRESH_LABEL=before npx tsx scripts/fresh-auditor-eval.ts
 * Never prints the database URL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { compactContext } from "../worker/compact";
import { checkGrounding } from "../worker/grounding";
import { finalizeAuditorOutput } from "../worker/auditor";

const file = process.env.DATABASE_URL_FILE || "";
if (!file && !process.env.DATABASE_URL) throw new Error("Set DATABASE_URL_FILE or DATABASE_URL");
const url = process.env.DATABASE_URL || readFileSync(file, "utf8").trim();
const sql = neon(url, { fetchOptions: { timeout: 120000 } });
const LABEL = process.env.FRESH_LABEL || "fresh";
const LIMIT = Number(process.env.FRESH_LIMIT || 36);

type Ex = Record<string, unknown>;

async function loadSample(): Promise<Ex[]> {
  const preferred = (await sql.query(
    `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
            area||':'||category||':'||ref_id AS exception_id
       FROM ra_exception_rows
      WHERE category IN ('under_payout','over_payout')
         OR area IN ('authorization','scheme','false_declines','chargebacks','files','aml','payouts','settlement','funding')
      ORDER BY area, category, ref_id`,
    [],
  )) as Ex[];
  const seen = new Set<string>();
  const out: Ex[] = [];
  const take = (rows: Ex[], perArea = 4) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const id = String(r.exception_id);
      if (seen.has(id)) continue;
      const area = String(r.area);
      const n = counts.get(area) || 0;
      if (n >= perArea) continue;
      counts.set(area, n + 1);
      seen.add(id);
      out.push(r);
      if (out.length >= LIMIT) break;
    }
  };
  take(preferred, 5);
  if (out.length < LIMIT) {
    const rest = (await sql.query(
      `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
              area||':'||category||':'||ref_id AS exception_id
         FROM ra_exception_rows
        ORDER BY leakage DESC NULLS LAST, area, ref_id`,
      [],
    )) as Ex[];
    take(rest, 3);
  }
  return out.slice(0, LIMIT);
}

function investigatorPrior(ex: Ex) {
  return {
    agent: "investigator",
    output: {
      root_cause: `Variance on ${ex.exception_id} at ${ex.merchant_id ?? "merchant"}, leakage ${ex.leakage ?? 0}`,
      evidence: [ex.ref_id, ex.exception_id, ex.merchant_id].filter(Boolean),
      affected: ex.merchant_id ?? ex.ref_id,
      confidence: 70,
    },
  };
}

async function main() {
  const rows = await loadSample();
  const results: Record<string, unknown>[] = [];
  let faithSum = 0;
  let fail = 0;
  let unverified = 0;
  for (const ex of rows) {
    const input = {
      task: "Investigate this single exception.",
      exception: ex,
    };
    const priors = [investigatorPrior(ex)];
    const output = finalizeAuditorOutput({ parse_error: true, source: "deterministic" }, input, priors);
    const context = compactContext({ input, prior_agents: priors }, 4000, "INPUT");
    const g = checkGrounding(output, context);
    faithSum += g.faithfulness;
    if (!g.passed) fail += 1;
    results.push({
      exception_id: ex.exception_id,
      area: ex.area,
      category: ex.category,
      verdict: output.verdict,
      source: output.source,
      faithfulness: Math.round(g.faithfulness * 10000) / 10000,
      claims: g.claims,
      supported: g.supported,
      passed: g.passed,
      unsupported: g.unsupported.slice(0, 8),
    });
  }
  const n = rows.length;
  const faithfulness = n ? Math.round((faithSum / n) * 10000) / 10000 : 1;
  const report = {
    label: LABEL,
    n,
    faithfulness,
    hallucination: Math.round((1 - faithfulness) * 10000) / 10000,
    grounding_failed: fail,
    unverified,
    sample: results,
  };
  const outPath = process.env.FRESH_OUT || `/workspace/verify/v13-auditor-fresh-${LABEL}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    label: LABEL,
    n,
    faithfulness,
    hallucination: report.hallucination,
    grounding_failed: fail,
    unverified,
    failed_ids: results.filter((r) => !r.passed).map((r) => ({ id: r.exception_id, uns: r.unsupported })),
  }, null, 2));
}

await main();
