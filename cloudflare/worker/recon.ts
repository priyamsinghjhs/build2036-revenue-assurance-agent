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
  | "chargebacks";

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
  db: D1Database,
  area?: string,
  limit = 80,
): Promise<ExceptionRow[]> {
  const sql = area
    ? "SELECT * FROM ra_exception_rows WHERE area = ? ORDER BY leakage DESC LIMIT ?"
    : "SELECT * FROM ra_exception_rows ORDER BY leakage DESC LIMIT ?";
  const stmt = area ? db.prepare(sql).bind(area, limit) : db.prepare(sql).bind(limit);
  const { results } = await stmt.all<Record<string, unknown>>();
  return (results ?? []).map(mapException);
}

export async function getException(db: D1Database, exceptionId: string): Promise<ExceptionRow | null> {
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
  return row ? mapException(row) : null;
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

const COUNT_SQL: Record<AreaId, string> = {
  authorization: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_auth_capture GROUP BY status",
  scheme: `SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
      SELECT status, leakage FROM v_ra_capture_scheme
      UNION ALL SELECT status, leakage FROM v_ra_scheme_fee_var
    ) GROUP BY status`,
  bank_trs: `SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
      SELECT status, leakage FROM v_ra_scheme_bank
      UNION ALL SELECT status, leakage FROM v_ra_bank_unidentified
    ) GROUP BY status`,
  gateway: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_gateway GROUP BY status",
  network: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_network GROUP BY status",
  partner: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_partner GROUP BY status",
  terminal: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_terminal_recon GROUP BY status",
  apm: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_apm GROUP BY status",
  fx: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fx GROUP BY status",
  pricing: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_pricing GROUP BY status",
  payouts: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_payouts GROUP BY status",
  chargebacks: "SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_chargebacks GROUP BY status",
};

export async function summarizeArea(db: D1Database, area: AreaId): Promise<AreaSummary> {
  const { results } = await db.prepare(COUNT_SQL[area]).all<{ status: string; n: number; leakage: number }>();
  let matched = 0, unmatched = 0, variance = 0, leakage = 0;
  for (const r of results ?? []) {
    leakage += Number(r.leakage ?? 0);
    if (r.status === "matched") matched += Number(r.n);
    else if (r.status === "unmatched") unmatched += Number(r.n);
    else variance += Number(r.n);
  }
  const total = matched + unmatched + variance;
  return {
    area,
    label: AREA_META[area].label,
    matched,
    unmatched,
    variance,
    leakage: Math.round(leakage * 100) / 100,
    match_rate: total ? matched / total : 1,
    exception_count: unmatched + variance,
  };
}

export async function summarizeAll(db: D1Database): Promise<AreaSummary[]> {
  const out: AreaSummary[] = [];
  for (const area of AREA_IDS) out.push(await summarizeArea(db, area));
  return out;
}

export async function leakageByCategory(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT area, category, COUNT(*) AS n, ROUND(SUM(leakage), 2) AS leakage
       FROM ra_exception_rows GROUP BY area, category ORDER BY leakage DESC`,
    )
    .all<{ area: string; category: string; n: number; leakage: number }>();
  return results ?? [];
}

export async function leakageTrend(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT SUBSTR(COALESCE(ts, 'unknown'), 1, 10) AS day,
              ROUND(SUM(leakage), 2) AS leakage,
              COUNT(*) AS n
       FROM ra_exception_rows
       WHERE ts IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
    )
    .all<{ day: string; leakage: number; n: number }>();
  return results ?? [];
}

export async function moneyFlow(db: D1Database) {
  const capture = await db.prepare("SELECT ROUND(SUM(amount), 2) AS v FROM ra_captures").first<{ v: number }>();
  const gw = await db.prepare("SELECT ROUND(SUM(invoiced), 2) AS v FROM ra_gateway_charges").first<{ v: number }>();
  const schemeGross = await db.prepare("SELECT ROUND(SUM(gross), 2) AS v FROM ra_scheme_settlements").first<{ v: number }>();
  const schemeNet = await db.prepare("SELECT ROUND(SUM(net), 2) AS v FROM ra_scheme_settlements").first<{ v: number }>();
  const bank = await db
    .prepare("SELECT ROUND(SUM(amount), 2) AS v FROM ra_bank_transactions WHERE recon_ref IS NOT NULL")
    .first<{ v: number }>();
  const payout = await db.prepare("SELECT ROUND(SUM(amount), 2) AS v FROM ra_payouts").first<{ v: number }>();
  const leak = await db.prepare("SELECT area, ROUND(SUM(leakage), 2) AS v FROM ra_exception_rows GROUP BY area").all<{ area: string; v: number }>();
  const leakMap = Object.fromEntries((leak.results ?? []).map((r) => [r.area, Number(r.v)]));
  return {
    capture: Number(capture?.v ?? 0),
    gateway_fees: Number(gw?.v ?? 0),
    scheme_gross: Number(schemeGross?.v ?? 0),
    scheme_net: Number(schemeNet?.v ?? 0),
    bank: Number(bank?.v ?? 0),
    payout: Number(payout?.v ?? 0),
    leakage_by_area: leakMap,
  };
}

export async function areaSeries(db: D1Database, area: AreaId) {
  if (area === "fx") {
    const { results } = await db
      .prepare(
        `SELECT SUBSTR(ts, 1, 10) AS day,
                ROUND(AVG(applied_rate), 4) AS applied,
                ROUND(AVG(reference_rate), 4) AS reference
         FROM ra_fx_conversions GROUP BY 1 ORDER BY 1`,
      )
      .all();
    return { type: "fx", points: results ?? [] };
  }
  if (area === "terminal") {
    const { results } = await db
      .prepare(
        `SELECT status, COUNT(*) n, ROUND(SUM(monthly_rental), 2) rental
         FROM ra_terminals GROUP BY status`,
      )
      .all();
    return { type: "terminals", points: results ?? [] };
  }
  if (area === "apm") {
    const { results } = await db
      .prepare(
        `SELECT method, provider, ROUND(SUM(amount), 2) AS amount
         FROM ra_apm_reports GROUP BY method, provider ORDER BY amount DESC`,
      )
      .all();
    return { type: "apm", points: results ?? [] };
  }
  if (area === "partner" || area === "gateway" || area === "network") {
    const table =
      area === "partner" ? "ra_partner_fees" : area === "gateway" ? "ra_gateway_charges" : "ra_network_fees";
    const { results } = await db
      .prepare(`SELECT ROUND(SUM(expected), 2) AS expected, ROUND(SUM(invoiced), 2) AS invoiced FROM ${table}`)
      .all();
    return { type: "fees", points: results ?? [] };
  }
  if (area === "scheme") {
    const { results } = await db
      .prepare(
        `SELECT scheme, COUNT(*) n, ROUND(SUM(gross), 2) gross, ROUND(SUM(interchange + scheme_fee), 2) fees, ROUND(SUM(net), 2) net
         FROM ra_scheme_settlements GROUP BY scheme ORDER BY gross DESC`,
      )
      .all();
    return { type: "scheme", points: results ?? [] };
  }
  const results = await leakageTrend(db);
  return { type: "trend", points: results };
}

export async function domainSummaryForAgent(db: D1Database, area: AreaId) {
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

export async function policyText(db: D1Database, topic: string): Promise<string> {
  const { results } = await db
    .prepare("SELECT text FROM ra_fee_policies WHERE topic = ? OR topic = 'synthetic'")
    .bind(topic)
    .all<{ text: string }>();
  return (results ?? []).map((r) => r.text).join("\n");
}

export async function kpiCounts(db: D1Database) {
  const leak = await db.prepare("SELECT ROUND(SUM(leakage), 2) AS v, COUNT(*) AS n FROM ra_exception_rows").first<{ v: number; n: number }>();
  const auths = await db.prepare("SELECT COUNT(*) AS v FROM ra_authorizations").first<{ v: number }>();
  const merch = await db.prepare("SELECT COUNT(*) AS v FROM ra_merchants").first<{ v: number }>();
  return {
    total_leakage: Number(leak?.v ?? 0),
    exception_count: Number(leak?.n ?? 0),
    auth_count: Number(auths?.v ?? 0),
    merchant_count: Number(merch?.v ?? 0),
  };
}
