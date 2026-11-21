-- Deterministic SQL reconciliation views

DROP VIEW IF EXISTS v_ra_flow;

DROP VIEW IF EXISTS v_ra_auth_capture;

DROP VIEW IF EXISTS v_ra_capture_scheme;

DROP VIEW IF EXISTS v_ra_scheme_fee_var;

DROP VIEW IF EXISTS v_ra_scheme_bank;

DROP VIEW IF EXISTS v_ra_bank_unidentified;

DROP VIEW IF EXISTS v_ra_fee_gateway;

DROP VIEW IF EXISTS v_ra_fee_network;

DROP VIEW IF EXISTS v_ra_fee_partner;

DROP VIEW IF EXISTS v_ra_terminal_recon;

DROP VIEW IF EXISTS v_ra_fx;

DROP VIEW IF EXISTS v_ra_apm;

DROP VIEW IF EXISTS v_ra_pricing;

DROP VIEW IF EXISTS v_ra_payouts;

DROP VIEW IF EXISTS v_ra_chargebacks;

CREATE VIEW v_ra_capture_scheme AS
SELECT
  c.capture_id AS ref_id,
  'scheme' AS area,
  CASE
    WHEN s.scheme_id IS NULL THEN 'unmatched'
    WHEN a.method != 'card' THEN 'matched'
    ELSE 'matched'
  END AS status,
  CASE WHEN s.scheme_id IS NULL AND a.method = 'card' THEN 'missing_scheme_settlement' ELSE 'scheme_settled' END AS category,
  a.merchant_id,
  c.ts,
  c.amount AS expected_amount,
  COALESCE(s.gross, 0) AS actual_amount,
  CASE WHEN s.scheme_id IS NULL AND a.method = 'card' THEN c.amount ELSE 0 END AS leakage,
  c.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_captures c
JOIN ra_authorizations a ON a.auth_id = c.auth_id
LEFT JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id;

CREATE VIEW v_ra_scheme_bank AS
SELECT
  s.scheme_id AS ref_id,
  'bank_trs' AS area,
  CASE WHEN b.bank_txn_id IS NULL THEN 'unmatched' ELSE 'matched' END AS status,
  CASE WHEN b.bank_txn_id IS NULL THEN 'scheme_missing_in_bank' ELSE 'bank_matched' END AS category,
  a.merchant_id,
  s.settlement_date AS ts,
  s.net AS expected_amount,
  COALESCE(b.amount, 0) AS actual_amount,
  CASE WHEN b.bank_txn_id IS NULL THEN s.net ELSE 0 END AS leakage,
  s.recon_ref,
  a.method,
  s.scheme,
  a.currency
FROM ra_scheme_settlements s
JOIN ra_captures c ON c.capture_id = s.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
LEFT JOIN ra_bank_transactions b ON b.recon_ref = s.recon_ref;

CREATE VIEW v_ra_bank_unidentified AS
SELECT
  b.bank_txn_id AS ref_id,
  'bank_trs' AS area,
  'unmatched' AS status,
  'unidentified_bank_credit' AS category,
  NULL AS merchant_id,
  b.value_date AS ts,
  0 AS expected_amount,
  b.amount AS actual_amount,
  b.amount AS leakage,
  b.recon_ref,
  NULL AS method,
  NULL AS scheme,
  b.currency
FROM ra_bank_transactions b
WHERE b.recon_ref IS NULL
   OR NOT EXISTS (SELECT 1 FROM ra_scheme_settlements s WHERE s.recon_ref = b.recon_ref);

