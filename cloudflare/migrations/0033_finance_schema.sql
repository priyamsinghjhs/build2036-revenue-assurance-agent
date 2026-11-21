-- 0033 Finance hops + billing/invoicing/cash/GL schema (SYNTHETIC)
-- Source tables for every acquiring-firm system hop. Copies from the existing book plus new finance systems.

CREATE TABLE IF NOT EXISTS ra_contracts (
  contract_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  plan_name TEXT,
  mdr_bps INTEGER,
  per_txn_fee REAL,
  monthly_min REAL,
  terminal_rental REAL,
  vas_bps INTEGER,
  gst_pct REAL,
  start_date TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_tms_terminals (
  tms_id TEXT PRIMARY KEY,
  terminal_id TEXT,
  merchant_id TEXT,
  status TEXT,
  monthly_rental REAL,
  last_seen TEXT,
  source TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gateway_logs (
  log_id TEXT PRIMARY KEY,
  auth_id TEXT,
  merchant_id TEXT,
  ts TEXT,
  amount REAL,
  status TEXT,
  gateway_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_switch_logs (
  switch_id TEXT PRIMARY KEY,
  auth_id TEXT,
  ts TEXT,
  response_code TEXT,
  amount REAL,
  rrn TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_clearing_records (
  rec_id TEXT PRIMARY KEY,
  file_id TEXT,
  scheme TEXT,
  clearing_date TEXT,
  capture_id TEXT,
  gross REAL,
  interchange REAL,
  scheme_fee REAL,
  net REAL,
  direction TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_bank_statements (
  statement_id TEXT PRIMARY KEY,
  account_no TEXT,
  statement_date TEXT,
  opening REAL,
  closing REAL,
  format TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_bank_statement_lines (
  line_id TEXT PRIMARY KEY,
  statement_id TEXT,
  bank_txn_id TEXT,
  value_date TEXT,
  amount REAL,
  narrative TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_trs_entries (
  trs_id TEXT PRIMARY KEY,
  value_date TEXT,
  amount REAL,
  entry_type TEXT,
  recon_ref TEXT,
  bank_txn_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fx_rates (
  rate_id TEXT PRIMARY KEY,
  ts TEXT,
  pair TEXT,
  mid_rate REAL,
  provider TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_billing_runs (
  run_id TEXT PRIMARY KEY,
  period TEXT,
  run_ts TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_billing_lines (
  line_id TEXT PRIMARY KEY,
  run_id TEXT,
  merchant_id TEXT,
  period TEXT,
  charge_type TEXT,
  usage_qty REAL,
  rate REAL,
  amount REAL,
  expected_amount REAL,
  gst_amount REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fin_invoices (
  invoice_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  invoice_date TEXT,
  due_date TEXT,
  subtotal REAL,
  gst_amount REAL,
  total REAL,
  status TEXT,
  billing_run_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fin_invoice_lines (
  line_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  billing_line_id TEXT,
  description TEXT,
  amount REAL,
  gst_rate REAL,
  gst_amount REAL
);

CREATE TABLE IF NOT EXISTS ra_credit_notes (
  cn_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  merchant_id TEXT,
  amount REAL,
  reason TEXT,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_cash_receipts (
  receipt_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  receipt_date TEXT,
  amount REAL,
  method TEXT,
  source TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_cash_applications (
  app_id TEXT PRIMARY KEY,
  receipt_id TEXT,
  invoice_id TEXT,
  applied_amount REAL
);

CREATE TABLE IF NOT EXISTS ra_writeoffs (
  wo_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  merchant_id TEXT,
  amount REAL,
  reason TEXT,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_vendor_invoices (
  vinvoice_id TEXT PRIMARY KEY,
  vendor_type TEXT,
  vendor_id TEXT,
  vendor_name TEXT,
  period TEXT,
  invoice_date TEXT,
  due_date TEXT,
  expected REAL,
  invoiced REAL,
  gst_amount REAL,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_vendor_payments (
  payment_id TEXT PRIMARY KEY,
  vinvoice_id TEXT,
  amount REAL,
  payment_date TEXT,
  is_duplicate INTEGER DEFAULT 0,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gl_journals (
  journal_id TEXT PRIMARY KEY,
  je_date TEXT,
  source_system TEXT,
  source_ref TEXT,
  posted INTEGER,
  memo TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gl_lines (
  line_id TEXT PRIMARY KEY,
  journal_id TEXT,
  account TEXT,
  debit REAL,
  credit REAL
);

CREATE TABLE IF NOT EXISTS ra_disputes (
  dispute_id TEXT PRIMARY KEY,
  cb_id TEXT,
  stage TEXT,
  amount REAL,
  status TEXT,
  ts TEXT,
  merchant_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

-- Hop copies from the existing book
INSERT INTO ra_tms_terminals (tms_id, terminal_id, merchant_id, status, monthly_rental, last_seen, source, is_synthetic)
SELECT 'TMS-' || terminal_id, terminal_id, merchant_id, status, monthly_rental, installed_on, 'tms', 1
FROM ra_terminals;

INSERT INTO ra_gateway_logs (log_id, auth_id, merchant_id, ts, amount, status, gateway_ref, is_synthetic)
SELECT 'GW-' || auth_id, auth_id, merchant_id, ts, amount, status, recon_ref, 1
FROM ra_authorizations;

INSERT INTO ra_switch_logs (switch_id, auth_id, ts, response_code, amount, rrn, is_synthetic)
SELECT 'SW-' || auth_id, auth_id, ts,
       CASE WHEN status IN ('approved','captured') THEN '00' WHEN status = 'declined' THEN '05' ELSE '96' END,
       amount, recon_ref, 1
FROM ra_authorizations;

INSERT INTO ra_clearing_records (rec_id, file_id, scheme, clearing_date, capture_id, gross, interchange, scheme_fee, net, direction, recon_ref, is_synthetic)
SELECT 'CLR-' || s.scheme_id,
       'IPM-' || s.scheme || '-' || REPLACE(s.settlement_date, '-', ''),
       s.scheme, s.settlement_date, s.capture_id, s.gross, s.interchange, s.scheme_fee, s.net,
       'incoming', s.recon_ref, 1
FROM ra_scheme_settlements s;

INSERT INTO ra_bank_statements (statement_id, account_no, statement_date, opening, closing, format, is_synthetic)
VALUES ('STMT-2026-10-MT940', '000123456789', '2026-10-31', 2500000.00, 0, 'MT940', 1),
       ('STMT-2026-11-CAMT', '000123456789', '2026-11-15', 0, 0, 'CAMT.053', 1);

INSERT INTO ra_bank_statement_lines (line_id, statement_id, bank_txn_id, value_date, amount, narrative, recon_ref, is_synthetic)
SELECT 'SL-' || bank_txn_id,
       CASE WHEN value_date < '2026-11-01' THEN 'STMT-2026-10-MT940' ELSE 'STMT-2026-11-CAMT' END,
       bank_txn_id, value_date, amount, narrative, recon_ref, 1
FROM ra_bank_transactions;

INSERT INTO ra_trs_entries (trs_id, value_date, amount, entry_type, recon_ref, bank_txn_id, is_synthetic)
SELECT 'TRS-' || bank_txn_id, value_date, amount,
       CASE WHEN amount >= 0 THEN 'credit' ELSE 'debit' END,
       recon_ref, bank_txn_id, 1
FROM ra_bank_transactions;

INSERT INTO ra_fx_rates (rate_id, ts, pair, mid_rate, provider, is_synthetic)
SELECT 'FXR-' || from_ccy || to_ccy || '-' || SUBSTR(ts, 1, 10),
       SUBSTR(ts, 1, 10), from_ccy || '/' || to_ccy, AVG(reference_rate), 'FXPRO', 1
FROM ra_fx_conversions
GROUP BY 1, 2, 3;

INSERT INTO ra_disputes (dispute_id, cb_id, stage, amount, status, ts, merchant_id, is_synthetic)
SELECT 'DSP-' || cb.cb_id, cb.cb_id,
       CASE WHEN cb.recovered >= cb.amount THEN 'closed' ELSE 'chargeback' END,
       cb.amount,
       CASE WHEN cb.recovered >= cb.amount THEN 'closed' ELSE 'open' END,
       cb.ts, a.merchant_id, 1
FROM ra_chargebacks cb
JOIN ra_captures c ON c.capture_id = cb.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id;

-- Inject hop breaks (deterministic)
DELETE FROM ra_switch_logs WHERE auth_id IN (
  SELECT auth_id FROM ra_authorizations WHERE status = 'approved' ORDER BY auth_id LIMIT 4
);
DELETE FROM ra_clearing_records WHERE rec_id IN (
  SELECT rec_id FROM ra_clearing_records ORDER BY rec_id LIMIT 3
);
DELETE FROM ra_trs_entries WHERE trs_id IN (
  SELECT trs_id FROM ra_trs_entries ORDER BY trs_id LIMIT 3
);

-- Phantom switch log with no gateway (unidentified switch)
INSERT INTO ra_switch_logs (switch_id, auth_id, ts, response_code, amount, rrn, is_synthetic)
VALUES ('SW-ORPHAN-001', 'AUTH-ORPHAN-001', '2026-10-18T09:15:00', '00', 18750.00, 'RRN-ORPHAN', 1);

INSERT INTO ra_billing_runs (run_id, period, run_ts, status, is_synthetic)
VALUES ('BR-2026-10', '2026-10', '2026-11-01T02:00:00', 'posted', 1);
