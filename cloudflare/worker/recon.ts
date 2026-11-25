import type { AppDb } from "./pg";
import { enrichExceptions } from "./ml/registry";
import { normalizeAmount } from "../shared/numbers";
import { hasActiveTolerance, withinTolerance, type AreaRuleConfig } from "../shared/reconConfig";
import { BOOK_LEAKAGE_SQL, bookTotalsFromAreas, overlayLiveSummary, type LiveAreaLeakage } from "../shared/bookLeakage";

export async function liveLeakageByArea(db: AppDb): Promise<Map<string, LiveAreaLeakage>> {
  const { results } = await db
    .prepare(
      `SELECT area, COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage
       FROM ra_exception_rows
       GROUP BY area`,
    )
    .all<LiveAreaLeakage>();
  return new Map(
    (results ?? []).map((r) => [
      String(r.area),
      { area: String(r.area), n: Number(r.n ?? 0), leakage: normalizeAmount(r.leakage) },
    ]),
  );
}

export async function liveAreaTrend(db: AppDb, area?: string) {
  const sql = area
    ? `SELECT SUBSTR(ts, 1, 10) AS day, COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage
       FROM ra_exception_rows WHERE area = ?
       GROUP BY 1 ORDER BY 1`
    : `SELECT SUBSTR(ts, 1, 10) AS day, COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage
       FROM ra_exception_rows WHERE ${BOOK_LEAKAGE_SQL}
       GROUP BY 1 ORDER BY 1`;
  const stmt = area ? db.prepare(sql).bind(area) : db.prepare(sql);
  const { results } = await stmt.all<{ day: string; n: number; leakage: number }>();
  return (results ?? []).map((r) => ({
    day: String(r.day ?? ""),
    n: Number(r.n ?? 0),
    leakage: normalizeAmount(r.leakage),
  }));
}

export type AreaId =
  | "authorization"
  | "scheme"
  | "bank_trs"
  | "gateway"
  | "network"
  | "partner"
  | "terminal"
  | "apm"
  | "fx"
  | "pricing"
  | "payouts"
  | "chargebacks"
  | "billing"
  | "invoicing"
  | "cash_ar"
  | "vendor"
  | "gl"
  | "hops"
  | "settlement"
  | "funding"
  | "acquirer"
  | "config"
  | "tax"
  | "kyc"
  | "interfaces"
  | "aml"
  | "network_risk"
  | "success"
  | "contracts"
  | "files"
  | "anomalies"
  | "clearing"
  | "false_declines";

export const AREA_META: Record<
  AreaId,
  { label: string; group: string; blurb: string }
