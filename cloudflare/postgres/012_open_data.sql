-- Open reference, TabFormer, and IBM AML tables.
-- These are isolated from the October 2026 INR book. Refresh_ra_summaries,
-- v_ra_* book views, and ra_kpi_summary must never include these rows.

CREATE TABLE IF NOT EXISTS ra_open_datasets (
  dataset_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  license TEXT NOT NULL,
  license_url TEXT,
  attribution TEXT NOT NULL,
  notes TEXT,
  row_count INTEGER,
  bytes_estimate BIGINT,
  loaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ra_open_fx_ecb (
  day DATE NOT NULL,
  series_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  quote TEXT NOT NULL,
  computed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ECB',
  attribution TEXT NOT NULL DEFAULT 'Source: ECB statistics',
  PRIMARY KEY (day, series_id)
);
CREATE INDEX IF NOT EXISTS idx_open_fx_ecb_ccy_day ON ra_open_fx_ecb (currency, day);

CREATE TABLE IF NOT EXISTS ra_open_mcc (
  mcc TEXT PRIMARY KEY,
  edited_description TEXT,
  combined_description TEXT,
  usda_description TEXT,
  irs_description TEXT,
  irs_reportable TEXT,
  source TEXT NOT NULL DEFAULT 'greggles/mcc-codes',
  license TEXT NOT NULL DEFAULT 'Unlicense'
);

CREATE TABLE IF NOT EXISTS ra_open_iso4217 (
  code CHAR(3) PRIMARY KEY,
  name TEXT NOT NULL,
  numeric_code CHAR(3),
  minor_units INTEGER,
  source TEXT NOT NULL DEFAULT 'ISO 4217'
);

CREATE TABLE IF NOT EXISTS ra_open_ifsc_banks (
  bank_code TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  ifsc TEXT,
  micr TEXT,
  iin TEXT,
  details_json JSONB,
  source TEXT NOT NULL DEFAULT 'razorpay/ifsc',
  license TEXT NOT NULL DEFAULT 'public-domain-data; MIT-code'
);

CREATE TABLE IF NOT EXISTS ra_open_ifsc_sample (
  ifsc TEXT PRIMARY KEY,
  bank_code TEXT,
  bank_name TEXT,
  branch_code TEXT,
  source TEXT NOT NULL DEFAULT 'razorpay/ifsc',
  license TEXT NOT NULL DEFAULT 'public-domain-data; MIT-code'
);

CREATE TABLE IF NOT EXISTS ra_open_rbi_psi (
  period TEXT NOT NULL,
  instrument TEXT NOT NULL,
  volume DOUBLE PRECISION,
  value_inr_crore DOUBLE PRECISION,
  unit_note TEXT,
  source_file TEXT,
  source TEXT NOT NULL DEFAULT 'RBI Payment System Indicators',
  attribution TEXT NOT NULL DEFAULT 'Source: Reserve Bank of India, Payment System Indicators',
  PRIMARY KEY (period, instrument)
);

CREATE TABLE IF NOT EXISTS ra_open_npci_upi (
  period TEXT PRIMARY KEY,
  volume DOUBLE PRECISION,
  value_inr_crore DOUBLE PRECISION,
  source TEXT,
  attribution TEXT,
  notes TEXT
);

-- TabFormer (Apache-2.0). Amounts are USD. NEVER roll into INR book leakage.
CREATE TABLE IF NOT EXISTS ra_open_tabformer_merchants (
  merchant_id TEXT PRIMARY KEY,
  name TEXT,
  mcc TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'tabformer',
  is_synthetic INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_open_tabformer_auth (
  auth_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  user_id TEXT,
  card_id TEXT,
  ts TEXT,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_inr_labelled DOUBLE PRECISION,
  inr_fx_day DATE,
  inr_fx_rate DOUBLE PRECISION,
  inr_fx_note TEXT,
  method TEXT,
  mcc TEXT,
  status TEXT,
  decline_reason TEXT,
  is_fraud INTEGER NOT NULL DEFAULT 0,
  is_false_decline_weak INTEGER NOT NULL DEFAULT 0,
  use_chip TEXT,
  merchant_city TEXT,
  merchant_state TEXT,
  source TEXT NOT NULL DEFAULT 'tabformer',
  is_synthetic INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_open_tf_auth_fraud ON ra_open_tabformer_auth (is_fraud);
CREATE INDEX IF NOT EXISTS idx_open_tf_auth_merchant ON ra_open_tabformer_auth (merchant_id);

CREATE TABLE IF NOT EXISTS ra_open_tabformer_chargebacks (
  cb_id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT,
  ts TEXT,
  source TEXT NOT NULL DEFAULT 'tabformer',
  is_synthetic INTEGER NOT NULL DEFAULT 1
);

-- IBM AML (data: CDLA-Sharing-1.0). Exposure only, not book leakage.
CREATE TABLE IF NOT EXISTS ra_open_aml_accounts (
  account_id TEXT PRIMARY KEY,
  bank TEXT,
  source TEXT NOT NULL DEFAULT 'ibm-aml',
  license TEXT NOT NULL DEFAULT 'CDLA-Sharing-1.0',
  is_synthetic INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_open_aml_edges (
  edge_id TEXT PRIMARY KEY,
  ts TEXT,
  from_account TEXT NOT NULL,
  from_bank TEXT,
  to_account TEXT NOT NULL,
  to_bank TEXT,
  amount_received DOUBLE PRECISION,
  receiving_currency TEXT,
  amount_paid DOUBLE PRECISION,
  payment_currency TEXT,
  payment_format TEXT,
  is_laundering INTEGER NOT NULL DEFAULT 0,
  in_seed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ibm-aml',
  license TEXT NOT NULL DEFAULT 'CDLA-Sharing-1.0',
  is_synthetic INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_open_aml_from ON ra_open_aml_edges (from_account);
CREATE INDEX IF NOT EXISTS idx_open_aml_to ON ra_open_aml_edges (to_account);
CREATE INDEX IF NOT EXISTS idx_open_aml_flag ON ra_open_aml_edges (is_laundering);

CREATE TABLE IF NOT EXISTS ra_open_aml_scores (
  account_id TEXT PRIMARY KEY,
  sage_score DOUBLE PRECISION,
  is_laundering_label INTEGER,
  version TEXT,
  source TEXT NOT NULL DEFAULT 'ibm-aml',
  scored_at TIMESTAMPTZ DEFAULT now()
);

-- Book-KPI guard view: always the INR synthetic book, never open data.
CREATE OR REPLACE VIEW v_ra_book_kpi_guard AS
SELECT
  (SELECT ROUND(total_leakage::numeric, 2) FROM ra_kpi_summary ORDER BY id DESC LIMIT 1) AS book_leakage,
  (SELECT exception_count FROM ra_kpi_summary ORDER BY id DESC LIMIT 1) AS exception_count,
  (SELECT COUNT(*) FROM ra_open_tabformer_auth) AS tabformer_rows,
  (SELECT COUNT(*) FROM ra_open_aml_edges) AS aml_edges;

GRANT SELECT ON
  ra_open_datasets, ra_open_fx_ecb, ra_open_mcc, ra_open_iso4217,
  ra_open_ifsc_banks, ra_open_ifsc_sample, ra_open_rbi_psi, ra_open_npci_upi,
  ra_open_tabformer_merchants, ra_open_tabformer_auth, ra_open_tabformer_chargebacks,
  ra_open_aml_accounts, ra_open_aml_edges, ra_open_aml_scores, v_ra_book_kpi_guard
TO ra_readonly;
