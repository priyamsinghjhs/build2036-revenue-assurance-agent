/**
 * Archive current ra_eval_scores, then re-score every row with the current
 * deterministic grounding checker. Never deletes original scores.
 *
 * Usage: DATABASE_URL_FILE=/workspace/secrets/neon_database_url \
 *        npx tsx scripts/rescore-eval.ts
 * Optional: RESCORE_LABEL=ta13-grounding-rescore-2026-11-25
 * Never prints the database URL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { checkGrounding } from "../worker/grounding";

const LABEL = process.env.RESCORE_LABEL || "ta13-grounding-rescore-2026-11-25";
const file = process.env.DATABASE_URL_FILE || process.env.REGRESSION_DATABASE_URL_FILE || "";
if (!file && !process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL_FILE or DATABASE_URL");
}
const url = process.env.DATABASE_URL || readFileSync(file, "utf8").trim();
const sql = neon(url, { fetchOptions: { timeout: 180000 } });

type ScoreRow = {
  eval_id: string;
  run_id: string;
  output_id: string;
  agent_id: string;
  faithfulness: number;
  claims: number;
  supported: number;
  retries: number;
  verification: string;
  unsupported: unknown;
  created_at: string;
  output_json: string | null;
  domain: string | null;
  scope: string | null;
};

function parseJson(raw: string | null): unknown {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function idsFrom(text: string): string[] {
  const out: string[] = [];
  const re = /\b[a-z]+(?::[a-z0-9_.:-]+){2,}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  if (text.startsWith("exception:")) out.push(text.slice("exception:".length));
  return [...new Set(out)];
}

async function factsFor(scope: string | null, output: unknown): Promise<string> {
  const blob = `${scope || ""}\n${typeof output === "string" ? output : JSON.stringify(output)}`;
  const ids = idsFrom(blob);
  const chunks: string[] = [];
  if (scope) chunks.push(`SCOPE ${scope}`);
  for (const id of ids.slice(0, 8)) {
    const parts = id.replace(/^exception:/, "").split(":");
    let rows: Record<string, unknown>[] = [];
    if (parts.length >= 3) {
      rows = await sql.query(
        `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
                area||':'||category||':'||ref_id AS exception_id
           FROM ra_exception_rows
          WHERE area=$1 AND category=$2 AND ref_id=$3
          LIMIT 1`,
        [parts[0], parts[1], parts.slice(2).join(":")],
      );
    }
    if (!rows.length) {
      const ref = parts[parts.length - 1];
      rows = await sql.query(
        `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
                area||':'||category||':'||ref_id AS exception_id
           FROM ra_exception_rows WHERE ref_id=$1 LIMIT 3`,
        [ref],
      );
    }
    for (const r of rows) chunks.push(JSON.stringify(r));
  }
  if (chunks.length <= 1) {
    const extra = await sql.query(
      `SELECT area, category, ref_id, merchant_id, expected_amount, actual_amount, leakage,
              area||':'||category||':'||ref_id AS exception_id
         FROM ra_exception_rows ORDER BY leakage DESC NULLS LAST LIMIT 5`,
      [],
    );
    // Do not add unrelated top-leakage rows — they would falsely support claims.
    void extra;
  }
  return chunks.join("\n");
}

function verificationOf(prev: string, passed: boolean, source: string | undefined): string {
  if (passed) {
    if (source === "deterministic" || prev === "deterministic_replacement") return "deterministic_replacement";
    return "grounded";
  }
  return "grounding_failed";
}

async function main() {
  const beforeAgents = await sql.query(
    `SELECT agent_id, n, faithfulness, hallucination_rate, retries, unverified FROM v_ra_eval_quality ORDER BY agent_id`,
    [],
  );
  const beforeTotals = await sql.query(
    `SELECT COUNT(*)::int AS n, ROUND(AVG(faithfulness)::numeric,4) AS faithfulness,
            ROUND((1-AVG(faithfulness))::numeric,4) AS hallucination_rate,
            COUNT(*) FILTER (WHERE verification='unverified')::int AS unverified,
            COALESCE(SUM(retries),0)::int AS retries
       FROM ra_eval_scores`,
    [],
  );

  const already = await sql.query(
    `SELECT COUNT(*)::int AS n FROM ra_eval_scores_archive WHERE archive_label=$1`,
    [LABEL],
  );
  if (!Number(already[0]?.n)) {
    await sql.query(
      `INSERT INTO ra_eval_scores_archive
         (archive_label, eval_id, run_id, output_id, agent_id, faithfulness, claims, supported, retries, verification, unsupported, created_at)
       SELECT $1, eval_id, run_id, output_id, agent_id, faithfulness, claims, supported, retries, verification, unsupported, created_at
         FROM ra_eval_scores`,
      [LABEL],
    );
  }

  const rows = (await sql.query(
    `SELECT s.eval_id, s.run_id, s.output_id, s.agent_id, s.faithfulness, s.claims, s.supported, s.retries,
            s.verification, s.unsupported, s.created_at, o.output_json, o.domain, r.scope
       FROM ra_eval_scores s
       LEFT JOIN ra_agent_outputs o ON o.output_id = s.output_id
       LEFT JOIN ra_agent_runs r ON r.run_id = s.run_id
      ORDER BY s.agent_id, s.created_at`,
    [],
  )) as ScoreRow[];

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const output = parseJson(row.output_json);
    const source = output && typeof output === "object" ? String((output as { source?: string }).source || "") : "";
    const context = await factsFor(row.scope, output);
    const grounding = checkGrounding(output, context);
    const verification = verificationOf(row.verification, grounding.passed, source);
    const faithfulness = Math.round(grounding.faithfulness * 10000) / 10000;
    await sql.query(
      `UPDATE ra_eval_scores
          SET previous_verification = COALESCE(previous_verification, verification),
              previous_faithfulness = COALESCE(previous_faithfulness, faithfulness),
              faithfulness = $1,
              claims = $2,
              supported = $3,
              verification = $4,
              unsupported = $5::jsonb,
              rescore_label = $6,
              rescored_at = now()
        WHERE eval_id = $7`,
      [
        faithfulness,
        grounding.claims,
        grounding.supported,
        verification,
        JSON.stringify(grounding.unsupported),
        LABEL,
        row.eval_id,
      ],
    );
    updated += 1;
    if (!grounding.passed) failed += 1;
  }

  const afterAgents = await sql.query(
    `SELECT agent_id, n, faithfulness, hallucination_rate, retries, unverified FROM v_ra_eval_quality ORDER BY agent_id`,
    [],
  );
  const afterTotals = await sql.query(
    `SELECT COUNT(*)::int AS n, ROUND(AVG(faithfulness)::numeric,4) AS faithfulness,
            ROUND((1-AVG(faithfulness))::numeric,4) AS hallucination_rate,
            COUNT(*) FILTER (WHERE verification='unverified')::int AS unverified,
            COUNT(*) FILTER (WHERE verification='grounding_failed')::int AS grounding_failed,
            COALESCE(SUM(retries),0)::int AS retries
       FROM ra_eval_scores`,
    [],
  );
  const byVer = await sql.query(`SELECT verification, COUNT(*)::int AS n FROM ra_eval_scores GROUP BY 1 ORDER BY 1`, []);

  const report = {
    label: LABEL,
    updated,
    failed_grounding: failed,
    before: { totals: beforeTotals[0], agents: beforeAgents },
    after: { totals: afterTotals[0], agents: afterAgents, verification: byVer },
  };
  const outPath = process.env.RESCORE_OUT || "/workspace/verify/v13-quality-after.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

await main();
