/**
 * Every built-in Ask template must pass the same allow-list validator the Worker
 * runs before execution (a template on a raw table is rejected live).
 * Optional: ASK_DATABASE_URL_FILE runs each template SQL as ra_readonly on that branch.
 */
import { readFileSync } from "node:fs";
import { matchAskTemplate } from "../worker/askTemplates";

const QUESTIONS = [
  "Top 5 merchants by leakage", "Total scheme leakage in October", "Which acquirer has the lowest success rate",
  "Show unmatched bank transactions above ₹10,000", "FX markup by currency", "Which domains have the most leakage?",
  "Show unapplied contract rebate exceptions", "List open cases with leakage over 10000", "What is the total book leakage",
  "Approval rate by scheme",
];

import { validateAskSql } from "../worker/askSql";

let failed = 0;
const file = process.env.ASK_DATABASE_URL_FILE;
const sql = file ? (await import("@neondatabase/serverless")).neon(readFileSync(file, "utf8").trim()) : null;
for (const q of QUESTIONS) {
  const hit = matchAskTemplate(q);
  if (!hit) { console.log(`FAIL no template: ${q}`); failed++; continue; }
  try {
    const checked = validateAskSql(hit.sql);
    if (sql) {
      const [, rows] = await sql.transaction([sql`SET LOCAL ROLE ra_readonly`, sql.query(checked, [])]);
      console.log(`ok ${q} (${(rows as unknown[]).length} rows as ra_readonly)`);
    } else console.log(`ok ${q}`);
  } catch (e) {
    console.log(`FAIL ${q}: ${(e as Error).message}`); failed++;
  }
}
if (failed) throw new Error(`${failed} Ask template(s) failed`);
console.log(`ask templates: ${QUESTIONS.length}/${QUESTIONS.length} pass`);
