#!/usr/bin/env node
/** Export feature tables via the Neon HTTP driver (port 5432 may be blocked). Never prints secrets. */
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";

const urlFile = process.env.DATABASE_URL_FILE || "/workspace/secrets/neon_database_url";
const url = (process.env.DATABASE_URL || process.env.REGRESSION_DATABASE_URL || fs.readFileSync(urlFile, "utf8")).trim();
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const outDir = process.argv[2] || process.env.RA_ML_DATA || "/tmp/ra-ml-data";
fs.mkdirSync(outDir, { recursive: true });
const sql = neon(url);

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

const queries = {
  ra_feat_auth: "SELECT * FROM ra_feat_auth",
  ra_feat_settlement: "SELECT * FROM ra_feat_settlement",
  ra_feat_fx: "SELECT * FROM ra_feat_fx",
  ra_chargebacks: `SELECT cb.cb_id, cb.capture_id, cb.amount AS cb_amount, cb.recovered, cb.reason, c.auth_id
                   FROM ra_chargebacks cb JOIN ra_captures c ON c.capture_id = cb.capture_id`,
  ra_risk_entities: "SELECT entity_id, entity_type, merchant_id, risk_score, is_known_bad FROM ra_risk_entities",
  ra_risk_edges: "SELECT src, dst, rel, weight FROM ra_risk_edges",
  ra_captures: "SELECT capture_id, auth_id FROM ra_captures",
};

for (const [name, q] of Object.entries(queries)) {
  const res = await sql.query(q, []);
  const rows = Array.isArray(res) ? res : (res.rows || []);
  fs.writeFileSync(path.join(outDir, name + ".csv"), toCsv(rows));
  console.log(name, rows.length);
}
console.log("EXPORT_OK", outDir);
