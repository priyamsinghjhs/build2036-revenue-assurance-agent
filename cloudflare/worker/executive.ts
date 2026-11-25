import type { AppDb } from "./pg";

const AS_OF = "2026-11-21";

export type ExecPayload = {
  synthetic: true;
  timing_ms?: number;
  period: { from: string; to: string; as_of: string; label: string };
  kpis: {
    revenue: number;
    leakage: number;
    leakage_pct: number;
    recovered: number;
    recoverable: number;
    written_off: number;
    match_rate: number;
    exception_count: number;
    auth_count: number;
    merchant_count: number;
  };
  ageing: { bucket: string; n: number; leakage: number }[];
  waterfall: { name: string; value: number; kind: "total" | "leak" | "net" }[];
  trend: { day: string; leakage: number; n: number }[];
  period_compare: { prior: number; current: number; delta: number };
  top_drivers: { area: string; category: string; n: number; leakage: number }[];
  compliance_exposure: { area: string; category: string; n: number; exposure: number }[];
  heatmap: { area: string; label: string; match_rate: number; leakage: number; exceptions: number }[];
  funnel: { stage: string; amount: number; n: number }[];
  narrative: { bullets: string[]; source: string; generated_at: string | null } | null;
  governance: {
    controls_total: number;
    controls_pass: number;
    controls_fail: number;
    coverage_pct: number;
    unapproved_changes: number;
    unapproved_impact: number;
    tax_leakage: number;
    kyc_open: number;
    kyc_at_risk: number;
    aml_flags: number;
    aml_exposure: number;
    interface_drop_pct: number;
    success_rate: number;
  } | null;
  intelligence: {
    contracts_pending: number;
    contracts_approved: number;
    contract_leakage: number;
    anomaly_open: number;
    routing_uplift: number;
    routing_savings: number;
    cases_open: number;
    cases_overdue: number;
    files_missing: number;
    risks_total: number;
    risks_gap: number;
    reviews_pending: number;
    ai_faithfulness: number;
    ai_unverified: number;
    false_decline_n: number;
    false_decline_recovery: number;
    chargeback_exposure: number;
    iforest_open: number;
    retry_recovered: number;
    retry_uplift: number;
    models_version: string;
  } | null;
};


/** Areas whose amounts are risk/ops exposure, not book leakage. */
export const EXPOSURE_AREAS = ["aml", "network_risk", "kyc", "success", "interfaces", "anomalies", "files"] as const;
export const BOOK_LEAKAGE_SQL = "area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')";

