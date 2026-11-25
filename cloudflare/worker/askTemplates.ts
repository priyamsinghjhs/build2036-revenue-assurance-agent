/**
 * Deterministic Ask semantic layer: map common questions to vetted, parameterized SQL.
 * Numbers in the answer come only from query results. No LLM on this path.
 */
import { inrExact } from "../shared/money";

export const BOOK_AREA_SQL = "area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')";

export const ASK_VIEWS = [
  "v_ask_kpis",
  "v_ask_areas",
  "v_ask_exceptions",
  "v_ask_controls",
  "v_ask_anomalies",
  "v_ask_contracts",
  "v_ask_cases",
  "v_ask_files",
  "v_ask_routing",
  "v_ask_risks",
  "v_ask_clearing",
  "v_ask_acquirers",
  "v_ask_schemes",
  "v_ask_fx",
] as const;

export const ASK_SCHEMA_PROMPT = `Views (use ONLY these; columns are exact — do not invent names):
- v_ask_kpis(total_leakage, recovery_potential, match_rate, exception_count, auth_count, merchant_count) — one book-total row. Use total_leakage, not leakage. No area, merchant_id, day, or status.
- v_ask_areas(area, label, matched, unmatched, variance, leakage, match_rate, exception_count) — one row per domain.
- v_ask_exceptions(area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status, exception_id)
- v_ask_controls(control_id, name, domain, owner, frequency, threshold, status, exception_count, leakage)
- v_ask_anomalies(metric, segment, day, value, zscore, is_anomaly)
- v_ask_contracts(rule_id, doc_id, party, fee_type, rate, unit, threshold, status, citation)
- v_ask_cases(case_id, title, cause_key, cause_label, owner, status, leakage, exception_count, sla_due)
- v_ask_files(expected_id, file_kind, party, expected_date, sequence)
- v_ask_routing(policy, approval_current, approval_sim, approval_uplift, fee_current, fee_sim, fee_savings, n)
- v_ask_risks(risk_id, name, domain, inherent, residual, description)
- v_ask_clearing(canonical_id, source_kind, txn_id, rrn, upi_txn_id, payment_rail, scheme, merchant_id, txn_amount, recon_amount, actual_fee, response_code, txn_status, p2m_flag, is_rupay_credit, is_ppi, tcr5_expected, tcr5_actual) — no currency, no fx_markup.
- v_ask_acquirers(acquirer_id, txn_count, success_rate)
- v_ask_schemes(scheme, txn_count, approval_rate)
- v_ask_fx(from_ccy, to_ccy, txn_count, applied_bps, agreed_bps, markup_bps, amount)
Book leakage excludes area in (aml, network_risk, kyc, success, interfaces, anomalies, files).
The October 2026 book is the only period; do not filter on a day column of v_ask_kpis (it has none).
Reply with one SELECT or WITH … SELECT only. No markdown. LIMIT at most 50.`;

export const SUGGESTED_QUESTIONS = [
  "Top 5 merchants by leakage",
  "Total scheme leakage in October",
  "Which acquirer has the lowest success rate",
  "Show unmatched bank transactions above ₹10,000",
  "FX markup by currency",
  "Which domains have the most leakage?",
  "Show unapplied contract rebate exceptions",
  "List open cases with leakage over 10000",
  "What is the total book leakage",
  "Approval rate by scheme",
];

export type AskTemplateHit = {
  id: string;
  title: string;
  sql: string;
  narrative: (rows: Record<string, unknown>[]) => string;
};

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[₹$,]/g, "")
    .replace(/[“”"'?!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function num(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (row[k] == null || row[k] === "") continue;
    const n = Number(row[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]);
  }
  return "";
}

function topN(q: string, fallback = 5): number {
  const m = q.match(/\btop\s+(\d+)\b/);
  const n = m ? Number(m[1]) : fallback;
  return Math.min(50, Math.max(1, Number.isFinite(n) ? n : fallback));
}

