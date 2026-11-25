/**
 * Re-run finalizeAuditorOutput on stored auditor JSON (LLM and deterministic)
 * and compare grounding before vs after the cite-or-tag rewrite.
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
const sql = neon(url, { fetchOptions: { timeout: 180000 } });

function parse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { raw };
  } catch { return { raw }; }
}

async function main() {
  const exceptions = await sql.query(
    `SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
            area||':'||category||':'||ref_id AS exception_id
       FROM ra_exception_rows`,
    [],
  ) as Record<string, unknown>[];
  const byId = new Map(exceptions.map((e) => [String(e.exception_id), e]));
  const byRef = new Map<string, Record<string, unknown>>();
  for (const e of exceptions) byRef.set(String(e.ref_id), e);

  const outputs = await sql.query(
    `SELECT output_id, run_id, agent_id, output_json FROM ra_agent_outputs`,
    [],
  ) as { output_id: string; run_id: string; agent_id: string; output_json: string }[];
  const byRun = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const list = byRun.get(o.run_id) || [];
    list.push(o);
    byRun.set(o.run_id, list);
  }

  const rows = await sql.query(
    `SELECT s.eval_id, s.run_id, s.output_id, s.faithfulness AS stored_faithfulness, s.verification,
            o.output_json, r.scope
       FROM ra_eval_scores s
       JOIN ra_agent_outputs o ON o.output_id = s.output_id
       LEFT JOIN ra_agent_runs r ON r.run_id = s.run_id
      WHERE s.agent_id = 'auditor'
      ORDER BY s.created_at`,
    [],
  ) as Record<string, unknown>[];

  let beforeSum = 0, afterSum = 0, beforeFail = 0, afterFail = 0;
  const sourceCounts = { llm: 0, deterministic: 0, other: 0 };
  const samples: unknown[] = [];

  for (const row of rows) {
    const raw = parse(String(row.output_json || ""));
    const source = String(raw.source || "other");
    if (source === "llm") sourceCounts.llm += 1;
    else if (source === "deterministic") sourceCounts.deterministic += 1;
    else sourceCounts.other += 1;

    const scope = String(row.scope || "");
    let exId = "";
    if (scope.startsWith("exception:")) exId = scope.slice("exception:".length);
    const ex = (exId && byId.get(exId)) || byRef.get(exId.split(":").pop() || "") || null;
    const input = ex ? { task: "Investigate this single exception.", exception: ex } : { task: "Investigate.", scope };
    const runOutputs = byRun.get(String(row.run_id)) || [];
    const priors = runOutputs
      .filter((o) => o.output_id !== row.output_id && o.agent_id !== "auditor")
      .map((o) => ({ agent: o.agent_id, output: parse(o.output_json) }));
    const context = compactContext({ input, prior_agents: priors }, 4000, "INPUT");

    const before = checkGrounding(raw, context);
    const rewritten = finalizeAuditorOutput(raw, input, priors);
    const after = checkGrounding(rewritten, context);
    beforeSum += before.faithfulness;
    afterSum += after.faithfulness;
    if (!before.passed) beforeFail += 1;
    if (!after.passed) afterFail += 1;
    if (!after.passed || (!before.passed && after.passed) || Math.abs(after.faithfulness - before.faithfulness) > 0.05) {
      samples.push({
        eval_id: row.eval_id,
        scope,
        source,
        before: { faithfulness: Math.round(before.faithfulness * 10000) / 10000, passed: before.passed, unsupported: before.unsupported.slice(0, 6) },
        after: { faithfulness: Math.round(after.faithfulness * 10000) / 10000, passed: after.passed, unsupported: after.unsupported.slice(0, 6) },
      });
    }
  }

  const n = rows.length;
  const report = {
    n,
    sources: sourceCounts,
    before: {
      faithfulness: n ? Math.round((beforeSum / n) * 10000) / 10000 : 1,
      hallucination: n ? Math.round((1 - beforeSum / n) * 10000) / 10000 : 0,
      grounding_failed: beforeFail,
    },
    after: {
      faithfulness: n ? Math.round((afterSum / n) * 10000) / 10000 : 1,
      hallucination: n ? Math.round((1 - afterSum / n) * 10000) / 10000 : 0,
      grounding_failed: afterFail,
    },
    changed_or_failed: samples,
  };
  const outPath = process.env.FRESH_OUT || "/workspace/verify/v13-auditor-rewrite-compare.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ n, sources: sourceCounts, before: report.before, after: report.after, changed: samples.length }, null, 2));
}

await main();