export async function executiveSummary(db: AppDb): Promise<ExecPayload> {
  const t0 = Date.now();
  const [
    kpiRes,
    flowRes,
    recRes,
    woRes,
    areasRes,
    catsRes,
    exposureRes,
    trendRes,
    ageingRes,
    actionRes,
    briefRes,
    gov,
    intel,
    ml,
    reviews,
    ev,
  ] = await Promise.all([
    db.prepare("SELECT * FROM ra_kpi_summary WHERE id = 1").all<Record<string, unknown>>(),
    db.prepare("SELECT capture, gateway_fees, scheme_gross, scheme_net, bank, payout FROM ra_money_flow WHERE id = 1").all<Record<string, number>>(),
    db.prepare("SELECT COALESCE(SUM(recovered),0)::float AS recovered FROM ra_chargebacks").all<{ recovered: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount),0)::float AS written_off FROM ra_writeoffs").all<{ written_off: number }>(),
    db.prepare("SELECT area, label, match_rate, leakage, exception_count AS exceptions FROM ra_area_summary ORDER BY leakage DESC").all<{ area: string; label: string; match_rate: number; leakage: number; exceptions: number }>(),
    db.prepare(`SELECT area, category, n, leakage FROM ra_leakage_category WHERE ${BOOK_LEAKAGE_SQL} ORDER BY leakage DESC LIMIT 5`).all<{ area: string; category: string; n: number; leakage: number }>(),
    db.prepare(`SELECT area, category, n, leakage FROM ra_leakage_category WHERE area IN ('aml','network_risk','kyc','success','interfaces','anomalies','files') ORDER BY leakage DESC LIMIT 5`).all<{ area: string; category: string; n: number; leakage: number }>(),
    db.prepare("SELECT day, leakage, n FROM ra_leakage_trend ORDER BY day").all<{ day: string; leakage: number; n: number }>(),
    db.prepare(
      `SELECT bucket, COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage
       FROM (
         SELECT CASE
           WHEN ts IS NULL OR TRIM(ts) = '' OR SUBSTR(ts,1,10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN 'unknown'
           WHEN (DATE '${AS_OF}' - CAST(SUBSTR(ts,1,10) AS date)) <= 7 THEN '0-7 days'
           WHEN (DATE '${AS_OF}' - CAST(SUBSTR(ts,1,10) AS date)) <= 30 THEN '8-30 days'
           WHEN (DATE '${AS_OF}' - CAST(SUBSTR(ts,1,10) AS date)) <= 60 THEN '31-60 days'
           ELSE '61+ days'
         END AS bucket,
         leakage
         FROM ra_exception_rows
         WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
       ) a
       GROUP BY bucket`,
    ).all<{ bucket: string; n: number; leakage: number }>(),
    db.prepare("SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS amount FROM ra_action_queue GROUP BY status").all<{ status: string; n: number; amount: number }>(),
    db.prepare("SELECT bullets, source, generated_at FROM ra_exec_brief WHERE id = 1").all<{ bullets: unknown; source: string; generated_at: string }>(),
    db.prepare("SELECT * FROM ra_governance_kpi WHERE id = 1").first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM ra_intel_kpi WHERE id = 1").first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM ra_ml_kpi WHERE id = 1").first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT exception_id FROM v_ra_review_queue WHERE review_status='pending') q`).first<{ n: number }>(),
    db.prepare(`SELECT COALESCE(AVG(faithfulness),0) AS faith, COUNT(*) FILTER (WHERE verification='unverified')::int AS unverified FROM ra_eval_scores`).first<{ faith: number; unverified: number }>().catch(() => ({ faith: 0, unverified: 0 })),
  ]);
  const [kpi] = kpiRes.results ?? [];
  const [flow] = flowRes.results ?? [];
  const [rec] = recRes.results ?? [];
  const [wo] = woRes.results ?? [];
  const areasAll = areasRes.results;
  const areas = (areasAll ?? []).filter((a) => !EXPOSURE_AREAS.includes(a.area as (typeof EXPOSURE_AREAS)[number]));
  const cats = catsRes.results;
  const exposureCats = exposureRes.results;
  const trend = trendRes.results;
  const ageingRaw = ageingRes.results;
  const actionAgg = actionRes.results;
  const [brief] = briefRes.results ?? [];
  const evals = ev ?? { faith: 0, unverified: 0 };

  const revenue = Number(flow?.capture ?? 0);
  const leakage = Number(kpi?.total_leakage ?? 0);
  const recovered = Number(rec?.recovered ?? 0);
  const writtenOff = Number(wo?.written_off ?? 0);
  const recoverable = Math.max(0, leakage - recovered - writtenOff);

  const prior = (trend ?? []).filter((t) => t.day <= "2026-10-15").reduce((s, t) => s + Number(t.leakage), 0);
  const current = (trend ?? []).filter((t) => t.day > "2026-10-15").reduce((s, t) => s + Number(t.leakage), 0);

  const topAreas = (areas ?? []).slice(0, 6);
  const otherLeak = (areas ?? []).slice(6).reduce((s, a) => s + Number(a.leakage), 0);
  const waterfall: ExecPayload["waterfall"] = [
    { name: "Gross revenue", value: revenue, kind: "total" },
    ...topAreas.map((a) => ({ name: a.label, value: -Number(a.leakage), kind: "leak" as const })),
  ];
  if (otherLeak > 0) waterfall.push({ name: "Other leakage", value: -otherLeak, kind: "leak" });
  waterfall.push({ name: "Net after leakage", value: revenue - leakage, kind: "net" });

  const byStatus = Object.fromEntries((actionAgg ?? []).map((r) => [r.status, r]));
  const funnel = [
    { stage: "Recoverable", amount: recoverable, n: Number(kpi?.exception_count ?? 0) },
    { stage: "Proposed", amount: Number(byStatus.proposed?.amount ?? 0), n: Number(byStatus.proposed?.n ?? 0) },
    { stage: "Approved", amount: Number(byStatus.approved?.amount ?? 0), n: Number(byStatus.approved?.n ?? 0) },
    { stage: "Recovered", amount: recovered + Number(byStatus.done?.amount ?? 0), n: Number(byStatus.done?.n ?? 0) },
    { stage: "Written off", amount: writtenOff, n: 0 },
  ];

  const ageOrder = ["0-7 days", "8-30 days", "31-60 days", "61+ days", "unknown"];
  const ageing = ageOrder
    .map((bucket) => ageingRaw?.find((r) => r.bucket === bucket) ?? { bucket, n: 0, leakage: 0 })
    .filter((r) => r.n > 0 || r.bucket !== "unknown");

  let bullets: string[] = [];
  if (brief?.bullets) {
    bullets = Array.isArray(brief.bullets) ? (brief.bullets as string[]) : [];
  }

  return {
    synthetic: true,
    timing_ms: Date.now() - t0,
    period: { from: "2026-10-01", to: "2026-10-31", as_of: AS_OF, label: "October 2026" },
    kpis: {
      revenue,
      leakage,
      leakage_pct: revenue ? leakage / revenue : 0,
      recovered,
      recoverable,
      written_off: writtenOff,
      match_rate: Number(kpi?.match_rate ?? 1),
      exception_count: Number(kpi?.exception_count ?? 0),
      auth_count: Number(kpi?.auth_count ?? 0),
      merchant_count: Number(kpi?.merchant_count ?? 0),
    },
    ageing,
    waterfall,
    trend: (trend ?? []).map((t) => ({ day: t.day, leakage: Number(t.leakage), n: Number(t.n) })),
    period_compare: { prior, current, delta: current - prior },
    top_drivers: (cats ?? []).map((c) => ({
      area: c.area,
      category: c.category,
      n: Number(c.n),
      leakage: Number(c.leakage),
    })),
    compliance_exposure: (exposureCats ?? []).map((c) => ({
      area: c.area,
      category: c.category,
      n: Number(c.n),
      exposure: Number(c.leakage),
    })),
    heatmap: (areasAll ?? []).map((a) => ({
      area: a.area,
      label: a.label,
      match_rate: Number(a.match_rate),
      leakage: Number(a.leakage),
      exceptions: Number(a.exceptions),
    })),
    funnel,
    narrative: brief
      ? { bullets, source: brief.source, generated_at: brief.generated_at }
      : null,
    governance: gov
      ? {
          controls_total: Number(gov.controls_total ?? 0),
          controls_pass: Number(gov.controls_pass ?? 0),
          controls_fail: Number(gov.controls_fail ?? 0),
          coverage_pct: Number(gov.coverage_pct ?? 0),
          unapproved_changes: Number(gov.unapproved_changes ?? 0),
          unapproved_impact: Number(gov.unapproved_impact ?? 0),
          tax_leakage: Number(gov.tax_leakage ?? 0),
          kyc_open: Number(gov.kyc_open ?? 0),
          kyc_at_risk: Number(gov.kyc_at_risk ?? 0),
          aml_flags: Number(gov.aml_flags ?? 0),
          aml_exposure: Number(gov.aml_exposure ?? 0),
          interface_drop_pct: Number(gov.interface_drop_pct ?? 0),
          success_rate: Number(gov.success_rate ?? 0),
        }
      : null,
    intelligence: intel
      ? {
          contracts_pending: Number(intel.contracts_pending ?? 0),
          contracts_approved: Number(intel.contracts_approved ?? 0),
          contract_leakage: Number(intel.contract_leakage ?? 0),
          anomaly_open: Number(intel.anomaly_open ?? 0),
          routing_uplift: Number(intel.routing_uplift ?? 0),
          routing_savings: Number(intel.routing_savings ?? 0),
          cases_open: Number(intel.cases_open ?? 0),
          cases_overdue: Number(intel.cases_overdue ?? 0),
          files_missing: Number(intel.files_missing ?? 0),
          risks_total: Number(intel.risks_total ?? 0),
          risks_gap: Number(intel.risks_gap ?? 0),
          reviews_pending: Number(reviews?.n ?? 0),
          ai_faithfulness: Number(evals.faith ?? 0),
          ai_unverified: Number(evals.unverified ?? 0),
          false_decline_n: Number(ml?.false_decline_n ?? 0),
          false_decline_recovery: Number(ml?.false_decline_recovery ?? 0),
          chargeback_exposure: Number(ml?.chargeback_exposure ?? 0),
          iforest_open: Number(ml?.iforest_open ?? 0),
          retry_recovered: Number(ml?.retry_recovered ?? 0),
          retry_uplift: Number(ml?.retry_uplift ?? 0),
          models_version: String(ml?.models_version ?? "untrained"),
        }
      : null,
  };
}

export async function listFilterOptions(db: AppDb) {
  const { results: merchants } = await db
    .prepare("SELECT merchant_id, name FROM ra_merchants ORDER BY merchant_id")
    .all<{ merchant_id: string; name: string }>();
  const { results: schemes } = await db
    .prepare(
      "SELECT DISTINCT scheme FROM ra_exception_rows WHERE scheme IS NOT NULL AND scheme <> '' ORDER BY 1",
    )
    .all<{ scheme: string }>();
  return {
    period: { from: "2026-10-01", to: "2026-10-31", label: "October 2026" },
    merchants: merchants ?? [],
    schemes: (schemes ?? []).map((s) => s.scheme),
  };
}
