import type { AppDb } from "./pg";
import { enrichExceptions } from "./ml/registry";
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
  if (!row) {
    return {
      area,
      label: AREA_META[area].label,
      matched: 0,
      unmatched: 0,
      variance: 0,
      leakage: 0,
      match_rate: 1,
      exception_count: 0,
    };
  }
  return {
    ...row,
    matched: Number(row.matched),
    unmatched: Number(row.unmatched),
    variance: Number(row.variance),
    leakage: Number(row.leakage),
    match_rate: Number(row.match_rate),
    exception_count: Number(row.exception_count),
  };
}

export async function summarizeAll(db: AppDb): Promise<AreaSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT area, label, matched, unmatched, variance, leakage, match_rate, exception_count FROM ra_area_summary",
    )
    .all<AreaSummary>();
  const byArea = new Map((results ?? []).map((r) => [r.area, r]));
  return AREA_IDS.map((area) => {
    const row = byArea.get(area);
    if (!row) {
      return {
        area,
        label: AREA_META[area].label,
        matched: 0,
        unmatched: 0,
        variance: 0,
        leakage: 0,
        match_rate: 1,
        exception_count: 0,
      };
    }
    return {
      ...row,
      area,
      matched: Number(row.matched),
      unmatched: Number(row.unmatched),
      variance: Number(row.variance),
      leakage: Number(row.leakage),
      match_rate: Number(row.match_rate),
      exception_count: Number(row.exception_count),
    };
  });
}

export async function leakageByCategory(db: AppDb) {
  const { results } = await db
    .prepare("SELECT area, category, n, leakage FROM ra_leakage_category ORDER BY leakage DESC")
    .all<{ area: string; category: string; n: number; leakage: number }>();
  return results ?? [];
}

export async function leakageTrend(db: AppDb) {
  const { results } = await db
    .prepare("SELECT day, leakage, n FROM ra_leakage_trend ORDER BY day")
    .all<{ day: string; leakage: number; n: number }>();
  return results ?? [];
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

export async function areaSeries(db: AppDb, area: AreaId) {
  const row = await db
    .prepare("SELECT series_type, points FROM ra_area_series WHERE area = ?")
    .bind(area)
    .first<{ series_type: string; points: unknown }>();
  const points = !row?.points ? [] : typeof row.points === "string" ? JSON.parse(row.points) : row.points;
  return { type: row?.series_type ?? "trend", points: points ?? [] };
}

export async function kpiCounts(db: AppDb) {
  const row = await db
    .prepare(
      "SELECT total_leakage, exception_count, auth_count, merchant_count, match_rate, recovery_potential FROM ra_kpi_summary WHERE id = 1",
    )
    .first<{
      total_leakage: number;
      exception_count: number;
      auth_count: number;
      merchant_count: number;
      match_rate: number;
      recovery_potential: number;
    }>();
  return {
    total_leakage: Number(row?.total_leakage ?? 0),
    exception_count: Number(row?.exception_count ?? 0),
    auth_count: Number(row?.auth_count ?? 0),
    merchant_count: Number(row?.merchant_count ?? 0),
    match_rate: Number(row?.match_rate ?? 1),
    recovery_potential: Number(row?.recovery_potential ?? 0),
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
export async function domainSummaryForAgent(db: AppDb, area: AreaId) {
  const summary = await summarizeArea(db, area);
  const top = await listExceptions(db, area, 8);
  return {
    area,
    label: summary.label,
    match_rate: Number(summary.match_rate.toFixed(4)),
    matched: summary.matched,
    unmatched: summary.unmatched,
    variance: summary.variance,
    leakage: summary.leakage,
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

export async function policyText(db: AppDb, topic: string): Promise<string> {
  const { results } = await db
    .prepare("SELECT text FROM ra_fee_policies WHERE topic = ? OR topic = 'synthetic'")
    .bind(topic)
    .all<{ text: string }>();
  return (results ?? []).map((r) => r.text).join("\n");
}

