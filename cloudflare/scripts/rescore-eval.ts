/**
 * Archive current ra_eval_scores (once per label), restore that archive, then
 * re-score every row with the current deterministic grounding checker.
 * Never deletes original scores.
 *
 * Usage: DATABASE_URL_FILE=/workspace/secrets/neon_database_url \
 *        npx tsx scripts/rescore-eval.ts
 * Optional: RESCORE_LABEL=ta13-grounding-rescore-2026-11-25
 *           RESCORE_RESTORE=0  — skip restoring from archive before scoring
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

function exceptionIdsFrom(text: string): string[] {
  const out: string[] = [];
  const re = /\b[a-z]+(?::[a-z0-9_.:-]+){2,}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0].replace(/^exception:/, ""));
  return [...new Set(out)];
}

function verificationOf(prev: string, passed: boolean, source: string | undefined): string {
  if (passed) {
    if (source === "deterministic" || prev === "deterministic_replacement") return "deterministic_replacement";
    return "grounded";
  }
  return "grounding_failed";
}

type ExceptionRow = Record<string, unknown>;

async function loadUniverse() {
  const exceptions = await sql.query(
    `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
            area||':'||category||':'||ref_id AS exception_id
       FROM ra_exception_rows`,
    [],
  ) as ExceptionRow[];
  const byId = new Map<string, ExceptionRow>();
  const byRef = new Map<string, ExceptionRow[]>();
  const byArea = new Map<string, ExceptionRow[]>();
  for (const e of exceptions) {
    const id = String(e.exception_id);
    byId.set(id, e);
    const ref = String(e.ref_id);
    byRef.set(ref, [...(byRef.get(ref) || []), e]);
    const area = String(e.area);
    byArea.set(area, [...(byArea.get(area) || []), e]);
  }
  const payouts = await sql.query(`SELECT payout_id, merchant_id, amount, expected_net, payout_date FROM ra_payouts`, []);
  const areas = await sql.query(`SELECT area, label, matched, unmatched, variance, leakage, match_rate, exception_count FROM ra_area_summary`, []);
  const kpis = await sql.query(
    `SELECT public.ra_book_exception_count() AS book_exceptions,
            (SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_area_summary
              WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','files')) AS book_leakage`,
    [],
  );
  const outputs = await sql.query(
    `SELECT output_id, run_id, agent_id, domain, output_json, created_at FROM ra_agent_outputs ORDER BY created_at`,
    [],
  ) as { output_id: string; run_id: string; agent_id: string; domain: string | null; output_json: string; created_at: string }[];
  const outputsByRun = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const list = outputsByRun.get(o.run_id) || [];
    list.push(o);
    outputsByRun.set(o.run_id, list);
  }
  let policy = "";
  try {
    const pol = await sql.query(`SELECT topic, body FROM ra_policy_text`, []);
    policy = pol.map((p: Record<string, unknown>) => `${p.topic}: ${p.body}`).join("\n");
  } catch {
    try {
      const pol = await sql.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%policy%'`,
        [],
      );
      void pol;
    } catch { /* no policy table */ }
  }
  return { byId, byRef, byArea, payouts, areas, kpis: kpis[0], outputsByRun, policy };
}

function contextFor(
  row: ScoreRow,
  uni: Awaited<ReturnType<typeof loadUniverse>>,
  output: unknown,
): string {
  const chunks: string[] = [];
  if (row.scope) chunks.push(`SCOPE ${row.scope}`);
  if (row.domain) chunks.push(`DOMAIN ${row.domain}`);
  chunks.push(`KPI ${JSON.stringify(uni.kpis)}`);
  chunks.push(`AREAS ${JSON.stringify(uni.areas)}`);
  if (uni.policy) chunks.push(uni.policy.slice(0, 8000));

  const blob = `${row.scope || ""}\n${typeof output === "string" ? output : JSON.stringify(output)}`;
  const ids = exceptionIdsFrom(blob);
  if (row.scope?.startsWith("exception:")) ids.unshift(row.scope.slice("exception:".length));

  const seen = new Set<string>();
  for (const id of ids) {
    const e = uni.byId.get(id);
    if (e && !seen.has(id)) {
      seen.add(id);
      chunks.push(JSON.stringify(e));
    } else {
      const ref = id.split(":").pop() || id;
      for (const r of uni.byRef.get(ref) || []) {
        const rid = String(r.exception_id);
        if (!seen.has(rid)) {
          seen.add(rid);
          chunks.push(JSON.stringify(r));
        }
      }
    }
  }

  const areaHint = row.domain || (row.scope && row.scope.split(":")[1]) || "";
  const areasToInclude = new Set<string>();
  if (areaHint && uni.byArea.has(areaHint)) areasToInclude.add(areaHint);
  if (row.agent_id.startsWith("recon_")) {
    const map: Record<string, string[]> = {
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
      recon_acquirer: ["acquirer"],
      recon_gl: ["gl"],
      recon_funding: ["funding"],
      recon_settlement: ["settlement"],
    };
    for (const a of map[row.agent_id] || []) areasToInclude.add(a);
  }
  if (row.agent_id === "gap_detection" || row.agent_id === "orchestrator") {
    for (const a of uni.byArea.keys()) areasToInclude.add(a);
  }
  for (const area of areasToInclude) {
    const rows = uni.byArea.get(area) || [];
    for (const r of rows.slice(0, 40)) {
      const rid = String(r.exception_id);
      if (!seen.has(rid)) {
        seen.add(rid);
        chunks.push(JSON.stringify(r));
      }
    }
  }

  for (const p of uni.payouts) {
    const id = String((p as { payout_id: string }).payout_id);
    if (blob.includes(id) || ids.some((x) => x.includes(id))) chunks.push(JSON.stringify(p));
  }

  const priors = uni.outputsByRun.get(row.run_id) || [];
  for (const p of priors) {
    if (p.output_id === row.output_id) continue;
    chunks.push(`PRIOR ${p.agent_id} ${p.output_json}`);
  }
  return chunks.join("\n");
}

async function main() {
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
  } else if (process.env.RESCORE_RESTORE !== "0") {
    // Start from the archived originals so a prior incomplete rescore is not the baseline.
    await sql.query(
      `UPDATE ra_eval_scores s
          SET faithfulness = a.faithfulness,
              claims = a.claims,
              supported = a.supported,
              retries = a.retries,
              verification = a.verification,
              unsupported = a.unsupported
         FROM ra_eval_scores_archive a
        WHERE a.eval_id = s.eval_id AND a.archive_label = $1`,
      [LABEL],
    );
  }

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

  const uni = await loadUniverse();
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
    const context = contextFor(row, uni, output);
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