CREATE VIEW v_ra_fee_gateway AS
SELECT
  g.fee_id AS ref_id,
  'gateway' AS area,
  CASE WHEN ROUND(g.expected, 2) = ROUND(g.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'gateway_fee_variance' AS category,
  a.merchant_id,
  a.ts,
  g.expected AS expected_amount,
  g.invoiced AS actual_amount,
  ROUND(ABS(g.invoiced - g.expected), 2) AS leakage,
  g.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_gateway_charges g
LEFT JOIN ra_authorizations a ON a.recon_ref = g.recon_ref;

CREATE VIEW v_ra_fee_network AS
SELECT
  n.fee_id AS ref_id,
  'network' AS area,
  CASE WHEN ROUND(n.expected, 2) = ROUND(n.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'network_fee_variance' AS category,
  a.merchant_id,
  a.ts,
  n.expected AS expected_amount,
  n.invoiced AS actual_amount,
  ROUND(ABS(n.invoiced - n.expected), 2) AS leakage,
  n.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_network_fees n
LEFT JOIN ra_authorizations a ON a.recon_ref = n.recon_ref;

CREATE VIEW v_ra_fee_partner AS
SELECT
  p.fee_id AS ref_id,
  'partner' AS area,
  CASE WHEN ROUND(p.expected, 2) = ROUND(p.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'partner_fee_variance' AS category,
  NULL AS merchant_id,
  p.period AS ts,
  p.expected AS expected_amount,
  p.invoiced AS actual_amount,
  ROUND(ABS(p.expected - p.invoiced), 2) AS leakage,
  p.partner_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_partner_fees p;

CREATE VIEW v_ra_terminal_recon AS
SELECT
  t.terminal_id AS ref_id,
  'terminal' AS area,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN 'unmatched'
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN 'variance'
    WHEN t.status = 'active' AND b.bill_id IS NOT NULL THEN 'matched'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN 'active_terminal_unbilled'
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN 'retired_terminal_billed'
    ELSE 'terminal_ok'
  END AS category,
  t.merchant_id,
  '2026-10' AS ts,
  CASE WHEN t.status = 'active' THEN t.monthly_rental ELSE 0 END AS expected_amount,
  COALESCE(b.billed, 0) AS actual_amount,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN t.monthly_rental
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN b.billed
    ELSE 0
  END AS leakage,
  t.terminal_id AS recon_ref,
  'pos' AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_terminals t
LEFT JOIN ra_terminal_billing b ON b.terminal_id = t.terminal_id AND b.period = '2026-10';

CREATE VIEW v_ra_fx AS
SELECT
  f.fx_id AS ref_id,
  'fx' AS area,
  CASE WHEN f.applied_rate > f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0) + 0.00005
       THEN 'variance' ELSE 'matched' END AS status,
  CASE WHEN f.applied_rate > f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0) + 0.00005
       THEN 'fx_markup_excess' ELSE 'fx_ok' END AS category,
  a.merchant_id,
  f.ts,
  ROUND(f.amount * f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0), 2) AS expected_amount,
  ROUND(f.amount * f.applied_rate, 2) AS actual_amount,
  ROUND(MAX(0, f.amount * f.applied_rate - f.amount * f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0)), 2) AS leakage,
  f.recon_ref,
  a.method,
  a.scheme,
  f.to_ccy AS currency
FROM ra_fx_conversions f
LEFT JOIN ra_authorizations a ON a.recon_ref = f.recon_ref;

