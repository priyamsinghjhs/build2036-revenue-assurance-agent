/** Import GraphSAGE-lite AML scores into ra_open_aml_scores. Never prints secrets. */
import { readFileSync, existsSync } from "node:fs";
import { getSql, chunk, upsertDataset } from "./db.mjs";

const src = process.env.AML_SCORES_OUT || "/tmp/ra-open-data/aml_scores.json";
if (!existsSync(src)) {
  console.error("missing scores file");
  process.exit(1);
}
const payload = JSON.parse(readFileSync(src, "utf8"));
const sql = getSql();

await sql.query("DELETE FROM ra_open_aml_scores");
for (const part of chunk(payload.scores || [], 200)) {
  const params = [];
  const values = part.map((r, i) => {
    const o = i * 4;
    params.push(r.account_id, r.sage_score, r.is_laundering_label, r.version || payload.version);
    return `($${o + 1},$${o + 2},$${o + 3},$${o + 4}, now())`;
  });
  await sql.query(
    `INSERT INTO ra_open_aml_scores (account_id, sage_score, is_laundering_label, version, scored_at)
     VALUES ${values.join(",")}
     ON CONFLICT (account_id) DO UPDATE SET
       sage_score=EXCLUDED.sage_score,
       is_laundering_label=EXCLUDED.is_laundering_label,
       version=EXCLUDED.version,
       scored_at=now()`,
    params,
  );
}
const n = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_aml_scores"))[0].n;
const cur = await sql.query("SELECT * FROM ra_open_datasets WHERE dataset_id='ibm_aml'");
if (cur[0]) {
  const notes = `${cur[0].notes || ""} GraphSAGE-lite ${payload.version}: ${n} account scores, holdout AUC ${payload.auc ?? "n/a"}, PR-AUC ${payload.pr_auc ?? "n/a"}.`.trim();
  await upsertDataset(sql, {
    dataset_id: "ibm_aml",
    title: cur[0].title,
    source_name: cur[0].source_name,
    source_url: cur[0].source_url,
    license: cur[0].license,
    license_url: cur[0].license_url,
    attribution: cur[0].attribution,
    notes,
    row_count: cur[0].row_count,
    bytes_estimate: cur[0].bytes_estimate,
  });
}
await upsertDataset(sql, {
  dataset_id: "ibm_aml_scores",
  title: "GraphSAGE-lite scores on the IBM AML slice",
  source_name: "Offline GraphSAGE-lite (numpy)",
  source_url: cur[0]?.source_url,
  license: "CDLA-Sharing-1.0 (scores derived from the IBM AML slice)",
  license_url: "https://cdla.dev/sharing-1-0/",
  attribution: "Scores derived from the IBM Transactions for Anti Money Laundering dataset (CDLA-Sharing-1.0). Exposure only; not booked as INR leakage.",
  notes: payload.note,
  row_count: n,
});
console.log("aml_scores_imported", n, "auc", payload.auc, "pr_auc", payload.pr_auc);
