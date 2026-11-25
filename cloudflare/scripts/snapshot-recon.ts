/**
 * Snapshot every recon area's SQL pack and template output on a Neon branch (read-only),
 * so the figures before and after a rule-config change can be diffed.
 * Usage: REGRESSION_DATABASE_URL_FILE=<file> npx tsx scripts/snapshot-recon.ts out.json
 * Never prints the connection string.
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.REGRESSION_DATABASE_URL_FILE;
if (!file) throw new Error("REGRESSION_DATABASE_URL_FILE is required");
const { neon } = await import("@neondatabase/serverless");
const sql = neon(readFileSync(file, "utf8").trim());
const { domainSummaryForAgent } = await import("../worker/recon");
const { reconTemplateOutput } = await import("../worker/reconNarrative");
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
const areas = (await sql.query("SELECT area FROM ra_area_summary ORDER BY area", [])) as { area: string }[];
const out: Record<string, unknown> = {};
for (const { area } of areas) {
  const p = (await domainSummaryForAgent(db as never, area as never)) as Record<string, unknown>;
  const o = reconTemplateOutput(area, [p as never]) as Record<string, unknown>;
  const { rule_version: _a, match_thresholds: _b, matching_keys: _c, ...figures } = p;
  out[area] = {
    figures,
    assessment: o.assessment,
    match_quality: o.match_quality,
    confidence: o.confidence,
    top_gaps: o.top_gaps,
    recommended_focus: o.recommended_focus,
    rule_version: p.rule_version ?? null,
  };
}
writeFileSync(process.argv[2] || "recon-snapshot.json", JSON.stringify(out, null, 2));
console.log(`snapshot: ${areas.length} areas`);
