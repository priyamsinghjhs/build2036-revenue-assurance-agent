import type { AppDb } from "./pg";

export async function openDataOverview(db: AppDb) {
  const { results: datasets } = await db
    .prepare(
      `SELECT dataset_id, title, source_name, source_url, license, license_url, attribution, notes, row_count, bytes_estimate, loaded_at
       FROM ra_open_datasets ORDER BY dataset_id`,
    )
    .all<Record<string, unknown>>();

  const [guard, fx, tf, aml, scores, mcc, iso, ifsc, psi, dbSize] = await Promise.all([
    db.prepare("SELECT * FROM v_ra_book_kpi_guard").first<Record<string, unknown>>(),
    db.prepare("SELECT day::text AS day, rate FROM ra_open_fx_ecb WHERE series_id = 'USDINR' ORDER BY day DESC LIMIT 1").first<{ day: string; rate: number }>(),
    db.prepare("SELECT COUNT(*)::int AS n, COALESCE(SUM(is_fraud),0)::int AS fraud, COALESCE(SUM(amount),0)::float AS usd, COALESCE(SUM(amount_inr_labelled),0)::float AS inr FROM ra_open_tabformer_auth").first<Record<string, number>>(),
    db.prepare("SELECT COUNT(*)::int AS edges, COALESCE(SUM(is_laundering),0)::int AS laundering FROM ra_open_aml_edges").first<Record<string, number>>(),
    db.prepare(
      `SELECT COUNT(*)::int AS n,
              ROUND(AVG(sage_score)::numeric, 4) AS mean_score,
              ROUND(AVG(sage_score) FILTER (WHERE is_laundering_label = 1)::numeric, 4) AS mean_labelled,
              ROUND(AVG(sage_score) FILTER (WHERE is_laundering_label = 0)::numeric, 4) AS mean_unlabelled
       FROM ra_open_aml_scores`,
    ).first<Record<string, number>>(),
    db.prepare("SELECT COUNT(*)::int AS n FROM ra_open_mcc").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*)::int AS n FROM ra_open_iso4217").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*)::int AS n FROM ra_open_ifsc_banks").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*)::int AS n FROM ra_open_rbi_psi").first<{ n: number }>(),
    db.prepare("SELECT pg_database_size(current_database())::bigint AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty").first<{ bytes: number; pretty: string }>(),
  ]);

  return {
    synthetic: true,
    note: "Open reference and research datasets are isolated from the October 2026 INR book. Their amounts are never booked as leakage.",
    datasets: datasets ?? [],
    guard: guard ?? null,
    figures: {
      usdinr: fx ? { day: fx.day, rate: fx.rate } : null,
      mcc: mcc?.n ?? 0,
      iso4217: iso?.n ?? 0,
      ifsc_banks: ifsc?.n ?? 0,
      rbi_psi: psi?.n ?? 0,
      tabformer: tf ?? { n: 0, fraud: 0, usd: 0, inr: 0 },
      aml: { ...(aml ?? { edges: 0, laundering: 0 }), scores: scores ?? { n: 0 } },
      db_size: dbSize ?? null,
    },
  };
}
