#!/usr/bin/env node
/** Import offline trainer writeback into Neon via the HTTP driver. Never prints secrets. */
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";

const urlFile = process.env.DATABASE_URL_FILE || "/workspace/secrets/neon_database_url";
const url = (process.env.DATABASE_URL || process.env.REGRESSION_DATABASE_URL || fs.readFileSync(urlFile, "utf8")).trim();
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const src = process.argv[2] || process.env.RA_ML_WRITEBACK || "/tmp/ra-ml-data/out/neon_writeback.json";
const payload = JSON.parse(fs.readFileSync(src, "utf8"));
const sql = neon(url);

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function deleteModel(modelId) {
  await sql.query("DELETE FROM ra_model_scores WHERE model_id = $1", [modelId]);
}

async function insertScores(modelId, version, rows) {
  // Keep batches small: each row carries a SHAP payload.
  for (const part of chunk(rows, 25)) {
    const packed = part.map((r) => ({
      subject_type: r.subject_type,
      subject_id: String(r.subject_id),
      model_id: modelId,
      version,
      score: Number(r.score),
      raw_score: Number(r.raw),
      base_value: Number(r.base),
      shap: r.shap || [],
      top_factors: r.top || [],
    }));
    await sql.query(
      `INSERT INTO ra_model_scores
         (subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, scored_at)
       SELECT subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, now()
       FROM jsonb_to_recordset($1::jsonb) AS t(
         subject_type text, subject_id text, model_id text, version text,
         score double precision, raw_score double precision, base_value double precision,
         shap jsonb, top_factors jsonb
       )`,
      [JSON.stringify(packed)],
    );
  }
}

async function upsertCards(cards) {
  for (const c of cards) {
    await sql.query(
      `INSERT INTO ra_model_cards
         (model_id, version, trained_at, algorithm, n_train, n_test, auc, pr_auc, notes, metrics, is_synthetic)
       VALUES ($1,$2, now(), $3,$4,$5,$6,$7,$8,$9::jsonb, 1)
       ON CONFLICT (model_id) DO UPDATE SET
         version=EXCLUDED.version, trained_at=now(), algorithm=EXCLUDED.algorithm,
         n_train=EXCLUDED.n_train, n_test=EXCLUDED.n_test, auc=EXCLUDED.auc, pr_auc=EXCLUDED.pr_auc,
         notes=EXCLUDED.notes, metrics=EXCLUDED.metrics`,
      [
        c.model_id, c.version, c.algorithm,
        c.n_train ?? null, c.n_test ?? null, c.auc ?? null, c.pr_auc ?? null,
        c.notes ?? null, JSON.stringify(c.metrics || {}),
      ],
    );
    if (c.global_shap && c.global_shap.length) {
      await sql.query("DELETE FROM ra_shap_global WHERE model_id = $1", [c.model_id]);
      for (const g of c.global_shap) {
        await sql.query(
          "INSERT INTO ra_shap_global (model_id, feature, mean_abs_shap, rank) VALUES ($1,$2,$3,$4)",
          [c.model_id, g.feature, g.mean_abs_shap, g.rank],
        );
      }
    }
  }
}

async function upsertSage(rows) {
  for (const part of chunk(rows, 44)) {
    const packed = part.map((r) => ({
      entity_id: String(r.entity_id),
      entity_type: r.entity_type ?? null,
      merchant_id: r.merchant_id ?? null,
      sage_score: Number(r.sage_score),
    }));
    await sql.query(
      `INSERT INTO ra_graph_enrichment
         (entity_id, entity_type, merchant_id, sage_score, ring_flag, shared_device_n,
          shared_account_n, loop_flag, hops, note, source, updated_at)
       SELECT t.entity_id, t.entity_type, t.merchant_id, t.sage_score,
              COALESCE(e.ring_flag, 0), COALESCE(e.shared_device_n, 0),
              COALESCE(e.shared_account_n, 0), COALESCE(e.loop_flag, 0),
              COALESCE(e.hops, 0),
              'Offline GraphSAGE-lite (numpy) enrichment. Not scored in the Worker.',
              'graphsage_offline', now()
       FROM jsonb_to_recordset($1::jsonb) AS t(
         entity_id text, entity_type text, merchant_id text, sage_score double precision
       )
       LEFT JOIN ra_graph_enrichment e ON e.entity_id = t.entity_id
       ON CONFLICT (entity_id) DO UPDATE SET
         sage_score=EXCLUDED.sage_score, source='graphsage_offline',
         note=EXCLUDED.note, updated_at=now()`,
      [JSON.stringify(packed)],
    );
  }
}

const version = payload.version || "v9.0.0";
console.log("importing writeback", path.basename(src), "version", version);
for (const [modelId, rows] of Object.entries(payload.scores || {})) {
  console.log("scores", modelId, (rows || []).length);
  await deleteModel(modelId);
  await insertScores(modelId, version, rows || []);
}
await upsertCards(payload.cards || []);
await upsertSage(payload.graph_sage || []);
await sql.query("SELECT public.refresh_ra_v9()");
const kpi = await sql`SELECT false_decline_n, false_decline_recovery, chargeback_exposure, iforest_open, retry_recovered, retry_uplift, models_version FROM ra_ml_kpi WHERE id=1`;
const book = await sql`SELECT total_leakage, exception_count FROM ra_kpi_summary WHERE id=1`;
const area = await sql`SELECT area, leakage, exception_count FROM ra_area_summary WHERE area='false_declines'`;
const anom = await sql`SELECT status, count(*)::int AS n FROM ra_anomaly_events WHERE metric LIKE 'iforest%' GROUP BY status ORDER BY status`;
console.log("ml_kpi", kpi[0]);
console.log("book_kpi", book[0]);
console.log("false_declines_area", area[0]);
console.log("iforest_events", anom);
console.log("IMPORT_OK");