CREATE VIEW v_ra_apm AS
SELECT
  r.report_id AS ref_id,
  'apm' AS area,
  CASE WHEN ROUND(r.amount, 2) = ROUND(COALESCE(x.actual, 0), 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(r.amount, 2) = ROUND(COALESCE(x.actual, 0), 2) THEN 'apm_ok' ELSE 'apm_report_mismatch' END AS category,
  NULL AS merchant_id,
  r.report_date AS ts,
  COALESCE(x.actual, 0) AS expected_amount,
  r.amount AS actual_amount,
  ROUND(ABS(r.amount - COALESCE(x.actual, 0)), 2) AS leakage,
  r.recon_ref,
  r.method,
  r.provider AS scheme,
  'INR' AS currency
FROM ra_apm_reports r
LEFT JOIN (
  SELECT DATE(s.settlement_date) AS d,
         CASE a.scheme
           WHEN 'UPI' THEN 'NPCI'
           WHEN 'PAYTM' THEN 'Paytm'
           WHEN 'PHONEPE' THEN 'PhonePe'
           WHEN 'LAZYPAY' THEN 'LazyPay'
           WHEN 'NETBANKING' THEN 'BankNet'
           WHEN 'IMPS' THEN 'NPCI'
           ELSE a.scheme
         END AS provider,
         a.method,
         ROUND(SUM(c.amount), 2) AS actual
  FROM ra_captures c
  JOIN ra_authorizations a ON a.auth_id = c.auth_id
  JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
  WHERE a.method != 'card'
  GROUP BY 1, 2, 3
) x ON x.d = r.report_date AND x.provider = r.provider AND x.method = r.method;

CREATE VIEW v_ra_pricing AS
SELECT
  i.invoice_id AS ref_id,
  'pricing' AS area,
  CASE WHEN ROUND(i.mdr_billed, 2) = ROUND(i.mdr_expected, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(i.mdr_billed, 2) = ROUND(i.mdr_expected, 2) THEN 'mdr_ok' ELSE 'mdr_contract_variance' END AS category,
  i.merchant_id,
  i.period AS ts,
  i.mdr_expected AS expected_amount,
  i.mdr_billed AS actual_amount,
  ROUND(ABS(i.mdr_billed - i.mdr_expected), 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_merchant_invoices i;

CREATE VIEW v_ra_payouts AS
SELECT
  p.payout_id AS ref_id,
  'payouts' AS area,
  CASE WHEN ROUND(p.amount, 2) = ROUND(p.expected_net, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN p.amount < p.expected_net - 0.5 THEN 'under_payout'
    WHEN p.amount > p.expected_net + 0.5 THEN 'over_payout'
    ELSE 'payout_ok'
  END AS category,
  p.merchant_id,
  p.payout_date AS ts,
  p.expected_net AS expected_amount,
  p.amount AS actual_amount,
  ROUND(ABS(p.expected_net - p.amount), 2) AS leakage,
  p.payout_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_payouts p
UNION ALL
SELECT
  r.reserve_id,
  'payouts',
  CASE WHEN r.status = 'overdue' THEN 'unmatched' ELSE 'matched' END,
  CASE WHEN r.status = 'overdue' THEN 'reserve_overdue' ELSE 'reserve_held' END,
  r.merchant_id,
  r.held_since,
  0,
  r.amount,
  CASE WHEN r.status = 'overdue' THEN r.amount ELSE 0 END,
  r.reserve_id,
  NULL, NULL, 'INR'
FROM ra_reserves r;

CREATE VIEW v_ra_chargebacks AS
SELECT
  cb.cb_id AS ref_id,
  'chargebacks' AS area,
  CASE WHEN ROUND(cb.recovered, 2) >= ROUND(cb.amount, 2) THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN ROUND(cb.recovered, 2) >= ROUND(cb.amount, 2) THEN 'chargeback_recovered' ELSE 'chargeback_unrecovered' END AS category,
  a.merchant_id,
  cb.ts,
  cb.amount AS expected_amount,
  cb.recovered AS actual_amount,
  ROUND(cb.amount - cb.recovered, 2) AS leakage,
  cb.cb_id AS recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_chargebacks cb
JOIN ra_captures c ON c.capture_id = cb.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
UNION ALL
SELECT
  rf.refund_id,
  'chargebacks',
  CASE WHEN rf.double_counted = 1 THEN 'variance' ELSE 'matched' END,
  CASE WHEN rf.double_counted = 1 THEN 'refund_double_counted' ELSE 'refund_ok' END,
  a.merchant_id,
  rf.ts,
  rf.amount,
  CASE WHEN rf.double_counted = 1 THEN rf.amount * 2 ELSE rf.amount END,
  CASE WHEN rf.double_counted = 1 THEN rf.amount ELSE 0 END,
  rf.refund_id,
  a.method, a.scheme, a.currency
FROM ra_refunds rf
JOIN ra_captures c ON c.capture_id = rf.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id;

DROP VIEW IF EXISTS v_ra_exceptions;
DROP VIEW IF EXISTS v_ra_exceptions_a;
DROP VIEW IF EXISTS v_ra_exceptions_b;
DROP VIEW IF EXISTS v_ra_exceptions_c;

CREATE VIEW v_ra_exceptions_a AS
SELECT * FROM (
  SELECT * FROM v_ra_auth_capture WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_capture_scheme WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_scheme_fee_var WHERE leakage > 0.5
  UNION ALL SELECT * FROM v_ra_scheme_bank WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_bank_unidentified
);

CREATE VIEW v_ra_exceptions_b AS
SELECT * FROM (
  SELECT * FROM v_ra_fee_gateway WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fee_network WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fee_partner WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_terminal_recon WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fx WHERE status != 'matched' AND leakage > 0
);

CREATE VIEW v_ra_exceptions_c AS
SELECT * FROM (
  SELECT * FROM v_ra_apm WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_pricing WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_payouts WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_chargebacks WHERE status != 'matched' AND leakage > 0
);

CREATE VIEW v_ra_exceptions AS
SELECT * FROM v_ra_exceptions_a
UNION ALL SELECT * FROM v_ra_exceptions_b
UNION ALL SELECT * FROM v_ra_exceptions_c;