> = {
  authorization: { label: "Authorization & Capture", group: "lifecycle", blurb: "Auth vs capture, expired auths, declines" },
  scheme: { label: "Scheme Settlement", group: "lifecycle", blurb: "Visa, Mastercard, RuPay, Amex interchange & scheme fees" },
  bank_trs: { label: "Bank / TRS", group: "lifecycle", blurb: "Treasury bank statement vs scheme net" },
  gateway: { label: "Gateway Charges", group: "fees", blurb: "Gateway fees invoiced vs expected" },
  network: { label: "Network Fees", group: "fees", blurb: "Switch / network fees invoiced vs expected" },
  partner: { label: "Partner Fees", group: "fees", blurb: "ISO, referral and platform revenue share" },
  terminal: { label: "POS Terminals", group: "ops", blurb: "Rental billing vs active inventory" },
  apm: { label: "Alternative Payments", group: "ops", blurb: "UPI, wallets, BNPL, net banking, A2A" },
  fx: { label: "FX & Currency", group: "ops", blurb: "Applied rate vs mid, markup cap" },
  pricing: { label: "Merchant Pricing", group: "payout", blurb: "MDR billed vs contracted bps" },
  payouts: { label: "Payouts & Reserves", group: "payout", blurb: "Payout vs net settlement, overdue reserves" },
  chargebacks: { label: "Chargebacks & Refunds", group: "payout", blurb: "Unrecovered chargebacks, double refunds" },
  billing: { label: "Billing / Rating", group: "finance", blurb: "Contract vs rated MDR, per-txn, rental, minimums, VAS, unbilled usage" },
  invoicing: { label: "Invoicing", group: "finance", blurb: "Billing vs invoices, credit notes, GST/tax lines" },
  cash_ar: { label: "Cash & AR", group: "finance", blurb: "Invoice vs cash received, short-pays, unapplied cash, ageing" },
  vendor: { label: "Vendor Costs", group: "finance", blurb: "Gateway/network/scheme/partner invoices vs expected and payments" },
  gl: { label: "GL / ERP", group: "finance", blurb: "Subledger vs journal entries, unposted and misposted items" },
  hops: { label: "System hops", group: "lifecycle", blurb: "Gateway↔switch↔clearing, bank statement↔TRS" },
  settlement: { label: "Merchant Settlement", group: "lifecycle", blurb: "Batch cut-off, fee deductions, gross-to-net, captures vs inclusion" },
  funding: { label: "Merchant Funding", group: "lifecycle", blurb: "NEFT/RTGS/IMPS transfers, SLA, wrong account, held or returned funds" },
  acquirer: { label: "Acquirer / Sponsor", group: "lifecycle", blurb: "Sponsor-bank volumes, fee pass-through, invoices vs contract, statement recon" },
  config: { label: "Config & rule changes", group: "governance", blurb: "Pricing, MDR, commission, fee and limit changes with approval and revenue impact" },
  tax: { label: "Tax & regulatory", group: "risk", blurb: "GST 18% on MDR/fees, TDS on partner commission, illustrative zero-MDR and daily caps" },
  kyc: { label: "KYC & profile", group: "governance", blurb: "KYC status, risk tier, MCC, limits, aggregator hierarchy and bank accounts" },
  interfaces: { label: "Interface / message drops", group: "lifecycle", blurb: "Per-hop counts and volumes, drops, duplicates and latency, daily funnel" },
  aml: { label: "AML / fraud flags", group: "risk", blurb: "Rule-based structuring, refund abuse, round-tripping, velocity spikes, dormant bursts" },
  network_risk: { label: "Network risk", group: "risk", blurb: "Entity graph: shared accounts and devices, cycles, known-bad proximity, changed accounts" },
  success: { label: "Payment success rate", group: "lifecycle", blurb: "Approval and failure reasons by channel, acquirer and APM, including EMI" },
  contracts: { label: "Contracts & rules", group: "governance", blurb: "Extracted contract rules, approvals, and SQL validation of rebates, tiers, fee changes and expired terms" },
  files: { label: "File completeness", group: "lifecycle", blurb: "Missing and out-of-sequence scheme, bank and APM daily files" },
  anomalies: { label: "Anomaly sensors", group: "risk", blurb: "Statistical z-score and EWMA detectors on latency, fee ratios, approval rates, refunds and hop volumes" },
  clearing: { label: "Clearing & ingestion", group: "lifecycle", blurb: "Canonical settlement rows from camt.053, NPCI UPI, Mastercard IPM and Visa BASE II, with deterministic fee checks" },
  false_declines: { label: "False declines", group: "lifecycle", blurb: "Soft declines scored as recoverable lost revenue. Leakage is amount × model score (or a conservative rule when unscored)." },
};

export const AREA_IDS = Object.keys(AREA_META) as AreaId[];

export type ExceptionRow = {
  exception_id: string;
  ref_id: string;
  area: AreaId;
  status: string;
  category: string;
  merchant_id: string | null;
  ts: string | null;
  expected_amount: number;
  actual_amount: number;
  leakage: number;
  recon_ref: string | null;
  method: string | null;
  scheme: string | null;
  currency: string | null;
  severity: "high" | "medium" | "low";
  score?: number | null;
  top_factors?: unknown;
  model_id?: string | null;
};

