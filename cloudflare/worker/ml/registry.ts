import type { AppDb } from "../pg";
import { scoreRow, type GbdtModel } from "../../shared/ml/trees";
export { scoreRow, explain, vectorize } from "../../shared/ml/trees";
export type { ShapFactor, GbdtModel } from "../../shared/ml/trees";
import falseDecline from "../../shared/ml/models/false_decline.json";
import chargeback from "../../shared/ml/models/chargeback.json";
import disputeWin from "../../shared/ml/models/dispute_win.json";
import iforestSettlement from "../../shared/ml/models/iforest_settlement.json";
import iforestFx from "../../shared/ml/models/iforest_fx.json";

export const BUNDLED_MODELS: Record<string, GbdtModel> = {
  false_decline: falseDecline as unknown as GbdtModel,
  chargeback: chargeback as unknown as GbdtModel,
  dispute_win: disputeWin as unknown as GbdtModel,
  iforest_settlement: iforestSettlement as unknown as GbdtModel,
  iforest_fx: iforestFx as unknown as GbdtModel,
};

export function getModel(id: string): GbdtModel | null {
  return BUNDLED_MODELS[id] ?? null;
}

export function predictFeatures(modelId: string, features: Record<string, number>) {
  const model = getModel(modelId);
  if (!model) return null;
  const ev = scoreRow(model, features);
  return {
    model_id: model.model_id,
    version: model.version,
    algorithm: model.algorithm,
    objective: model.objective,
    score: ev.score,
    raw: ev.raw_score,
    base: ev.base_value,
    shap_sum: ev.shap_sum,
    check: ev.check,
    top: ev.top_factors,
    shap: ev.shap,
  };
}

export async function modelsOverview(db: AppDb) {
  const { results: cards } = await db
    .prepare(
      `SELECT model_id, version, trained_at, algorithm, n_train, n_test, auc, pr_auc, notes, metrics, is_synthetic
       FROM ra_model_cards ORDER BY model_id`,
    )
    .all<Record<string, unknown>>();
  const { results: shap } = await db
    .prepare("SELECT model_id, feature, mean_abs_shap, rank FROM ra_shap_global ORDER BY model_id, rank")
    .all<Record<string, unknown>>();
  const kpi = await db.prepare("SELECT * FROM ra_ml_kpi WHERE id = 1").first<Record<string, unknown>>();
  const { results: retry } = await db.prepare("SELECT * FROM ra_retry_sim").all<Record<string, unknown>>();
  const { results: arms } = await db.prepare("SELECT * FROM ra_retry_sim_arms ORDER BY arm").all<Record<string, unknown>>();
  let drift: Record<string, unknown>[] = [];
  try {
    const { results } = await db
      .prepare(
        `SELECT s.model_id,
                CASE WHEN f.day <= DATE '2026-10-15' THEN 'first_half' ELSE 'second_half' END AS half,
                COUNT(*)::int AS n,
                ROUND(AVG(s.score)::numeric, 4) AS mean_score,
                ROUND(STDDEV_POP(s.score)::numeric, 4) AS std_score
         FROM ra_model_scores s
         JOIN ra_feat_auth f ON f.auth_id = s.subject_id
         WHERE s.model_id IN ('false_decline','chargeback') AND s.subject_type='auth'
         GROUP BY 1, 2
         ORDER BY 1, 2`,
      )
      .all<Record<string, unknown>>();
    drift = results ?? [];
  } catch {
    drift = [];
  }
  const shapBy: Record<string, Record<string, unknown>[]> = {};
  for (const row of shap ?? []) {
    const id = String(row.model_id);
    (shapBy[id] ??= []).push(row);
  }
  return {
    synthetic: true,
    version: kpi?.models_version ?? "untrained",
    note: "Metrics are held-out / OOF figures on the synthetic October 2026 book, not production performance. Scoring is deterministic (LightGBM / isolation forest). The LLM may only narrate stored SHAP factors. GraphSAGE-lite and the autoencoder run offline and are stored as optional enrichments. In-sample first-vs-second-half score means are a stability check, not a production drift signal.",
    kpis: kpi
      ? {
          false_decline_n: Number(kpi.false_decline_n ?? 0),
          false_decline_recovery: Number(kpi.false_decline_recovery ?? 0),
          chargeback_exposure: Number(kpi.chargeback_exposure ?? 0),
          iforest_open: Number(kpi.iforest_open ?? 0),
          retry_recovered: Number(kpi.retry_recovered ?? 0),
          retry_uplift: Number(kpi.retry_uplift ?? 0),
          models_version: String(kpi.models_version ?? "untrained"),
        }
      : null,
    cards: (cards ?? []).map((c) => ({
      ...c,
      n_train: c.n_train == null ? null : Number(c.n_train),
      n_test: c.n_test == null ? null : Number(c.n_test),
      auc: c.auc == null ? null : Number(c.auc),
      pr_auc: c.pr_auc == null ? null : Number(c.pr_auc),
      is_synthetic: Number(c.is_synthetic ?? 1),
      global_shap: shapBy[String(c.model_id)] ?? [],
    })),
    retry: { policy: (retry ?? [])[0] ?? null, arms: arms ?? [] },
    drift,
    bundled: Object.keys(BUNDLED_MODELS),
  };
}

