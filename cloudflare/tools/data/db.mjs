/** Neon HTTP helper. Never prints or logs the connection string. */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  const file = process.env.DATABASE_URL_FILE || "/workspace/secrets/neon_database_url";
  return readFileSync(file, "utf8").trim();
}

export function getSql() {
  const url = databaseUrl();
  if (!url.startsWith("postgres")) throw new Error("DATABASE_URL is missing or malformed");
  return neon(url, { fetchOptions: { timeout: 180000 } });
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, n + i));
  return out;
}

export async function applySqlFile(sql, text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const parts = stripped
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^[\s\n]*--[^\n]*$/gm, "").trim())
    .filter((s) => s.length > 0);
  for (const stmt of parts) {
    await sql.query(stmt);
  }
}

export async function dbSize(sql) {
  const rows = await sql.query(`SELECT pg_database_size(current_database())::bigint AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty`);
  return rows[0];
}

export async function upsertDataset(sql, row) {
  await sql.query(
    `INSERT INTO ra_open_datasets
       (dataset_id, title, source_name, source_url, license, license_url, attribution, notes, row_count, bytes_estimate, loaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (dataset_id) DO UPDATE SET
       title=EXCLUDED.title, source_name=EXCLUDED.source_name, source_url=EXCLUDED.source_url,
       license=EXCLUDED.license, license_url=EXCLUDED.license_url, attribution=EXCLUDED.attribution,
       notes=EXCLUDED.notes, row_count=EXCLUDED.row_count, bytes_estimate=EXCLUDED.bytes_estimate,
       loaded_at=now()`,
    [
      row.dataset_id, row.title, row.source_name, row.source_url || null,
      row.license, row.license_url || null, row.attribution, row.notes || null,
      row.row_count ?? null, row.bytes_estimate ?? null,
    ],
  );
}
