-- V5: Settlement, Funding and Acquirer domains (schema, seed, views).
-- Derived from the existing October 2026 synthetic book. Idempotent.

BEGIN;

DROP VIEW IF EXISTS v_ra_settlement CASCADE;
DROP VIEW IF EXISTS v_ra_settlement_inclusion CASCADE;
DROP VIEW IF EXISTS v_ra_settlement_fees CASCADE;
DROP VIEW IF EXISTS v_ra_settlement_net CASCADE;
DROP VIEW IF EXISTS v_ra_funding CASCADE;
DROP VIEW IF EXISTS v_ra_acquirer CASCADE;
DROP VIEW IF EXISTS v_ra_acquirer_fees CASCADE;
DROP VIEW IF EXISTS v_ra_acquirer_passthrough CASCADE;
DROP VIEW IF EXISTS v_ra_acquirer_timing CASCADE;
DROP VIEW IF EXISTS v_ra_acquirer_statement CASCADE;

DROP TABLE IF EXISTS ra_settlement_item_breaks;
DROP TABLE IF EXISTS ra_settlement_events;
DROP TABLE IF EXISTS ra_funding_transfers;
DROP TABLE IF EXISTS ra_settlement_batches;
DROP TABLE IF EXISTS ra_merchant_accounts;
DROP TABLE IF EXISTS ra_merchant_acquirers;
DROP TABLE IF EXISTS ra_acquirer_statements;
DROP TABLE IF EXISTS ra_acquirer_settlements;
DROP TABLE IF EXISTS ra_acquirer_passthrough;
DROP TABLE IF EXISTS ra_acquirer_invoices;
DROP TABLE IF EXISTS ra_acquirer_stats;
DROP TABLE IF EXISTS ra_acquirers;