export async function modelDetail(db: AppDb, modelId: string) {
  const [card] = (
    await db
      .prepare("SELECT * FROM ra_model_cards WHERE model_id = ?")
      .bind(modelId)
      .all<Record<string, unknown>>()
  ).results ?? [];
  if (!card && !getModel(modelId)) return null;
  const { results: shap } = await db
    .prepare("SELECT feature, mean_abs_shap, rank FROM ra_shap_global WHERE model_id = ? ORDER BY rank")
    .bind(modelId)
    .all<Record<string, unknown>>();
  const { results: top } = await db
    .prepare(
      `SELECT subject_type, subject_id, score, raw_score, base_value, top_factors, scored_at
       FROM ra_model_scores WHERE model_id = ? ORDER BY score DESC LIMIT 12`,
    )
    .bind(modelId === "iforest_settlement" || modelId === "iforest_fx" ? "iforest" : modelId)
    .all<Record<string, unknown>>();
  return {
    synthetic: true,
    card: card ?? null,
    global_shap: shap ?? [],
    top_scores: (top ?? []).map((r) => ({
      ...r,
      score: Number(r.score ?? 0),
      raw_score: Number(r.raw_score ?? 0),
      base_value: Number(r.base_value ?? 0),
    })),
    bundled: getModel(modelId) ? { version: getModel(modelId)!.version, algorithm: getModel(modelId)!.algorithm, n_trees: getModel(modelId)!.trees.length } : null,
  };
}

export async function enrichExceptions<T extends { ref_id?: string; area?: string }>(
  db: AppDb,
  rows: T[],
): Promise<(T & { score?: number | null; top_factors?: unknown; model_id?: string | null })[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => String(r.ref_id ?? "")).filter(Boolean);
  if (!ids.length) return rows;
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT subject_id, model_id, score, top_factors
       FROM ra_model_scores
       WHERE subject_type IN ('auth','capture','chargeback') AND subject_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{ subject_id: string; model_id: string; score: number; top_factors: unknown }>();
  const by = new Map<string, { subject_id: string; model_id: string; score: number; top_factors: unknown }[]>();
  for (const s of results ?? []) {
    const list = by.get(s.subject_id) ?? [];
    list.push(s);
    by.set(s.subject_id, list);
  }
  return rows.map((r) => {
    const hits = by.get(String(r.ref_id ?? "")) ?? [];
    const prefer =
      String(r.area) === "false_declines"
        ? hits.find((h) => h.model_id === "false_decline")
        : String(r.area) === "chargebacks"
          ? hits.find((h) => h.model_id === "chargeback" || h.model_id === "dispute_win")
          : hits[0];
    if (!prefer) return r;
    return { ...r, score: Number(prefer.score), top_factors: prefer.top_factors, model_id: prefer.model_id };
  });
}