function threshold(q: string, fallback: number): number {
  const m = q.match(/(?:above|over|greater than|more than|>)\s*₹?\s*([\d.]+)/i) || q.match(/\b(\d[\d.]*)\b/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : fallback;
}

export function matchAskTemplate(question: string): AskTemplateHit | null {
  const q = normalizeQuestion(question);

  if (/^(top\s+\d+\s+)?merchants? by leakage/.test(q) || /top\s+\d+\s+merchants?/.test(q) || /merchants? with the (most|highest) leakage/.test(q)) {
    const limit = topN(q, 5);
    return {
      id: "top_merchants_leakage",
      title: `Top ${limit} merchants by book leakage`,
      sql: `SELECT merchant_id, ROUND(SUM(leakage)::numeric, 2) AS leakage, COUNT(*)::int AS exceptions
FROM v_ask_exceptions
WHERE merchant_id IS NOT NULL AND ${BOOK_AREA_SQL}
GROUP BY merchant_id
ORDER BY leakage DESC
LIMIT ${limit}`,
      narrative: (rows) => {
        if (!rows.length) return "No merchant leakage rows were returned.";
        const parts = rows.map((r, i) => `${i + 1}. ${str(r, "merchant_id")} ${inrExact(num(r, "leakage") ?? 0)} (${num(r, "exceptions") ?? 0} exceptions)`);
        return `Top ${rows.length} merchants by book leakage (AML, KYC and other exposure areas excluded): ${parts.join("; ")}.`;
      },
    };
  }

  if (/scheme leakage/.test(q) || (/total/.test(q) && /scheme/.test(q) && /leak/.test(q))) {
    return {
      id: "scheme_leakage_october",
      title: "Total scheme leakage in October",
      sql: `SELECT area, label, ROUND(leakage::numeric, 2) AS leakage, exception_count
FROM v_ask_areas
WHERE area = 'scheme'
LIMIT 5`,
      narrative: (rows) => {
        const r = rows[0];
        if (!r) return "No scheme-area row was returned.";
        const n = num(r, "leakage") ?? 0;
        const ex = num(r, "exception_count") ?? 0;
        return `Scheme settlement leakage in the October 2026 book is ${inrExact(n)} across ${ex} exceptions.`;
      },
    };
  }

  if (/acquirer/.test(q) && /success|approval/.test(q) && /low|worst|least/.test(q)) {
    return {
      id: "acquirer_lowest_success",
      title: "Acquirer with the lowest success rate",
      sql: `SELECT acquirer_id, txn_count, ROUND(success_rate::numeric, 6) AS success_rate
FROM v_ask_acquirers
ORDER BY success_rate ASC, txn_count DESC
LIMIT 10`,
      narrative: (rows) => {
        const r = rows[0];
        if (!r) return "No acquirer success-rate rows were returned.";
        const rate = num(r, "success_rate") ?? 0;
        return `The acquirer with the lowest success rate is ${str(r, "acquirer_id")} at ${(rate * 100).toFixed(2)}% (${num(r, "txn_count") ?? 0} authorizations).`;
      },
    };
  }

  if (/unmatched/.test(q) && /bank/.test(q)) {
    const min = threshold(q, 10000);
    return {
      id: "unmatched_bank_above",
      title: `Unmatched bank transactions above ${inrExact(min)}`,
      sql: `SELECT exception_id, ref_id, category, merchant_id, expected_amount, actual_amount, leakage, status
FROM v_ask_exceptions
WHERE area = 'bank_trs'
  AND (status ILIKE '%unmatch%' OR category ILIKE '%unmatch%' OR category ILIKE '%unidentified%' OR category ILIKE '%missing_in_bank%')
  AND GREATEST(COALESCE(leakage,0), COALESCE(actual_amount,0), COALESCE(expected_amount,0)) >= ${Number(min)}
ORDER BY leakage DESC
LIMIT 50`,
      narrative: (rows) => {
        if (!rows.length) return `No unmatched bank / TRS exceptions were found at or above ${inrExact(min)}.`;
        const total = rows.reduce((s, r) => s + (num(r, "leakage") ?? 0), 0);
        const ids = rows.map((r) => `${str(r, "ref_id")} (${inrExact(num(r, "leakage") ?? 0)})`).join(", ");
        return `${rows.length} unmatched bank / TRS exception(s) at or above ${inrExact(min)}, totalling ${inrExact(total)}: ${ids}.`;
      },
    };
  }

  if (/\bfx\b/.test(q) && /markup|currency|currencies/.test(q)) {
    return {
      id: "fx_markup_by_currency",
      title: "FX markup by currency",
      sql: `SELECT from_ccy, to_ccy, txn_count,
       ROUND(applied_bps::numeric, 2) AS applied_bps,
       ROUND(agreed_bps::numeric, 2) AS agreed_bps,
       ROUND(markup_bps::numeric, 2) AS markup_bps,
       ROUND(amount::numeric, 2) AS amount
FROM v_ask_fx
ORDER BY ABS(markup_bps) DESC
LIMIT 20`,
      narrative: (rows) => {
        if (!rows.length) return "No FX markup rows were returned.";
        const parts = rows.map((r) => {
          const pair = `${str(r, "from_ccy")}/${str(r, "to_ccy")}`;
          const bps = num(r, "markup_bps") ?? 0;
          return `${pair}: ${bps.toFixed(2)} bps average markup over the agreed rate on ${num(r, "txn_count") ?? 0} transactions (notional ${inrExact(num(r, "amount") ?? 0)})`;
        });
        return `FX markup by currency pair: ${parts.join("; ")}.`;
      },
    };
  }

  if (/domains?/.test(q) && /leak/.test(q) && /most|top|highest|largest/.test(q)) {
    return {
      id: "domains_most_leakage",
      title: "Domains with the most book leakage",
      sql: `SELECT area, label, ROUND(leakage::numeric, 2) AS leakage, exception_count, match_rate
FROM v_ask_areas
WHERE ${BOOK_AREA_SQL}
ORDER BY leakage DESC
LIMIT 20`,
      narrative: (rows) => {
        if (!rows.length) return "No domain leakage rows were returned.";
        const top = rows.slice(0, 5).map((r) => `${str(r, "label") || str(r, "area")} ${inrExact(num(r, "leakage") ?? 0)}`);
        const total = rows.reduce((s, r) => s + (num(r, "leakage") ?? 0), 0);
        return `Domains with the most book leakage (exposure areas excluded): ${top.join("; ")}. These rows sum to ${inrExact(total)}.`;
      },
    };
  }

  if (/unapplied/.test(q) && /rebate|contract/.test(q)) {
    return {
      id: "unapplied_contract_rebate",
      title: "Unapplied contract rebate exceptions",
      sql: `SELECT exception_id, ref_id, merchant_id, category, leakage, status
FROM v_ask_exceptions
WHERE category IN ('contract_unapplied_rebate', 'contract_fee_change_unapplied')
ORDER BY leakage DESC
LIMIT 50`,
      narrative: (rows) => {
        if (!rows.length) return "No unapplied contract rebate exceptions were returned.";
        const parts = rows.map((r) => `${str(r, "ref_id")} ${inrExact(num(r, "leakage") ?? 0)} (${str(r, "category").replace(/_/g, " ")})`);
        return `${rows.length} unapplied contract rebate / fee-change exception(s): ${parts.join("; ")}.`;
      },
    };
  }

  if (/open cases/.test(q) && /leak/.test(q)) {
    const min = threshold(q, 10000);
    return {
      id: "open_cases_over",
      title: `Open cases with leakage over ${inrExact(min)}`,
      sql: `SELECT case_id, title, status, owner, cause_label, ROUND(leakage::numeric, 2) AS leakage, exception_count
FROM v_ask_cases
WHERE COALESCE(leakage, 0) > ${Number(min)}
  AND LOWER(COALESCE(status, 'new')) NOT IN ('resolved', 'closed', 'done')
ORDER BY leakage DESC
LIMIT 50`,
      narrative: (rows) => {
        if (!rows.length) return `No open cases with leakage over ${inrExact(min)} were returned.`;
        const total = rows.reduce((s, r) => s + (num(r, "leakage") ?? 0), 0);
        return `${rows.length} open case(s) with leakage over ${inrExact(min)}, totalling ${inrExact(total)}. Highest: ${str(rows[0], "case_id")} at ${inrExact(num(rows[0], "leakage") ?? 0)}.`;
      },
    };
  }

  if (/(total|overall|book) leakage/.test(q) || /what is the total book leakage/.test(q) || q === "total book leakage") {
    return {
      id: "total_book_leakage",
      title: "Total book leakage",
      sql: `SELECT
  ROUND((
    COALESCE((
      SELECT SUM(leakage) FROM ra_exception_rows
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    ), 0)
    + COALESCE((
      SELECT SUM(s.leakage) FROM ra_area_summary s
      WHERE s.area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
        AND NOT EXISTS (SELECT 1 FROM ra_exception_rows e WHERE e.area = s.area)
    ), 0)
  )::numeric, 2) AS total_leakage,
  (
    COALESCE((
      SELECT COUNT(*) FROM ra_exception_rows
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    ), 0)
    + COALESCE((
      SELECT SUM(s.exception_count) FROM ra_area_summary s
      WHERE s.area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
        AND NOT EXISTS (SELECT 1 FROM ra_exception_rows e WHERE e.area = s.area)
    ), 0)
  )::int AS exception_count,
  (SELECT match_rate FROM ra_kpi_summary WHERE id = 1) AS match_rate,
  (SELECT merchant_count FROM ra_kpi_summary WHERE id = 1) AS merchant_count
`,
      narrative: (rows) => {
        const r = rows[0];
        if (!r) return "No book KPI row was returned.";
        const leak = num(r, "total_leakage", "leakage") ?? 0;
        return `Total book leakage in the October 2026 synthetic book is ${inrExact(leak)} across ${num(r, "exception_count") ?? 0} exceptions (match rate ${(((num(r, "match_rate") ?? 0) * 100).toFixed(2))}%). This excludes AML, KYC and other exposure areas.`;
      },
    };
  }

  if (/approval rate/.test(q) && /scheme/.test(q)) {
    return {
      id: "approval_rate_by_scheme",
      title: "Approval rate by scheme",
      sql: `SELECT scheme, txn_count, ROUND(approval_rate::numeric, 6) AS approval_rate
FROM v_ask_schemes
ORDER BY approval_rate ASC, scheme
LIMIT 20`,
      narrative: (rows) => {
        if (!rows.length) return "No scheme approval-rate rows were returned.";
        const low = rows[0];
        const parts = rows.map((r) => `${str(r, "scheme")} ${(((num(r, "approval_rate") ?? 0) * 100).toFixed(2))}%`);
        return `Authorization approval rate by scheme: ${parts.join("; ")}. Lowest is ${str(low, "scheme")} at ${(((num(low, "approval_rate") ?? 0) * 100).toFixed(2))}%.`;
      },
    };
  }

  return null;
}

export function groundedAnswer(_question: string, rows: Record<string, unknown>[], template?: AskTemplateHit | null): string {
  if (template) return template.narrative(rows);
  if (!rows.length) return "The query ran but returned no rows.";
  const first = rows[0];
  const moneyKeys = Object.keys(first).filter((k) => /leakage|amount|recovery|fee|inr|total/.test(k));
  const bits: string[] = [`The query returned ${rows.length} row${rows.length === 1 ? "" : "s"}.`];
  if (rows.length === 1 && moneyKeys.length) {
    bits.push(moneyKeys.map((k) => `${k.replace(/_/g, " ")} ${inrExact(num(first, k) ?? 0)}`).join(", ") + ".");
  } else if (moneyKeys[0]) {
    const top = rows.slice(0, 5).map((r) => {
      const label = str(r, "label", "area", "merchant_id", "scheme", "acquirer_id", "case_id", "ref_id", "from_ccy") || "row";
      return `${label} ${inrExact(num(r, moneyKeys[0]) ?? 0)}`;
    });
    bits.push(top.join("; ") + ".");
  }
  return bits.join(" ");
}