CREATE TABLE ra_acquirers (
  acquirer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sponsor_bank TEXT NOT NULL,
  country TEXT DEFAULT 'IN',
  acquirer_fee_bps INTEGER NOT NULL,
  settlement_days INTEGER NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_merchant_acquirers (
  merchant_id TEXT PRIMARY KEY,
  acquirer_id TEXT NOT NULL REFERENCES ra_acquirers (acquirer_id)
);

CREATE TABLE ra_settlement_batches (
  batch_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  acquirer_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  cut_off TEXT NOT NULL,
  status TEXT NOT NULL,
  txn_count_expected INTEGER NOT NULL,
  txn_count INTEGER NOT NULL,
  gross_expected DOUBLE PRECISION NOT NULL,
  gross DOUBLE PRECISION NOT NULL,
  mdr_fees_expected DOUBLE PRECISION NOT NULL,
  mdr_fees DOUBLE PRECISION NOT NULL,
  refunds DOUBLE PRECISION NOT NULL,
  chargebacks DOUBLE PRECISION NOT NULL,
  reserves DOUBLE PRECISION NOT NULL,
  adjustments DOUBLE PRECISION NOT NULL,
  net_calculated DOUBLE PRECISION NOT NULL,
  net_stated DOUBLE PRECISION NOT NULL,
  currency TEXT DEFAULT 'INR',
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_settlement_events (
  event_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ra_settlement_batches (batch_id),
  status TEXT NOT NULL,
  ts TEXT NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_settlement_item_breaks (
  break_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ra_settlement_batches (batch_id),
  capture_id TEXT,
  kind TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  note TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_merchant_accounts (
  account_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  bank_name TEXT,
  ifsc TEXT,
  account_mask TEXT,
  is_active INTEGER DEFAULT 1,
  effective_from TEXT,
  replaced_by TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_funding_transfers (
  funding_id TEXT PRIMARY KEY,
  batch_id TEXT,
  merchant_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  expected_amount DOUBLE PRECISION NOT NULL,
  instructed_at TEXT NOT NULL,
  value_date TEXT,
  due_date TEXT NOT NULL,
  sla_days INTEGER NOT NULL,
  late_days INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  dest_account_id TEXT NOT NULL,
  is_duplicate INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_acquirer_invoices (
  invoice_id TEXT PRIMARY KEY,
  acquirer_id TEXT NOT NULL REFERENCES ra_acquirers (acquirer_id),
  period TEXT NOT NULL,
  expected_fee DOUBLE PRECISION NOT NULL,
  invoiced_fee DOUBLE PRECISION NOT NULL,
  invoice_date TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_acquirer_passthrough (
  passthrough_id TEXT PRIMARY KEY,
  acquirer_id TEXT NOT NULL REFERENCES ra_acquirers (acquirer_id),
  period TEXT NOT NULL,
  expected_amount DOUBLE PRECISION NOT NULL,
  invoiced_amount DOUBLE PRECISION NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_acquirer_settlements (
  aset_id TEXT PRIMARY KEY,
  acquirer_id TEXT NOT NULL REFERENCES ra_acquirers (acquirer_id),
  period TEXT NOT NULL,
  expected_date TEXT NOT NULL,
  received_date TEXT,
  expected_amount DOUBLE PRECISION NOT NULL,
  received_amount DOUBLE PRECISION NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_acquirer_statements (
  stmt_id TEXT PRIMARY KEY,
  acquirer_id TEXT NOT NULL REFERENCES ra_acquirers (acquirer_id),
  ts TEXT NOT NULL,
  description TEXT,
  amount DOUBLE PRECISION NOT NULL,
  ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_acquirer_stats (
  acquirer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  txn_count INTEGER NOT NULL,
  auth_count INTEGER NOT NULL,
  approval_rate DOUBLE PRECISION NOT NULL,
  interchange_plus DOUBLE PRECISION NOT NULL,
  scheme_fees DOUBLE PRECISION NOT NULL,
  contract_fee_bps INTEGER NOT NULL,
  fee_expected DOUBLE PRECISION NOT NULL,
  fee_invoiced DOUBLE PRECISION NOT NULL,
  passthrough_expected DOUBLE PRECISION NOT NULL,
  passthrough_invoiced DOUBLE PRECISION NOT NULL,
  settlement_expected DOUBLE PRECISION NOT NULL,
  settlement_received DOUBLE PRECISION NOT NULL,
  avg_settle_lag_days DOUBLE PRECISION NOT NULL
);

INSERT INTO ra_acquirers (acquirer_id, name, sponsor_bank, country, acquirer_fee_bps, settlement_days, is_synthetic) VALUES
  ('ACQ-HDFC', 'HDFC Bank Acquiring', 'HDFC Bank', 'IN', 8, 1, 1),
  ('ACQ-ICICI', 'ICICI Merchant Services', 'ICICI Bank', 'IN', 10, 2, 1),
  ('ACQ-AXIS', 'Axis Bank Acquiring', 'Axis Bank', 'IN', 9, 1, 1),
  ('ACQ-SBI', 'SBI Card Acquiring', 'State Bank of India', 'IN', 7, 2, 1);

INSERT INTO ra_merchant_acquirers (merchant_id, acquirer_id) VALUES
  ('MER001', 'ACQ-HDFC'),
  ('MER002', 'ACQ-HDFC'),
  ('MER007', 'ACQ-HDFC'),
  ('MER003', 'ACQ-ICICI'),
  ('MER009', 'ACQ-ICICI'),
  ('MER004', 'ACQ-AXIS'),
  ('MER006', 'ACQ-AXIS'),
  ('MER010', 'ACQ-AXIS'),
  ('MER005', 'ACQ-SBI'),
  ('MER008', 'ACQ-SBI');

INSERT INTO ra_merchant_accounts (account_id, merchant_id, bank_name, ifsc, account_mask, is_active, effective_from, replaced_by, is_synthetic) VALUES
  ('ACC-MER001-1', 'MER001', 'HDFC Bank', 'HDFC0001234', 'XXXXXX4412', 1, '2025-01-01', NULL, 1),
  ('ACC-MER002-1', 'MER002', 'HDFC Bank', 'HDFC0002345', 'XXXXXX8821', 1, '2025-01-01', NULL, 1),
  ('ACC-MER003-1', 'MER003', 'ICICI Bank', 'ICIC0003456', 'XXXXXX1109', 1, '2025-01-01', NULL, 1),
  ('ACC-MER004-1', 'MER004', 'Axis Bank', 'UTIB0004567', 'XXXXXX7730', 1, '2025-01-01', NULL, 1),
  ('ACC-MER005-OLD', 'MER005', 'SBI', 'SBIN0005678', 'XXXXXX2204', 0, '2024-06-01', 'ACC-MER005-1', 1),
  ('ACC-MER005-1', 'MER005', 'SBI', 'SBIN0005679', 'XXXXXX3348', 1, '2026-09-15', NULL, 1),
  ('ACC-MER006-1', 'MER006', 'Axis Bank', 'UTIB0006789', 'XXXXXX9012', 1, '2025-01-01', NULL, 1),
  ('ACC-MER007-1', 'MER007', 'HDFC Bank', 'HDFC0007890', 'XXXXXX5561', 1, '2025-01-01', NULL, 1),
  ('ACC-MER008-1', 'MER008', 'SBI', 'SBIN0008901', 'XXXXXX6744', 1, '2025-01-01', NULL, 1),
  ('ACC-MER009-1', 'MER009', 'ICICI Bank', 'ICIC0009012', 'XXXXXX1288', 1, '2025-01-01', NULL, 1),
  ('ACC-MER010-1', 'MER010', 'Axis Bank', 'UTIB0000123', 'XXXXXX4099', 1, '2025-01-01', NULL, 1);

INSERT INTO ra_settlement_batches (
  batch_id, merchant_id, acquirer_id, period_start, cut_off, status,
  txn_count_expected, txn_count, gross_expected, gross,
  mdr_fees_expected, mdr_fees, refunds, chargebacks, reserves, adjustments,
  net_calculated, net_stated, currency, is_synthetic
)
SELECT
  'SET-' || m.merchant_id || '-' || to_char(w.week_end, 'IYYY') || 'W' || to_char(w.week_end, 'IW') AS batch_id,
  m.merchant_id,
  ma.acquirer_id,
  w.week_start::text,
  w.week_end::text,
  CASE
    WHEN w.week_end = DATE '2026-10-31' AND m.merchant_id = 'MER010' THEN 'calculated'
    WHEN w.week_end = DATE '2026-10-31' THEN 'approved'
    ELSE 'funded'
  END AS status,
  COALESCE(c.n, 0),
  COALESCE(c.n, 0),
  COALESCE(c.gross, 0),
  COALESCE(c.gross, 0),
  ROUND((COALESCE(c.gross, 0) * m.mdr_bps / 10000.0)::numeric, 2),
  ROUND((COALESCE(c.gross, 0) * m.mdr_bps / 10000.0)::numeric, 2),
  COALESCE(r.refunds, 0),
  COALESCE(cb.chargebacks, 0),
  CASE WHEN m.merchant_id IN ('MER003', 'MER009') THEN ROUND((COALESCE(c.gross, 0) * 0.01)::numeric, 2) ELSE 0 END,
  0,
  ROUND((
    COALESCE(c.gross, 0)
    - (COALESCE(c.gross, 0) * m.mdr_bps / 10000.0)
    - COALESCE(r.refunds, 0)
    - COALESCE(cb.chargebacks, 0)
    - CASE WHEN m.merchant_id IN ('MER003', 'MER009') THEN COALESCE(c.gross, 0) * 0.01 ELSE 0 END
  )::numeric, 2),
  ROUND((
    COALESCE(c.gross, 0)
    - (COALESCE(c.gross, 0) * m.mdr_bps / 10000.0)
    - COALESCE(r.refunds, 0)
    - COALESCE(cb.chargebacks, 0)
    - CASE WHEN m.merchant_id IN ('MER003', 'MER009') THEN COALESCE(c.gross, 0) * 0.01 ELSE 0 END
  )::numeric, 2),
  m.currency,
  1
FROM ra_merchants m
JOIN ra_merchant_acquirers ma ON ma.merchant_id = m.merchant_id
CROSS JOIN (
  SELECT d::date AS week_end, (d::date - 6) AS week_start
  FROM generate_series(DATE '2026-10-04', DATE '2026-10-31', INTERVAL '7 days') AS d
) w
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS n, COALESCE(SUM(cap.amount), 0)::double precision AS gross
  FROM ra_captures cap
  JOIN ra_authorizations a ON a.auth_id = cap.auth_id
  WHERE a.merchant_id = m.merchant_id
    AND SUBSTR(cap.ts, 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND SUBSTR(cap.ts, 1, 10)::date BETWEEN w.week_start AND w.week_end
) c ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(rf.amount), 0)::double precision AS refunds
  FROM ra_refunds rf
  JOIN ra_captures cap ON cap.capture_id = rf.capture_id
  JOIN ra_authorizations a ON a.auth_id = cap.auth_id
  WHERE a.merchant_id = m.merchant_id
    AND SUBSTR(COALESCE(rf.ts, cap.ts), 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND SUBSTR(COALESCE(rf.ts, cap.ts), 1, 10)::date BETWEEN w.week_start AND w.week_end
) r ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(x.amount), 0)::double precision AS chargebacks
  FROM ra_chargebacks x
  JOIN ra_captures cap ON cap.capture_id = x.capture_id
  JOIN ra_authorizations a ON a.auth_id = cap.auth_id
  WHERE a.merchant_id = m.merchant_id
    AND SUBSTR(COALESCE(x.ts, cap.ts), 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND SUBSTR(COALESCE(x.ts, cap.ts), 1, 10)::date BETWEEN w.week_start AND w.week_end
) cb ON TRUE
WHERE COALESCE(c.n, 0) > 0;

-- Leakage injections (txn-level evidence + stated batch adjustments)
DO $$
DECLARE
  rec RECORD;
  i INT := 0;
  b TEXT;
  amt DOUBLE PRECISION;
BEGIN
  -- 1. Missing captures: two largest in MER002 week ending 2026-10-11
  FOR rec IN
    SELECT c.capture_id, c.amount::double precision AS amount, b.batch_id
    FROM ra_settlement_batches b
    JOIN ra_authorizations a ON a.merchant_id = b.merchant_id
    JOIN ra_captures c ON c.auth_id = a.auth_id
    WHERE b.merchant_id = 'MER002' AND b.cut_off = '2026-10-11'
      AND SUBSTR(c.ts, 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND SUBSTR(c.ts, 1, 10)::date BETWEEN b.period_start::date AND b.cut_off::date
    ORDER BY c.amount DESC
    LIMIT 2
  LOOP
    i := i + 1;
    INSERT INTO ra_settlement_item_breaks (break_id, batch_id, capture_id, kind, amount, note, is_synthetic)
    VALUES ('BRK-MISS-' || i, rec.batch_id, rec.capture_id, 'missing', rec.amount,
            'Capture not included in settlement batch (wrong cut-off window skip)', 1);
    UPDATE ra_settlement_batches
       SET txn_count = txn_count - 1,
           gross = gross - rec.amount
     WHERE batch_id = rec.batch_id;
  END LOOP;

  -- 2. Duplicate capture: largest in MER004 week ending 2026-10-18
  SELECT c.capture_id, c.amount::double precision, b.batch_id
    INTO rec
    FROM ra_settlement_batches b
    JOIN ra_authorizations a ON a.merchant_id = b.merchant_id
    JOIN ra_captures c ON c.auth_id = a.auth_id
    WHERE b.merchant_id = 'MER004' AND b.cut_off = '2026-10-18'
      AND SUBSTR(c.ts, 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND SUBSTR(c.ts, 1, 10)::date BETWEEN b.period_start::date AND b.cut_off::date
    ORDER BY c.amount DESC
    LIMIT 1;
  IF FOUND THEN
    INSERT INTO ra_settlement_item_breaks (break_id, batch_id, capture_id, kind, amount, note, is_synthetic)
    VALUES ('BRK-DUP-1', rec.batch_id, rec.capture_id, 'duplicate', rec.amount,
            'Capture included twice in the batch', 1);
    UPDATE ra_settlement_batches
       SET txn_count = txn_count + 1,
           gross = gross + rec.amount
     WHERE batch_id = rec.batch_id;
  END IF;

  -- 3. Wrong cut-off: first capture of next week included in MER006 week ending 2026-10-11
  SELECT c.capture_id, c.amount::double precision, b.batch_id
    INTO rec
    FROM ra_settlement_batches b
    JOIN ra_authorizations a ON a.merchant_id = b.merchant_id
    JOIN ra_captures c ON c.auth_id = a.auth_id
    WHERE b.merchant_id = 'MER006' AND b.cut_off = '2026-10-11'
      AND SUBSTR(c.ts, 1, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND SUBSTR(c.ts, 1, 10)::date > b.cut_off::date
    ORDER BY c.ts
    LIMIT 1;
  IF FOUND THEN
    INSERT INTO ra_settlement_item_breaks (break_id, batch_id, capture_id, kind, amount, note, is_synthetic)
    VALUES ('BRK-CUT-1', rec.batch_id, rec.capture_id, 'wrong_cutoff', rec.amount,
            'Capture after cut-off included in this batch', 1);
    UPDATE ra_settlement_batches
       SET txn_count = txn_count + 1,
           gross = gross + rec.amount
     WHERE batch_id = rec.batch_id;
  END IF;

  -- Recompute expected MDR and calculated net from (possibly restated) gross, then inject fee/net breaks
  UPDATE ra_settlement_batches b
     SET mdr_fees_expected = ROUND((b.gross * m.mdr_bps / 10000.0)::numeric, 2),
         mdr_fees = ROUND((b.gross * m.mdr_bps / 10000.0)::numeric, 2),
         net_calculated = ROUND((b.gross - (b.gross * m.mdr_bps / 10000.0) - b.refunds - b.chargebacks - b.reserves + b.adjustments)::numeric, 2),
         net_stated = ROUND((b.gross - (b.gross * m.mdr_bps / 10000.0) - b.refunds - b.chargebacks - b.reserves + b.adjustments)::numeric, 2)
    FROM ra_merchants m
   WHERE m.merchant_id = b.merchant_id;

  -- 4. Fee over-deduction vs contract: MER003 week ending 2026-10-18, +25 bps
  UPDATE ra_settlement_batches b
     SET mdr_fees = ROUND((b.gross * (m.mdr_bps + 25) / 10000.0)::numeric, 2),
         net_calculated = ROUND((b.gross - (b.gross * (m.mdr_bps + 25) / 10000.0) - b.refunds - b.chargebacks - b.reserves + b.adjustments)::numeric, 2),
         net_stated = ROUND((b.gross - (b.gross * (m.mdr_bps + 25) / 10000.0) - b.refunds - b.chargebacks - b.reserves + b.adjustments)::numeric, 2)
    FROM ra_merchants m
   WHERE m.merchant_id = b.merchant_id
     AND b.merchant_id = 'MER003' AND b.cut_off = '2026-10-18';

  -- 5. Net typo vs calculation: MER005 week ending 2026-10-25, understated net by 8,500
  UPDATE ra_settlement_batches
     SET net_stated = ROUND((net_calculated - 8500)::numeric, 2)
   WHERE merchant_id = 'MER005' AND cut_off = '2026-10-25';
END $$;

INSERT INTO ra_settlement_events (event_id, batch_id, status, ts, is_synthetic)
SELECT 'EVT-' || b.batch_id || '-' || e.status,
       b.batch_id,
       e.status,
       e.ts,
       1
FROM ra_settlement_batches b
JOIN ra_merchants m ON m.merchant_id = b.merchant_id
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('open', b.period_start || 'T09:00:00'),
    ('cut_off', b.cut_off || 'T23:59:00'),
    ('calculated', b.cut_off || 'T23:59:00')
  ) v(status, ts)
  UNION ALL
  SELECT 'approved', (b.cut_off::date + 1)::text || 'T11:00:00'
   WHERE b.status IN ('approved', 'funded')
  UNION ALL
  SELECT 'funded', (b.cut_off::date + GREATEST(COALESCE(m.settlement_delay_days, 2), 1))::text || 'T16:30:00'
   WHERE b.status = 'funded'
) e;

-- Funding: one instruction per funded batch, then inject breaks
INSERT INTO ra_funding_transfers (
  funding_id, batch_id, merchant_id, rail, amount, expected_amount,
  instructed_at, value_date, due_date, sla_days, late_days, status,
  dest_account_id, is_duplicate, currency, is_synthetic
)
SELECT
  'FND-' || b.batch_id,
  b.batch_id,
  b.merchant_id,
  CASE
    WHEN b.net_stated >= 200000 THEN 'RTGS'
    WHEN b.net_stated >= 20000 THEN 'NEFT'
    ELSE 'IMPS'
  END,
  b.net_stated,
  b.net_stated,
  ev.ts,
  SUBSTR(ev.ts, 1, 10),
  (b.cut_off::date + GREATEST(COALESCE(m.settlement_delay_days, 2), 1))::text,
  GREATEST(COALESCE(m.settlement_delay_days, 2), 1),
  0,
  'settled',
  'ACC-' || b.merchant_id || '-1',
  0,
  b.currency,
  1
FROM ra_settlement_batches b
JOIN ra_merchants m ON m.merchant_id = b.merchant_id
JOIN ra_settlement_events ev ON ev.batch_id = b.batch_id AND ev.status = 'funded'
WHERE b.status = 'funded';

-- Funding leakage injections
-- Short fund MER001 week ending 2026-10-11
UPDATE ra_funding_transfers f
   SET amount = ROUND((f.expected_amount - 12500)::numeric, 2),
       status = 'settled'
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER001' AND b.cut_off = '2026-10-11';

-- Late vs SLA: MER003 week ending 2026-10-04 (travel, T+3)
UPDATE ra_funding_transfers f
   SET value_date = (f.due_date::date + 4)::text,
       late_days = 4,
       status = 'late',
       instructed_at = (f.due_date::date + 4)::text || 'T18:10:00'
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER003' AND b.cut_off = '2026-10-04';

-- Failed transfer MER007 week ending 2026-10-18
UPDATE ra_funding_transfers f
   SET status = 'failed',
       value_date = NULL,
       late_days = 3
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER007' AND b.cut_off = '2026-10-18';

-- Returned transfer MER008 week ending 2026-10-11
UPDATE ra_funding_transfers f
   SET status = 'returned',
       value_date = (f.due_date::date + 1)::text,
       late_days = 1
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER008' AND b.cut_off = '2026-10-11';

-- Wrong / changed bank account: MER005 week ending 2026-10-04 funds the replaced account
UPDATE ra_funding_transfers f
   SET dest_account_id = 'ACC-MER005-OLD',
       status = 'settled'
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER005' AND b.cut_off = '2026-10-04';

-- Held funds: MER009 week ending 2026-10-25 (and mark batch back to approved / not funded if we want)
UPDATE ra_funding_transfers f
   SET status = 'held',
       value_date = NULL,
       late_days = 5
  FROM ra_settlement_batches b
 WHERE f.batch_id = b.batch_id AND b.merchant_id = 'MER009' AND b.cut_off = '2026-10-25';

-- Duplicate funding: second instruction for MER002 week ending 2026-10-04
INSERT INTO ra_funding_transfers (
  funding_id, batch_id, merchant_id, rail, amount, expected_amount,
  instructed_at, value_date, due_date, sla_days, late_days, status,
  dest_account_id, is_duplicate, currency, is_synthetic
)
SELECT
  'FND-DUP-' || b.batch_id,
  b.batch_id,
  b.merchant_id,
  f.rail,
  f.expected_amount,
  0,
  (f.due_date::date + 1)::text || 'T10:15:00',
  (f.due_date::date + 1)::text,
  f.due_date,
  f.sla_days,
  1,
  'settled',
  f.dest_account_id,
  1,
  f.currency,
  1
FROM ra_funding_transfers f
JOIN ra_settlement_batches b ON b.batch_id = f.batch_id
WHERE b.merchant_id = 'MER002' AND b.cut_off = '2026-10-04' AND f.is_duplicate = 0;

-- The October book has no captures in the week ending 31 Oct, so all generated
-- batches would otherwise be funded. Demote a few last-week batches for a mixed timeline.
DELETE FROM ra_funding_transfers f
 USING ra_settlement_batches b
 WHERE f.batch_id = b.batch_id
   AND b.cut_off = '2026-10-25'
   AND b.merchant_id IN ('MER008', 'MER010')
   AND f.is_duplicate = 0;
DELETE FROM ra_settlement_events e
 USING ra_settlement_batches b
 WHERE e.batch_id = b.batch_id
   AND b.cut_off = '2026-10-25'
   AND b.merchant_id IN ('MER008', 'MER009', 'MER010')
   AND e.status = 'funded';
UPDATE ra_settlement_batches SET status = 'calculated' WHERE cut_off = '2026-10-25' AND merchant_id = 'MER010';
UPDATE ra_settlement_batches SET status = 'approved' WHERE cut_off = '2026-10-25' AND merchant_id IN ('MER008', 'MER009');
INSERT INTO ra_settlement_events (event_id, batch_id, status, ts, is_synthetic)
SELECT 'EVT-' || b.batch_id || '-approved', b.batch_id, 'approved', (b.cut_off::date + 1)::text || 'T11:00:00', 1
FROM ra_settlement_batches b
WHERE b.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM ra_settlement_events e WHERE e.batch_id = b.batch_id AND e.status = 'approved');

-- Acquirer volumes, invoices, passthrough, settlements, statements
INSERT INTO ra_acquirer_invoices (invoice_id, acquirer_id, period, expected_fee, invoiced_fee, invoice_date, is_synthetic)
SELECT
  'AINV-' || acq.acquirer_id || '-2026-10',
  acq.acquirer_id,
  '2026-10',
  ROUND((COALESCE(SUM(c.amount), 0) * acq.acquirer_fee_bps / 10000.0)::numeric, 2),
  ROUND((COALESCE(SUM(c.amount), 0) * (acq.acquirer_fee_bps + CASE WHEN acq.acquirer_id = 'ACQ-AXIS' THEN 4 ELSE 0 END) / 10000.0)::numeric, 2),
  '2026-11-03',
  1
FROM ra_acquirers acq
JOIN ra_merchant_acquirers ma ON ma.acquirer_id = acq.acquirer_id
JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
JOIN ra_captures c ON c.auth_id = a.auth_id
GROUP BY acq.acquirer_id, acq.acquirer_fee_bps;

INSERT INTO ra_acquirer_passthrough (passthrough_id, acquirer_id, period, expected_amount, invoiced_amount, is_synthetic)
SELECT
  'APT-' || acq.acquirer_id || '-2026-10',
  acq.acquirer_id,
  '2026-10',
  ROUND(COALESCE(SUM(s.interchange + s.scheme_fee), 0)::numeric, 2),
  ROUND((COALESCE(SUM(s.interchange + s.scheme_fee), 0) * CASE WHEN acq.acquirer_id = 'ACQ-ICICI' THEN 1.08 ELSE 1 END)::numeric, 2),
  1
FROM ra_acquirers acq
JOIN ra_merchant_acquirers ma ON ma.acquirer_id = acq.acquirer_id
JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
JOIN ra_captures c ON c.auth_id = a.auth_id
JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
GROUP BY acq.acquirer_id;

INSERT INTO ra_acquirer_settlements (aset_id, acquirer_id, period, expected_date, received_date, expected_amount, received_amount, is_synthetic)
SELECT
  'ASET-' || acq.acquirer_id || '-2026-10',
  acq.acquirer_id,
  '2026-10',
  (DATE '2026-10-31' + acq.settlement_days)::text,
  CASE
    WHEN acq.acquirer_id = 'ACQ-SBI' THEN (DATE '2026-10-31' + acq.settlement_days + 3)::text
    ELSE (DATE '2026-10-31' + acq.settlement_days)::text
  END,
  ROUND(COALESCE(SUM(s.net), 0)::numeric, 2),
  ROUND(COALESCE(SUM(s.net), 0)::numeric, 2),
  1
FROM ra_acquirers acq
JOIN ra_merchant_acquirers ma ON ma.acquirer_id = acq.acquirer_id
JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
JOIN ra_captures c ON c.auth_id = a.auth_id
JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
GROUP BY acq.acquirer_id, acq.settlement_days;

INSERT INTO ra_acquirer_statements (stmt_id, acquirer_id, ts, description, amount, ref, is_synthetic)
SELECT
  'ASTMT-' || aset_id,
  acquirer_id,
  received_date,
  'Acquirer settlement ' || period,
  received_amount,
  aset_id,
  1
FROM ra_acquirer_settlements;

-- Unmatched statement credit on SBI (not in settlement)
INSERT INTO ra_acquirer_statements (stmt_id, acquirer_id, ts, description, amount, ref, is_synthetic)
VALUES ('ASTMT-UNM-SBI', 'ACQ-SBI', '2026-10-22', 'Unidentified acquirer bank credit', 18750.00, NULL, 1);

INSERT INTO ra_acquirer_stats
SELECT
  acq.acquirer_id,
  acq.name,
  COALESCE(vol.volume, 0),
  COALESCE(vol.txn_count, 0),
  COALESCE(auth.auth_count, 0),
  CASE WHEN COALESCE(auth.auth_count, 0) = 0 THEN 0
       ELSE ROUND((auth.approved::numeric / auth.auth_count)::numeric, 4) END,
  COALESCE(sch.interchange_plus, 0),
  COALESCE(sch.scheme_fees, 0),
  acq.acquirer_fee_bps,
  inv.expected_fee,
  inv.invoiced_fee,
  pt.expected_amount,
  pt.invoiced_amount,
  st.expected_amount,
  st.received_amount,
  CASE WHEN st.received_date IS NULL THEN 0
       ELSE (st.received_date::date - st.expected_date::date) END
FROM ra_acquirers acq
JOIN ra_acquirer_invoices inv ON inv.acquirer_id = acq.acquirer_id AND inv.period = '2026-10'
JOIN ra_acquirer_passthrough pt ON pt.acquirer_id = acq.acquirer_id AND pt.period = '2026-10'
JOIN ra_acquirer_settlements st ON st.acquirer_id = acq.acquirer_id AND st.period = '2026-10'
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(c.amount), 0)::double precision AS volume, COUNT(*)::int AS txn_count
  FROM ra_merchant_acquirers ma
  JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
  JOIN ra_captures c ON c.auth_id = a.auth_id
  WHERE ma.acquirer_id = acq.acquirer_id
) vol ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS auth_count,
         COUNT(*) FILTER (
           WHERE lower(COALESCE(a.status, '')) NOT IN ('declined', 'expired', 'failed', 'rejected')
         )::int AS approved
  FROM ra_merchant_acquirers ma
  JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
  WHERE ma.acquirer_id = acq.acquirer_id
) auth ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(s.interchange), 0)::double precision AS interchange_plus,
         COALESCE(SUM(s.scheme_fee), 0)::double precision AS scheme_fees
  FROM ra_merchant_acquirers ma
  JOIN ra_authorizations a ON a.merchant_id = ma.merchant_id
  JOIN ra_captures c ON c.auth_id = a.auth_id
  JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
  WHERE ma.acquirer_id = acq.acquirer_id
) sch ON TRUE;

-- Views (exception-row shape)
CREATE VIEW v_ra_settlement_inclusion AS
SELECT
  b.batch_id AS ref_id,
  'settlement'::text AS area,
  CASE WHEN COALESCE(br.n, 0) = 0 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE
    WHEN COALESCE(br.missing, 0) > 0 THEN 'settlement_missing_txn'
    WHEN COALESCE(br.duplicate, 0) > 0 THEN 'settlement_duplicate_txn'
    WHEN COALESCE(br.wrong, 0) > 0 THEN 'settlement_wrong_cutoff'
    ELSE 'settlement_inclusion_ok'
  END AS category,
  b.merchant_id,
  b.cut_off AS ts,
  b.gross_expected AS expected_amount,
  b.gross AS actual_amount,
  ROUND((ABS(b.gross_expected - b.gross))::numeric, 2) AS leakage,
  b.batch_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  b.currency
FROM ra_settlement_batches b
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE kind = 'missing')::int AS missing,
         COUNT(*) FILTER (WHERE kind = 'duplicate')::int AS duplicate,
         COUNT(*) FILTER (WHERE kind = 'wrong_cutoff')::int AS wrong
  FROM ra_settlement_item_breaks x
  WHERE x.batch_id = b.batch_id
) br ON TRUE;

CREATE VIEW v_ra_settlement_fees AS
SELECT
  b.batch_id AS ref_id,
  'settlement'::text AS area,
  CASE WHEN ROUND(b.mdr_fees::numeric, 2) = ROUND(b.mdr_fees_expected::numeric, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN b.mdr_fees > b.mdr_fees_expected + 0.5 THEN 'settlement_fee_overcharge'
    WHEN b.mdr_fees < b.mdr_fees_expected - 0.5 THEN 'settlement_fee_undercharge'
    ELSE 'settlement_fee_ok'
  END AS category,
  b.merchant_id,
  b.cut_off AS ts,
  b.mdr_fees_expected AS expected_amount,
  b.mdr_fees AS actual_amount,
  ROUND((ABS(b.mdr_fees - b.mdr_fees_expected))::numeric, 2) AS leakage,
  b.batch_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  b.currency
FROM ra_settlement_batches b;

CREATE VIEW v_ra_settlement_net AS
SELECT
  b.batch_id AS ref_id,
  'settlement'::text AS area,
  CASE WHEN ROUND(b.net_stated::numeric, 2) = ROUND(b.net_calculated::numeric, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN b.net_stated < b.net_calculated - 0.5 THEN 'settlement_net_mismatch'
    WHEN b.net_stated > b.net_calculated + 0.5 THEN 'settlement_net_overstated'
    ELSE 'settlement_net_ok'
  END AS category,
  b.merchant_id,
  b.cut_off AS ts,
  b.net_calculated AS expected_amount,
  b.net_stated AS actual_amount,
  ROUND((ABS(b.net_calculated - b.net_stated))::numeric, 2) AS leakage,
  b.batch_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  b.currency
FROM ra_settlement_batches b;

CREATE VIEW v_ra_settlement AS
SELECT * FROM v_ra_settlement_inclusion
UNION ALL SELECT * FROM v_ra_settlement_fees
UNION ALL SELECT * FROM v_ra_settlement_net;

CREATE VIEW v_ra_funding AS
SELECT
  f.funding_id AS ref_id,
  'funding'::text AS area,
  CASE
    WHEN f.is_duplicate = 1 THEN 'unmatched'
    WHEN f.status IN ('failed', 'returned', 'held', 'late') THEN 'unmatched'
    WHEN f.dest_account_id IN (SELECT account_id FROM ra_merchant_accounts WHERE is_active = 0) THEN 'unmatched'
    WHEN ABS(f.amount - f.expected_amount) > 0.5 THEN 'variance'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN f.is_duplicate = 1 THEN 'funding_duplicate'
    WHEN f.dest_account_id IN (SELECT account_id FROM ra_merchant_accounts WHERE is_active = 0) THEN 'funding_wrong_account'
    WHEN f.status = 'failed' THEN 'funding_failed'
    WHEN f.status = 'returned' THEN 'funding_returned'
    WHEN f.status = 'held' THEN 'funding_held'
    WHEN f.status = 'late' THEN 'funding_late'
    WHEN f.amount < f.expected_amount - 0.5 THEN 'funding_short'
    WHEN f.amount > f.expected_amount + 0.5 THEN 'funding_over'
    ELSE 'funding_ok'
  END AS category,
  f.merchant_id,
  COALESCE(f.value_date, f.instructed_at) AS ts,
  f.expected_amount,
  f.amount AS actual_amount,
  ROUND((
    CASE
      WHEN f.is_duplicate = 1 THEN f.amount
      WHEN f.dest_account_id IN (SELECT account_id FROM ra_merchant_accounts WHERE is_active = 0) THEN f.amount
      WHEN f.status IN ('failed', 'returned', 'held') THEN f.expected_amount
      ELSE ABS(f.expected_amount - f.amount)
    END
  )::numeric, 2) AS leakage,
  f.funding_id AS recon_ref,
  f.rail AS method,
  NULL::text AS scheme,
  f.currency
FROM ra_funding_transfers f;

CREATE VIEW v_ra_acquirer_fees AS
SELECT
  i.invoice_id AS ref_id,
  'acquirer'::text AS area,
  CASE WHEN ROUND(i.invoiced_fee::numeric, 2) = ROUND(i.expected_fee::numeric, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN i.invoiced_fee > i.expected_fee + 0.5 THEN 'acquirer_fee_overcharge'
    WHEN i.invoiced_fee < i.expected_fee - 0.5 THEN 'acquirer_fee_undercharge'
    ELSE 'acquirer_fee_ok'
  END AS category,
  NULL::text AS merchant_id,
  i.invoice_date AS ts,
  i.expected_fee AS expected_amount,
  i.invoiced_fee AS actual_amount,
  ROUND((ABS(i.invoiced_fee - i.expected_fee))::numeric, 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_acquirer_invoices i;

CREATE VIEW v_ra_acquirer_passthrough AS
SELECT
  p.passthrough_id AS ref_id,
  'acquirer'::text AS area,
  CASE WHEN ROUND(p.invoiced_amount::numeric, 2) = ROUND(p.expected_amount::numeric, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN p.invoiced_amount > p.expected_amount + 0.5 THEN 'acquirer_passthrough_markup'
    ELSE 'acquirer_passthrough_ok'
  END AS category,
  NULL::text AS merchant_id,
  (p.period || '-28') AS ts,
  p.expected_amount AS expected_amount,
  p.invoiced_amount AS actual_amount,
  ROUND((ABS(p.invoiced_amount - p.expected_amount))::numeric, 2) AS leakage,
  p.passthrough_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_acquirer_passthrough p;

CREATE VIEW v_ra_acquirer_timing AS
SELECT
  s.aset_id AS ref_id,
  'acquirer'::text AS area,
  CASE WHEN s.received_date IS NOT NULL AND s.received_date::date <= s.expected_date::date
            AND ROUND(s.received_amount::numeric, 2) = ROUND(s.expected_amount::numeric, 2)
       THEN 'matched' ELSE 'unmatched' END AS status,
  CASE
    WHEN s.received_date IS NULL THEN 'acquirer_settlement_missing'
    WHEN s.received_date::date > s.expected_date::date THEN 'acquirer_settlement_late'
    WHEN ABS(s.received_amount - s.expected_amount) > 0.5 THEN 'acquirer_settlement_amount'
    ELSE 'acquirer_settlement_ok'
  END AS category,
  NULL::text AS merchant_id,
  COALESCE(s.received_date, s.expected_date) AS ts,
  s.expected_amount,
  s.received_amount AS actual_amount,
  ROUND((
    CASE
      WHEN s.received_date IS NOT NULL AND s.received_date::date > s.expected_date::date THEN 0
      WHEN s.received_date IS NULL THEN s.expected_amount
      ELSE ABS(s.expected_amount - s.received_amount)
    END
  )::numeric, 2) AS leakage,
  s.aset_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_acquirer_settlements s;

CREATE VIEW v_ra_acquirer_statement AS
SELECT
  st.stmt_id AS ref_id,
  'acquirer'::text AS area,
  CASE WHEN st.ref IS NOT NULL THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN st.ref IS NOT NULL THEN 'acquirer_statement_ok' ELSE 'acquirer_statement_unmatched' END AS category,
  NULL::text AS merchant_id,
  st.ts,
  CASE WHEN st.ref IS NOT NULL THEN st.amount ELSE 0 END AS expected_amount,
  st.amount AS actual_amount,
  CASE WHEN st.ref IS NOT NULL THEN 0 ELSE ROUND(st.amount::numeric, 2) END AS leakage,
  COALESCE(st.ref, st.stmt_id) AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_acquirer_statements st;

CREATE VIEW v_ra_acquirer AS
SELECT * FROM v_ra_acquirer_fees
UNION ALL SELECT * FROM v_ra_acquirer_passthrough
UNION ALL SELECT * FROM v_ra_acquirer_timing
UNION ALL SELECT * FROM v_ra_acquirer_statement;

DELETE FROM ra_exception_rows WHERE area IN ('settlement', 'funding', 'acquirer');
INSERT INTO ra_exception_rows SELECT * FROM v_ra_settlement WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_funding WHERE status != 'matched' AND (leakage > 0 OR category = 'funding_late');
INSERT INTO ra_exception_rows SELECT * FROM v_ra_acquirer WHERE status != 'matched' AND (leakage > 0 OR category = 'acquirer_settlement_late');

INSERT INTO ra_fee_policies (id, topic, text) VALUES
  ('pol-settlement', 'settlement', 'Settlement batches must include every captured transaction up to the cut-off and no later ones. MDR deducted must match the contracted bps. Batch net equals gross minus MDR, refunds, chargebacks, reserves, plus adjustments.'),
  ('pol-funding', 'funding', 'Funding instructions must equal the approved batch net, credit the merchant''s active account, and complete within the contracted SLA (T+1 / T+2 / T+3). Failed, returned, duplicate or held transfers are exceptions until resolved.'),
  ('pol-acquirer', 'acquirer', 'Acquirer fees invoiced must match the contracted bps on captured volume. Interchange and scheme fees are pass-through with no markup unless contracted. Acquirer settlement must arrive by T+N and match the sponsor-bank statement.')
ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, text = EXCLUDED.text;

INSERT INTO ra_system_map_nodes (id, label, lane, href, x, y) VALUES
  ('acquirer', 'Acquirer / Sponsor', 'scheme', '/acquirer', 420, 340),
  ('settlement', 'Merchant Settlement', 'bank', '/settlement', 640, 340),
  ('funding', 'Merchant Funding', 'bank', '/funding', 860, 460)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, lane = EXCLUDED.lane, href = EXCLUDED.href, x = EXCLUDED.x, y = EXCLUDED.y;

COMMIT;

-- Refresh summaries including the new domains
BEGIN;

CREATE OR REPLACE FUNCTION refresh_ra_summaries() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Area match-rate rollups (run once after seed / when book changes)
  DELETE FROM ra_area_summary;
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT x.area, x.label,
         x.matched, x.unmatched, x.variance,
         ROUND(x.leakage::numeric, 2),
         CASE WHEN x.total = 0 THEN 1 ELSE x.matched::double precision / x.total END,
         x.unmatched + x.variance
  FROM (
    SELECT s.area, s.label,
           SUM(s.matched) matched, SUM(s.unmatched) unmatched, SUM(s.variance) variance,
           SUM(s.leakage) leakage, SUM(s.matched + s.unmatched + s.variance) total
    FROM (
      SELECT 'authorization' area, 'Authorization & Capture' label,
             CASE WHEN status = 'matched' THEN n ELSE 0 END matched,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END unmatched,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END variance,
             COALESCE(leakage,0)::double precision leakage
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_auth_capture GROUP BY status) q
      UNION ALL
      SELECT 'scheme', 'Scheme Settlement',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_capture_scheme
              UNION ALL SELECT status, leakage FROM v_ra_scheme_fee_var
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'bank_trs', 'Bank / TRS',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_scheme_bank
              UNION ALL SELECT status, leakage FROM v_ra_bank_unidentified
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'gateway', 'Gateway Charges',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_gateway GROUP BY status) q
      UNION ALL
      SELECT 'network', 'Network Fees',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_network GROUP BY status) q
      UNION ALL
      SELECT 'partner', 'Partner Fees',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fee_partner GROUP BY status) q
      UNION ALL
      SELECT 'terminal', 'POS Terminals',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_terminal_recon GROUP BY status) q
      UNION ALL
      SELECT 'apm', 'Alternative Payments',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_apm GROUP BY status) q
      UNION ALL
      SELECT 'fx', 'FX & Currency',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fx GROUP BY status) q
      UNION ALL
      SELECT 'pricing', 'Merchant Pricing',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_pricing GROUP BY status) q
      UNION ALL
      SELECT 'payouts', 'Payouts & Reserves',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_payouts GROUP BY status) q
      UNION ALL
      SELECT 'chargebacks', 'Chargebacks & Refunds',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_chargebacks GROUP BY status) q
      UNION ALL
      SELECT 'billing', 'Billing / Rating',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_contract_billing
              UNION ALL SELECT status, leakage FROM v_ra_usage_billing
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'invoicing', 'Invoicing',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_billing_invoice
              UNION ALL SELECT status, leakage FROM v_ra_invoice_tax
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'cash_ar', 'Cash & AR',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_invoice_cash
              UNION ALL SELECT status, leakage FROM v_ra_unapplied_cash
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'vendor', 'Vendor Costs',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_vendor_cost
              UNION ALL SELECT status, leakage FROM v_ra_vendor_pay
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'gl', 'GL / ERP',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_gl_unposted
              UNION ALL SELECT status, leakage FROM v_ra_gl_invoice
            ) z GROUP BY status) q
      UNION ALL
      SELECT 'hops', 'System hops',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM (
              SELECT status, leakage FROM v_ra_gateway_switch
              UNION ALL SELECT status, leakage FROM v_ra_switch_orphan
              UNION ALL SELECT status, leakage FROM v_ra_bank_trs
            ) z GROUP BY status) q

      UNION ALL
      SELECT 'settlement', 'Merchant Settlement',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_settlement GROUP BY status) q
      UNION ALL
      SELECT 'funding', 'Merchant Funding',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_funding GROUP BY status) q
      UNION ALL
      SELECT 'acquirer', 'Acquirer / Sponsor',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_acquirer GROUP BY status) q
    ) s
    GROUP BY s.area, s.label
  ) x;

  DELETE FROM ra_leakage_category;
  INSERT INTO ra_leakage_category (area, category, n, leakage)
  SELECT area, category, COUNT(*)::int, ROUND(SUM(leakage)::numeric, 2)
  FROM ra_exception_rows
  GROUP BY area, category;

  DELETE FROM ra_leakage_trend;
  INSERT INTO ra_leakage_trend (day, leakage, n)
  SELECT SUBSTR(COALESCE(ts, 'unknown'), 1, 10),
         ROUND(SUM(leakage)::numeric, 2),
         COUNT(*)::int
  FROM ra_exception_rows
  WHERE ts IS NOT NULL
  GROUP BY 1;

  DELETE FROM ra_money_flow;
  INSERT INTO ra_money_flow (id, capture, gateway_fees, scheme_gross, scheme_net, bank, payout, leakage_by_area)
  SELECT 1,
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_captures), 0),
         COALESCE((SELECT ROUND(SUM(invoiced)::numeric, 2) FROM ra_gateway_charges), 0),
         COALESCE((SELECT ROUND(SUM(gross)::numeric, 2) FROM ra_scheme_settlements), 0),
         COALESCE((SELECT ROUND(SUM(net)::numeric, 2) FROM ra_scheme_settlements), 0),
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_bank_transactions WHERE recon_ref IS NOT NULL), 0),
         COALESCE((SELECT ROUND(SUM(amount)::numeric, 2) FROM ra_payouts), 0),
         COALESCE((SELECT jsonb_object_agg(area, v) FROM (
           SELECT area, ROUND(SUM(leakage)::numeric, 2) AS v FROM ra_exception_rows GROUP BY area
         ) l), '{}'::jsonb);

  DELETE FROM ra_kpi_summary;
  INSERT INTO ra_kpi_summary (id, total_leakage, recovery_potential, match_rate, exception_count, auth_count, merchant_count)
  SELECT 1,
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows), 0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows), 0),
         COALESCE((SELECT CASE WHEN SUM(matched+unmatched+variance)=0 THEN 1
           ELSE SUM(matched)::double precision / SUM(matched+unmatched+variance) END FROM ra_area_summary), 1),
         COALESCE((SELECT COUNT(*) FROM ra_exception_rows), 0),
         COALESCE((SELECT COUNT(*) FROM ra_authorizations), 0),
         COALESCE((SELECT COUNT(*) FROM ra_merchants), 0);

  DELETE FROM ra_area_series;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'billing', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT charge_type AS name, ROUND(SUM(expected_amount)::numeric,2) AS expected, ROUND(SUM(amount)::numeric,2) AS billed
        FROM ra_billing_lines GROUP BY 1 ORDER BY billed DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'invoicing', 'scheme', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT merchant_id AS name, ROUND(subtotal::numeric,2) AS invoiced, ROUND(gst_amount::numeric,2) AS gst, ROUND(total::numeric,2) AS total
        FROM ra_fin_invoices ORDER BY invoice_date) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'cash_ar', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT category AS name, ROUND(SUM(leakage)::numeric,2) AS value, COUNT(*) AS n
        FROM v_ra_ar_ageing GROUP BY 1 ORDER BY 2 DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'vendor', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT vendor_type AS name, ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced
        FROM ra_vendor_invoices GROUP BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'gl', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT CASE WHEN posted=1 THEN 'posted' ELSE 'unposted' END AS name,
               COUNT(*) AS n,
               ROUND(SUM((SELECT SUM(debit) FROM ra_gl_lines l WHERE l.journal_id = j.journal_id))::numeric,2) AS value
        FROM ra_gl_journals j GROUP BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'hops', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT area || ' ' || category AS name, ROUND(SUM(leakage)::numeric,2) AS value, COUNT(*) AS n
        FROM ra_exception_rows WHERE area = 'hops' GROUP BY 1 ORDER BY 2 DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'fx', 'fx', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT SUBSTR(ts, 1, 10) AS day, ROUND(AVG(applied_rate)::numeric, 4) AS applied, ROUND(AVG(reference_rate)::numeric, 4) AS reference
        FROM ra_fx_conversions GROUP BY 1 ORDER BY 1) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'terminal', 'terminals', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT status, COUNT(*) n, ROUND(SUM(monthly_rental)::numeric, 2) rental FROM ra_terminals GROUP BY status) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'apm', 'apm', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT method, provider, ROUND(SUM(amount)::numeric, 2) AS amount FROM ra_apm_reports GROUP BY method, provider ORDER BY amount DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'partner', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_partner_fees) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'gateway', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_gateway_charges) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'network', 'fees', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT ROUND(SUM(expected)::numeric,2) AS expected, ROUND(SUM(invoiced)::numeric,2) AS invoiced FROM ra_network_fees) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'scheme', 'scheme', COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  FROM (SELECT scheme, COUNT(*) n, ROUND(SUM(gross)::numeric,2) gross, ROUND(SUM(interchange + scheme_fee)::numeric,2) fees, ROUND(SUM(net)::numeric,2) net
        FROM ra_scheme_settlements GROUP BY scheme ORDER BY gross DESC) s;
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT area, 'trend', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.day) FROM ra_leakage_trend t), '[]'::jsonb)
  FROM (VALUES
    ('authorization'),('bank_trs'),('pricing'),('payouts'),('chargebacks')
  ) v(area);


  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'settlement', 'settlement', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key, s.name)
    FROM (
      SELECT 1 AS sort_key, 'waterfall'::text AS kind, 'Gross captures'::text AS name,
             ROUND(SUM(gross)::numeric, 2) AS value, 'total'::text AS step, NULL::int AS n
        FROM ra_settlement_batches
      UNION ALL
      SELECT 2, 'waterfall', 'MDR / fees', -ROUND(SUM(mdr_fees)::numeric, 2), 'deduct', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 3, 'waterfall', 'Refunds', -ROUND(SUM(refunds)::numeric, 2), 'deduct', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 4, 'waterfall', 'Chargebacks', -ROUND(SUM(chargebacks)::numeric, 2), 'deduct', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 5, 'waterfall', 'Reserves', -ROUND(SUM(reserves)::numeric, 2), 'deduct', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 6, 'waterfall', 'Adjustments', ROUND(SUM(adjustments)::numeric, 2), 'add', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 7, 'waterfall', 'Net settlement', ROUND(SUM(net_stated)::numeric, 2), 'net', NULL FROM ra_settlement_batches
      UNION ALL
      SELECT 10, 'status', status, ROUND(SUM(net_stated)::numeric, 2), status, COUNT(*)::int
        FROM ra_settlement_batches GROUP BY status
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'funding', 'funding', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key, s.name)
    FROM (
      SELECT 1 AS sort_key, 'rail'::text AS kind, rail AS name,
             COUNT(*) FILTER (WHERE status = 'settled' AND COALESCE(late_days,0) = 0 AND is_duplicate = 0)::int AS on_time,
             COUNT(*) FILTER (WHERE status = 'late' OR COALESCE(late_days,0) > 0)::int AS late,
             COUNT(*) FILTER (WHERE status IN ('failed','returned'))::int AS failed,
             COUNT(*)::int AS n,
             ROUND(SUM(amount)::numeric, 2) AS amount,
             NULL::text AS day
        FROM ra_funding_transfers GROUP BY rail
      UNION ALL
      SELECT 2, 'ageing', bucket,
             NULL::int, NULL::int, NULL::int, COUNT(*)::int, ROUND(SUM(amt)::numeric, 2), NULL::text
      FROM (
        SELECT CASE
                 WHEN is_duplicate = 1 THEN 'Duplicate'
                 WHEN status = 'failed' THEN 'Failed'
                 WHEN status = 'returned' THEN 'Returned'
                 WHEN status = 'held' THEN 'Held'
                 WHEN COALESCE(late_days,0) >= 8 THEN '8+ days late'
                 WHEN COALESCE(late_days,0) >= 3 THEN '3–7 days late'
                 WHEN COALESCE(late_days,0) >= 1 THEN '1–2 days late'
                 ELSE 'On time'
               END AS bucket,
               amount AS amt
          FROM ra_funding_transfers
      ) a GROUP BY bucket
      UNION ALL
      SELECT 3, 'calendar', d,
             NULL::int, NULL::int, NULL::int, n, amount, d
      FROM (
        SELECT COALESCE(value_date, SUBSTR(instructed_at,1,10)) AS d,
               COUNT(*)::int AS n,
               ROUND(SUM(amount)::numeric, 2) AS amount
          FROM ra_funding_transfers
         GROUP BY 1
      ) c
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'acquirer', 'acquirer', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.volume DESC)
    FROM (
      SELECT 'compare'::text AS kind,
             name,
             ROUND(volume::numeric, 2) AS volume,
             ROUND((approval_rate * 100)::numeric, 1) AS approval_rate,
             ROUND(fee_expected::numeric, 2) AS fee_expected,
             ROUND(fee_invoiced::numeric, 2) AS fee_invoiced,
             ROUND(passthrough_expected::numeric, 2) AS passthrough_expected,
             ROUND(passthrough_invoiced::numeric, 2) AS passthrough_invoiced,
             avg_settle_lag_days AS settle_lag,
             txn_count, auth_count
        FROM ra_acquirer_stats
    ) s
  ), '[]'::jsonb);

  DELETE FROM ra_system_map_edges;
  INSERT INTO ra_system_map_edges (source, target, href, label, leakage, match_rate, exceptions)
  SELECT d.source, d.target, d.href, d.label, s.leakage, s.match_rate, s.exceptions
  FROM (VALUES
    ('crm','billing','/billing','contract↔rating', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_contract_billing GROUP BY status'),
    ('tms','billing','/terminals','rental usage', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_terminal_recon GROUP BY status'),
    ('gateway','switch','/authorization','gateway↔switch', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gateway_switch GROUP BY status'),
    ('switch','clearing','/scheme','switch↔IPM', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_switch_clearing GROUP BY status'),
    ('clearing','scheme','/scheme','clearing↔scheme', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_capture_scheme GROUP BY status'),
    ('scheme','bank','/bank','scheme↔MT940', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_scheme_bank GROUP BY status'),
    ('bank','trs','/bank','MT940↔TRS', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_bank_trs GROUP BY status'),
    ('trs','gl','/gl','TRS↔GL', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gl_unposted GROUP BY status'),
    ('apm','scheme','/apm','APM reports', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_apm GROUP BY status'),
    ('fx','billing','/fx','FX rates', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_fx GROUP BY status'),
    ('switch','billing','/billing','usage↔billed', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_usage_billing GROUP BY status'),
    ('billing','invoicing','/invoicing','billing↔invoice', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_billing_invoice GROUP BY status'),
    ('invoicing','cash','/cash','invoice↔cash', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_invoice_cash GROUP BY status'),
    ('cash','gl','/gl','AR↔GL', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_gl_invoice GROUP BY status'),
    ('scheme_inv','vendor','/vendors','scheme invoices', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_vendor_cost GROUP BY status'),
    ('vendor','gl','/vendors','AP vs payments', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_vendor_pay GROUP BY status'),
    ('trs','payouts','/payouts','net vs payout', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_payouts GROUP BY status'),
    ('scheme','disputes','/chargebacks','chargebacks', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_chargebacks GROUP BY status'),
    ('scheme','acquirer','/acquirer','scheme↔acquirer', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_acquirer_passthrough GROUP BY status'),
    ('acquirer','bank','/acquirer','acquirer statement', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_acquirer_statement GROUP BY status'),
    ('acquirer','settlement','/settlement','acq↔settlement', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_acquirer_timing GROUP BY status'),
    ('trs','settlement','/settlement','treasury↔batch', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_settlement_inclusion GROUP BY status'),
    ('settlement','funding','/funding','batch net↔funding', 'SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_funding GROUP BY status')
  ) AS d(source, target, href, label, q)
  CROSS JOIN LATERAL ra_edge_stats(d.q) s;
END;
$$;


SELECT refresh_ra_summaries();

COMMIT;
