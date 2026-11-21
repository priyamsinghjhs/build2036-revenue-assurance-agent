-- SYNTHETIC payment-lifecycle schema (seed=2036)

-- 0002 Payment-acquiring revenue assurance (SYNTHETIC, seed=2036)
-- Deterministic data + SQL recon views. Agents reason over summaries, not raw matching.

DROP VIEW IF EXISTS v_ra_exceptions;

DROP TABLE IF EXISTS ra_agent_outputs;

DROP TABLE IF EXISTS ra_action_queue;

DROP TABLE IF EXISTS ra_agent_runs;

DROP TABLE IF EXISTS ra_fee_policies;

DROP TABLE IF EXISTS ra_reserves;

DROP TABLE IF EXISTS ra_payouts;

DROP TABLE IF EXISTS ra_refunds;

DROP TABLE IF EXISTS ra_chargebacks;

DROP TABLE IF EXISTS ra_merchant_invoices;

DROP TABLE IF EXISTS ra_fx_conversions;

DROP TABLE IF EXISTS ra_apm_reports;

DROP TABLE IF EXISTS ra_bank_transactions;

DROP TABLE IF EXISTS ra_terminal_billing;

DROP TABLE IF EXISTS ra_partner_fees;

DROP TABLE IF EXISTS ra_gateway_charges;

DROP TABLE IF EXISTS ra_network_fees;

DROP TABLE IF EXISTS ra_scheme_settlements;

DROP TABLE IF EXISTS ra_captures;

DROP TABLE IF EXISTS ra_authorizations;

DROP TABLE IF EXISTS ra_terminals;

DROP TABLE IF EXISTS ra_partners;

DROP TABLE IF EXISTS ra_merchants;

CREATE TABLE ra_merchants (
  merchant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mcc TEXT,
  country TEXT,
  currency TEXT,
  mdr_bps INTEGER,
  settlement_delay_days INTEGER,
  segment TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_partners (
  partner_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  share_bps INTEGER,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_terminals (
  terminal_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  status TEXT,
  monthly_rental REAL,
  installed_on TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_authorizations (
  auth_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  terminal_id TEXT,
  partner_id TEXT,
  ts TEXT,
  amount REAL,
  currency TEXT,
  method TEXT,
  scheme TEXT,
  status TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_captures (
  capture_id TEXT PRIMARY KEY,
  auth_id TEXT,
  ts TEXT,
  amount REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_scheme_settlements (
  scheme_id TEXT PRIMARY KEY,
  capture_id TEXT,
  scheme TEXT,
  settlement_date TEXT,
  gross REAL,
  interchange REAL,
  scheme_fee REAL,
  net REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_network_fees (
  fee_id TEXT PRIMARY KEY,
  recon_ref TEXT,
  fee_type TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_gateway_charges (
  fee_id TEXT PRIMARY KEY,
  recon_ref TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_partner_fees (
  fee_id TEXT PRIMARY KEY,
  partner_id TEXT,
  period TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_terminal_billing (
  bill_id TEXT PRIMARY KEY,
  terminal_id TEXT,
  period TEXT,
  billed REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_bank_transactions (
  bank_txn_id TEXT PRIMARY KEY,
  trs_ref TEXT,
  value_date TEXT,
  amount REAL,
  currency TEXT,
  narrative TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_apm_reports (
  report_id TEXT PRIMARY KEY,
  provider TEXT,
  method TEXT,
  report_date TEXT,
  amount REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_fx_conversions (
  fx_id TEXT PRIMARY KEY,
  ts TEXT,
  from_ccy TEXT,
  to_ccy TEXT,
  amount REAL,
  applied_rate REAL,
  reference_rate REAL,
  agreed_markup_bps INTEGER,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_merchant_invoices (
  invoice_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  period TEXT,
  volume REAL,
  mdr_billed REAL,
  mdr_expected REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_chargebacks (
  cb_id TEXT PRIMARY KEY,
  capture_id TEXT,
  amount REAL,
  reason TEXT,
  recovered REAL,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_refunds (
  refund_id TEXT PRIMARY KEY,
  capture_id TEXT,
  amount REAL,
  ts TEXT,
  double_counted INTEGER,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_payouts (
  payout_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  payout_date TEXT,
  amount REAL,
  expected_net REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_reserves (
  reserve_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  amount REAL,
  held_since TEXT,
  expected_release TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_fee_policies (
  id TEXT PRIMARY KEY,
  topic TEXT,
  text TEXT
);

CREATE TABLE ra_agent_runs (
  run_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE ra_agent_outputs (
  output_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  domain TEXT,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ra_action_queue (
  action_id TEXT PRIMARY KEY,
  run_id TEXT,
  exception_id TEXT,
  action TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  confidence INTEGER,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ra_auth_ref ON ra_authorizations(recon_ref);

CREATE INDEX idx_ra_cap_auth ON ra_captures(auth_id);

CREATE INDEX idx_ra_sch_cap ON ra_scheme_settlements(capture_id);

CREATE INDEX idx_ra_bank_ref ON ra_bank_transactions(recon_ref);

-- Reconciliation views (deterministic math). status: matched | unmatched | variance

CREATE VIEW v_ra_auth_capture AS
SELECT
  a.auth_id AS ref_id,
  'authorization' AS area,
  CASE
    WHEN a.status = 'declined' THEN 'matched'
    WHEN c.capture_id IS NULL THEN 'unmatched'
    WHEN ROUND(c.amount, 2) != ROUND(a.amount, 2) THEN 'variance'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN a.status = 'declined' THEN 'declined_auth'
    WHEN c.capture_id IS NULL THEN 'expired_auth'
    WHEN ROUND(c.amount, 2) != ROUND(a.amount, 2) THEN 'auth_capture_mismatch'
    ELSE 'auth_captured'
  END AS category,
  a.merchant_id,
  a.ts,
  a.amount AS expected_amount,
  COALESCE(c.amount, 0) AS actual_amount,
  CASE
    WHEN a.status = 'declined' THEN 0
    WHEN c.capture_id IS NULL THEN a.amount
    ELSE ROUND(ABS(a.amount - c.amount), 2)
  END AS leakage,
  a.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_authorizations a
LEFT JOIN ra_captures c ON c.auth_id = a.auth_id;

-- Extra scheme fee leakage (invoiced/applied vs expected table)
CREATE VIEW v_ra_scheme_fee_var AS
SELECT
  s.scheme_id AS ref_id,
  'scheme' AS area,
  CASE WHEN ABS(ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2)) > 0.5 THEN 'variance' ELSE 'matched' END AS status,
  CASE WHEN ABS(ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2)) > 0.5 THEN 'scheme_fee_variance' ELSE 'scheme_fee_ok' END AS category,
  a.merchant_id,
  s.settlement_date AS ts,
  ROUND(c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END, 2) AS expected_amount,
  ROUND(s.interchange + s.scheme_fee, 2) AS actual_amount,
  ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2) AS leakage,
  s.recon_ref,
  a.method,
  s.scheme,
  a.currency
FROM ra_scheme_settlements s
JOIN ra_captures c ON c.capture_id = s.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
WHERE a.method = 'card'
  AND ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2) > 0.5;

-- counts for sanity (comments)
-- merchants=10 partners=5 terminals=36
-- auths=1673 captures=1533 scheme=1526 bank=1525
-- leftover_inject={"expired_auth": 0, "auth_cap_mismatch": 0, "missing_scheme": 0, "scheme_fee_wrong": 0, "missing_bank": 0, "unidentified_bank": 0, "fx_bad": 0, "apm_mismatch": 0, "chargeback_open": 0, "refund_double": 0};