export function severityOf(leakage: number, category: string): "high" | "medium" | "low" {
  const highCats = new Set([
    "expired_auth",
    "missing_scheme_settlement",
    "scheme_missing_in_bank",
    "unidentified_bank_credit",
    "chargeback_unrecovered",
    "under_payout",
    "reserve_overdue",
    "billed_not_invoiced",
    "unbilled_usage",
    "unpaid_overdue",
    "unapplied_cash",
    "vendor_duplicate_payment",
    "gl_unposted",
    "gl_misposted",
    "gateway_missing_in_switch",
    "switch_missing_in_clearing",
    "ar_61_90",
    "ar_90_plus",
    "settlement_missing_txn",
    "settlement_duplicate_txn",
    "settlement_fee_overcharge",
    "settlement_net_mismatch",
    "funding_short",
    "funding_failed",
    "funding_returned",
    "funding_duplicate",
    "funding_wrong_account",
    "funding_held",
    "acquirer_fee_overcharge",
    "acquirer_passthrough_markup",
    "acquirer_statement_unmatched",
    "config_unapproved",
    "tax_gst_wrong_rate",
    "tax_tds_shortfall",
    "tax_zero_mdr_illustrative",
    "tax_daily_limit_breach",
    "kyc_expired_transacting",
    "kyc_pending_transacting",
    "kyc_limit_breach",
    "aml_structuring",
    "aml_refund_abuse",
    "aml_round_trip",
    "aml_velocity_spike",
    "aml_dormant_burst",
    "network_known_bad",
    "network_shared_account",
    "interface_drop",
    "false_decline_soft",
    "false_decline_timeout",
    "false_decline_planted",
  ]);
  if (highCats.has(category) || leakage >= 5000) return "high";
  if (leakage >= 1000) return "medium";
  return "low";
}

export function mapException(row: Record<string, unknown>): ExceptionRow {
  const area = String(row.area) as AreaId;
  const ref = String(row.ref_id);
  const category = String(row.category);
  const leakage = Number(row.leakage ?? 0);
  return {
    exception_id: `${area}:${category}:${ref}`,
    ref_id: ref,
    area,
    status: String(row.status),
    category,
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    ts: row.ts ? String(row.ts) : null,
    expected_amount: Number(row.expected_amount ?? 0),
    actual_amount: Number(row.actual_amount ?? 0),
    leakage,
    recon_ref: row.recon_ref ? String(row.recon_ref) : null,
    method: row.method ? String(row.method) : null,
    scheme: row.scheme ? String(row.scheme) : null,
    currency: row.currency ? String(row.currency) : null,
    severity: severityOf(leakage, category),
  };
}

export async function listExceptions(
  db: AppDb,
  area?: string,
  limit = 80,
): Promise<ExceptionRow[]> {
  const sql = area
    ? "SELECT * FROM ra_exception_rows WHERE area = ? ORDER BY leakage DESC LIMIT ?"
    : "SELECT * FROM ra_exception_rows ORDER BY leakage DESC LIMIT ?";
  const stmt = area ? db.prepare(sql).bind(area, limit) : db.prepare(sql).bind(limit);
  const { results } = await stmt.all<Record<string, unknown>>();
  const mapped = (results ?? []).map(mapException);
  return enrichExceptions(db, mapped) as Promise<ExceptionRow[]>;
}

export async function getException(db: AppDb, exceptionId: string): Promise<ExceptionRow | null> {
  const parts = exceptionId.split(":");
  if (parts.length < 3) return null;
  const area = parts[0];
  const category = parts[1];
  const refId = parts.slice(2).join(":");
  const { results } = await db
    .prepare("SELECT * FROM ra_exception_rows WHERE area = ? AND category = ? AND ref_id = ? LIMIT 1")
    .bind(area, category, refId)
    .all<Record<string, unknown>>();
  const row = results?.[0];
  if (!row) return null;
  const [enriched] = await enrichExceptions(db, [mapException(row)]);
  return enriched as ExceptionRow;
}

export type AreaSummary = {
  area: AreaId;
  label: string;
  matched: number;
  unmatched: number;
  variance: number;
  leakage: number;
  match_rate: number;
  exception_count: number;
};

export async function summarizeArea(db: AppDb, area: AreaId): Promise<AreaSummary> {
  const row = await db
    .prepare(
      "SELECT area, label, matched, unmatched, variance, leakage, match_rate, exception_count FROM ra_area_summary WHERE area = ?",
    )
    .bind(area)
    .first<AreaSummary>();
  const liveOne = await db
    .prepare(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(leakage),0)::float AS leakage FROM ra_exception_rows WHERE area = ?`,
    )
    .bind(area)
    .first<{ n: number; leakage: number }>();
  const base: AreaSummary = row
    ? {
        ...row,
        area,
        matched: Number(row.matched),
        unmatched: Number(row.unmatched),
        variance: Number(row.variance),
        leakage: Number(row.leakage),
        match_rate: Number(row.match_rate),
        exception_count: Number(row.exception_count),
        label: row.label || AREA_META[area].label,
      }
    : {
        area,
        label: AREA_META[area].label,
        matched: 0,
        unmatched: 0,
        variance: 0,
        leakage: 0,
        match_rate: 1,
        exception_count: 0,
      };
  const live = new Map<string, LiveAreaLeakage>();
  if (liveOne && Number(liveOne.n) > 0) {
    live.set(area, { area, n: Number(liveOne.n), leakage: normalizeAmount(liveOne.leakage) });
  }
  return overlayLiveSummary(base, live);
}

export async function summarizeAll(db: AppDb): Promise<AreaSummary[]> {
  const [{ results }, live] = await Promise.all([
    db.prepare(
      "SELECT area, label, matched, unmatched, variance, leakage, match_rate, exception_count FROM ra_area_summary",
    ).all<AreaSummary>(),
    liveLeakageByArea(db),
  ]);
  const byArea = new Map((results ?? []).map((r) => [r.area, r]));
  const ids = [...AREA_IDS] as AreaId[];
  for (const area of live.keys()) {
    if (!ids.includes(area as AreaId)) ids.push(area as AreaId);
  }
  return ids.map((area) => {
    const row = byArea.get(area);
    const base: AreaSummary = row
      ? {
          ...row,
          area,
          matched: Number(row.matched),
          unmatched: Number(row.unmatched),
          variance: Number(row.variance),
          leakage: Number(row.leakage),
          match_rate: Number(row.match_rate),
          exception_count: Number(row.exception_count),
          label: row.label || AREA_META[area]?.label || area,
        }
      : {
          area,
          label: AREA_META[area]?.label || area,
          matched: 0,
          unmatched: 0,
          variance: 0,
          leakage: 0,
          match_rate: 1,
          exception_count: 0,
        };
    return overlayLiveSummary(base, live);
  });
}

export async function leakageByCategory(db: AppDb) {
  const { results } = await db
    .prepare("SELECT area, category, n, leakage FROM ra_leakage_category ORDER BY leakage DESC")
    .all<{ area: string; category: string; n: number; leakage: number }>();
  return results ?? [];
}

export async function leakageTrend(db: AppDb) {
  return liveAreaTrend(db);
}

export async function moneyFlow(db: AppDb) {
  const row = await db
    .prepare(
      "SELECT capture, gateway_fees, scheme_gross, scheme_net, bank, payout, leakage_by_area FROM ra_money_flow WHERE id = 1",
    )
    .first<{
      capture: number;
      gateway_fees: number;
      scheme_gross: number;
      scheme_net: number;
      bank: number;
      payout: number;
      leakage_by_area: Record<string, number> | string;
    }>();
  let leak: Record<string, number> = {};
  if (row?.leakage_by_area) {
    leak = typeof row.leakage_by_area === "string" ? JSON.parse(row.leakage_by_area) : row.leakage_by_area;
  }
  return {
    capture: Number(row?.capture ?? 0),
    gateway_fees: Number(row?.gateway_fees ?? 0),
    scheme_gross: Number(row?.scheme_gross ?? 0),
    scheme_net: Number(row?.scheme_net ?? 0),
    bank: Number(row?.bank ?? 0),
    payout: Number(row?.payout ?? 0),
    leakage_by_area: leak,
  };
}

function looksLikeDailyLeakageTrend(points: unknown): boolean {
  if (!Array.isArray(points) || points.length === 0) return false;
  return points.every(
    (p) =>
      p &&
      typeof p === "object" &&
      "day" in (p as object) &&
      "leakage" in (p as object),
  );
}

export async function areaSeries(db: AppDb, area: AreaId) {
  const row = await db
    .prepare("SELECT series_type, points FROM ra_area_series WHERE area = ?")
    .bind(area)
    .first<{ series_type: string; points: unknown }>();
  const points = !row?.points ? [] : typeof row.points === "string" ? JSON.parse(row.points) : row.points;
  const type = row?.series_type ?? "trend";
  if (type === "trend" || looksLikeDailyLeakageTrend(points)) {
    const live = await liveAreaTrend(db, area);
    if (live.length) return { type: "trend", points: live };
  }
  return { type, points: points ?? [] };
}

export async function kpiCounts(db: AppDb) {
  const [row, areas, rec, wo] = await Promise.all([
    db.prepare(
      "SELECT auth_count, merchant_count, match_rate FROM ra_kpi_summary WHERE id = 1",
    ).first<{ auth_count: number; merchant_count: number; match_rate: number }>(),
    summarizeAll(db),
    db.prepare("SELECT COALESCE(SUM(recovered),0)::float AS recovered FROM ra_chargebacks").first<{ recovered: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount),0)::float AS written_off FROM ra_writeoffs").first<{ written_off: number }>(),
  ]);
  const book = bookTotalsFromAreas(areas);
  const recovered = Number(rec?.recovered ?? 0);
  const writtenOff = Number(wo?.written_off ?? 0);
  return {
    total_leakage: book.leakage,
    exception_count: book.exception_count,
    auth_count: Number(row?.auth_count ?? 0),
    merchant_count: Number(row?.merchant_count ?? 0),
    match_rate: Number(row?.match_rate ?? 1),
    recovery_potential: normalizeAmount(Math.max(0, book.leakage - recovered - writtenOff)),
  };
}

export type MapNode = { id: string; label: string; lane: string; href: string; x: number; y: number };
export type MapEdge = {
  source: string;
  target: string;
  href: string;
  leakage: number;
  match_rate: number;
  exceptions: number;
  label: string;
};

export async function systemMap(db: AppDb): Promise<{ nodes: MapNode[]; edges: MapEdge[] }> {
  const nodes = await db
    .prepare("SELECT id, label, lane, href, x, y FROM ra_system_map_nodes")
    .all<MapNode>();
  const edges = await db
    .prepare("SELECT source, target, href, label, leakage, match_rate, exceptions FROM ra_system_map_edges")
    .all<MapEdge>();
  return {
    nodes: (nodes.results ?? []).map((n) => ({ ...n, x: Number(n.x), y: Number(n.y) })),
    edges: (edges.results ?? []).map((e) => ({
      ...e,
      leakage: Number(e.leakage),
      match_rate: Number(e.match_rate),
      exceptions: Number(e.exceptions),
    })),
  };
}
const AGENT_SUMMARY_TTL_MS = 60_000;
const agentSummaryCache = new Map<string, { at: number; value: AgentDomainSummary }>();

/**
 * SQL evidence pack for one recon agent. The three reads run in parallel and the
 * pack is cached in the isolate for 60s (the book only changes on ingest).
 * top_exceptions are the largest by leakage; rows_count / rows_leakage are the
 * exception-row totals, so the narrative can cross-check them against the summary.
 */
export async function domainSummaryForAgent(db: AppDb, area: AreaId) {
  // Rules are read at run time; the cache key carries the rule version so an approved change applies at once.
  const { activeReconConfig } = await import("./reconConfig");
  const rules = await activeReconConfig(db);
  const key = `${area}:v${rules.version}`;
  const hit = agentSummaryCache.get(key);
  if (hit && Date.now() - hit.at < AGENT_SUMMARY_TTL_MS) return hit.value;
  const areaCfg = (rules.config.areas as Record<string, AreaRuleConfig>)[area];
  const base = await loadDomainSummaryForAgent(db, area);
  let value: AgentDomainSummary = { ...base, rule_version: rules.version, match_thresholds: rules.config.global };
  if (areaCfg) value.matching_keys = areaCfg.matching_keys;
  if (hasActiveTolerance(areaCfg)) {
    const { results } = await db
      .prepare("SELECT * FROM ra_exception_rows WHERE area = ? ORDER BY leakage DESC")
      .bind(area)
      .all<Record<string, unknown>>();
    value = applyRuleTolerances(value, (results ?? []).map(mapException), areaCfg);
  }
  agentSummaryCache.set(key, { at: Date.now(), value });
  return value;
}

type PackTop = Awaited<ReturnType<typeof loadDomainSummaryForAgent>>["top_exceptions"][number];

/**
 * Apply configured tolerances to a recon pack. Rows within tolerance move from
 * leakage/exceptions to matched and are reported separately. Pure, so the
 * tests can prove the all-zero defaults leave every figure unchanged.
 */
export function applyRuleTolerances(pack: AgentDomainSummary, rows: ExceptionRow[], cfg: AreaRuleConfig): AgentDomainSummary {
  const latest = rows.reduce<string | null>((m, r) => (r.ts && (!m || r.ts > m) ? r.ts : m), null);
  const tolerated: { row: ExceptionRow; rule: string }[] = [];
  const kept: ExceptionRow[] = [];
  for (const r of rows) {
    const rule = withinTolerance(r, cfg, latest);
    if (rule) tolerated.push({ row: r, rule });
    else kept.push(r);
  }
  if (!tolerated.length) return pack;
  const tolLeak = normalizeAmount(tolerated.reduce((s, t) => s + Number(t.row.leakage || 0), 0));
  const tolVar = tolerated.filter((t) => t.row.status === "variance").length;
  const tolUnm = tolerated.length - tolVar;
  const variance = Math.max(0, pack.variance - tolVar);
  const unmatched = Math.max(0, pack.unmatched - tolUnm);
  const matched = pack.matched + (pack.variance - variance) + (pack.unmatched - unmatched);
  const total = matched + unmatched + variance;
  const by_rule: Record<string, number> = {};
  for (const t of tolerated) by_rule[t.rule] = (by_rule[t.rule] ?? 0) + 1;
  const top: PackTop[] = kept
    .slice()
    .sort((a, b) => Number(b.leakage) - Number(a.leakage))
    .slice(0, 8)
    .map((e) => ({
      exception_id: e.exception_id,
      category: e.category,
      status: e.status,
      leakage: e.leakage,
      severity: e.severity,
      merchant_id: e.merchant_id,
      ref: e.recon_ref || e.ref_id,
    }));
  return {
    ...pack,
    matched,
    unmatched,
    variance,
    total_items: total,
    match_rate: total ? Number((matched / total).toFixed(4)) : pack.match_rate,
    leakage: normalizeAmount(pack.leakage - tolLeak),
    exception_count: Math.max(0, pack.exception_count - tolerated.length),
    rows_count: Math.max(0, pack.rows_count - tolerated.length),
    rows_leakage: normalizeAmount(pack.rows_leakage - tolLeak),
    top_exceptions: top,
    top_leakage_sum: normalizeAmount(top.reduce((s, e) => s + Number(e.leakage || 0), 0)),
    within_tolerance: { n: tolerated.length, leakage: tolLeak, by_rule },
  };
}

export function clearAgentSummaryCache() {
  agentSummaryCache.clear();
}

async function loadDomainSummaryForAgent(db: AppDb, area: AreaId) {
  const [summary, topRes, agg] = await Promise.all([
    summarizeArea(db, area),
    db
      .prepare("SELECT * FROM ra_exception_rows WHERE area = ? ORDER BY leakage DESC LIMIT 8")
      .bind(area)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        "SELECT COUNT(*)::int AS n, COALESCE(ROUND(SUM(leakage)::numeric, 2), 0) AS leakage FROM ra_exception_rows WHERE area = ?",
      )
      .bind(area)
      .first<{ n: number; leakage: number | string }>(),
  ]);
  const top = (topRes.results ?? []).map(mapException);
  const topLeakageSum = Math.round(top.reduce((sum, e) => sum + Number(e.leakage || 0), 0) * 100) / 100;
  return {
    area,
    label: summary.label,
    match_rate: Number(summary.match_rate.toFixed(4)),
    matched: summary.matched,
    unmatched: summary.unmatched,
    variance: summary.variance,
    leakage: summary.leakage,
    exception_count: summary.exception_count,
    rows_count: Number(agg?.n ?? 0),
    rows_leakage: Number(agg?.leakage ?? 0),
    total_items: summary.matched + summary.unmatched + summary.variance,
    top_leakage_sum: topLeakageSum,
    top_exceptions: top.map((e) => ({
      exception_id: e.exception_id,
      category: e.category,
      status: e.status,
      leakage: e.leakage,
      severity: e.severity,
      merchant_id: e.merchant_id,
      ref: e.recon_ref || e.ref_id,
    })),
  };
}

export type AgentDomainSummary = Awaited<ReturnType<typeof loadDomainSummaryForAgent>> & {
  rule_version?: number;
  match_thresholds?: { match_good: number; match_watch: number };
  matching_keys?: string[];
  within_tolerance?: { n: number; leakage: number; by_rule: Record<string, number> };
};

export async function policyText(db: AppDb, topic: string): Promise<string> {
  const { results } = await db
    .prepare("SELECT text FROM ra_fee_policies WHERE topic = ? OR topic = 'synthetic'")
    .bind(topic)
    .all<{ text: string }>();
  return (results ?? []).map((r) => r.text).join("\n");
}

