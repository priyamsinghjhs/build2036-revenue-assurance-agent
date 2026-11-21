-- V7b: neuro-symbolic contract expressions, edge-case tests, canonical clearing ingestion
BEGIN;

ALTER TABLE ra_extracted_rules
  ADD COLUMN IF NOT EXISTS rule_name TEXT,
  ADD COLUMN IF NOT EXISTS sql_expression TEXT,
  ADD COLUMN IF NOT EXISTS cap NUMERIC,
  ADD COLUMN IF NOT EXISTS flat_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS tests_passed INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ra_rule_tests (
  test_id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES ra_extracted_rules(rule_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  inputs JSONB NOT NULL,
  expected_numeric NUMERIC(18,4) NOT NULL,
  actual_numeric NUMERIC(18,4),
  passed INT,
  note TEXT,
  ran_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ra_ingest_files (
  file_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  record_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  parsed_at TIMESTAMPTZ,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_canonical_settlement (
  canonical_id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  txn_id TEXT,
  end_to_end_id TEXT,
  msg_id TEXT,
  rrn TEXT,
  upi_txn_id TEXT,
  payment_rail TEXT,
  card_segment TEXT,
  scheme TEXT,
  method TEXT,
  mcc TEXT,
  merchant_id TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  txn_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  recon_amount NUMERIC(18,4),
  settlement_amount NUMERIC(18,4),
  actual_fee NUMERIC(18,4),
  interchange_fee NUMERIC(18,4),
  irf NUMERIC(18,4),
  ird TEXT,
  pds0146_fee NUMERIC(18,4),
  intermediary_charge NUMERIC(18,4),
  charge_agent TEXT,
  response_code TEXT,
  txn_status TEXT,
  p2m_flag TEXT,
  is_rupay_credit BOOLEAN NOT NULL DEFAULT FALSE,
  is_ppi BOOLEAN NOT NULL DEFAULT FALSE,
  tcr5_expected TEXT,
  tcr5_actual TEXT,
  tcr5_qualification TEXT,
  ledger_status TEXT,
  ledger_fee NUMERIC(18,4),
  ts TIMESTAMPTZ,
  is_synthetic INT NOT NULL DEFAULT 1
);

-- Sample contract used by the offline prototype (Schedule A)
INSERT INTO ra_documents (doc_id, kind, title, party, effective_from, effective_to, body_markdown, is_synthetic)
VALUES (
  'DOC-COMMERCIAL-CREDIT-SCHEDULE',
  'agreement',
  'Schedule A — Processing Fees (synthetic commercial credit)',
  'MER-DEMO',
  '2026-04-01',
  NULL,
  E'### Schedule A: Processing Fees\n1. UPI P2M Transactions: Zero (0.00) MDR fee for all transaction values.\n2. Commercial Credit Cards: 0.35% of transaction value for amounts strictly greater than 10,000.00, capped at 150.00 per transaction. Amounts <= 10,000.00 incur a flat fee of 25.00.\n',
  1
)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO ra_extracted_rules (
  rule_id, doc_id, party, fee_type, rate, unit, threshold, cap, flat_fee,
  effective_from, conditions, citation, rule_name, sql_expression, status, source, is_synthetic, tests_passed
) VALUES (
  'RULE-SAMPLE-COMMERCIAL-CAP',
  'DOC-COMMERCIAL-CREDIT-SCHEDULE',
  'MER-DEMO',
  'commercial_credit_mdr',
  0.35,
  'pct',
  10000,
  150,
  25,
  '2026-04-01',
  jsonb_build_object('source_heading','Schedule A: Processing Fees','zero_mdr_rail','UPI'),
  'UPI P2M Transactions: Zero (0.00) MDR fee for all transaction values. Commercial Credit Cards: 0.35% of transaction value for amounts strictly greater than 10,000.00, capped at 150.00 per transaction. Amounts <= 10,000.00 incur a flat fee of 25.00.',
  'UPI zero-MDR and commercial-credit cap',
  'CASE WHEN payment_rail = ''UPI'' THEN CAST(0 AS NUMERIC(18,4)) WHEN payment_rail = ''CARD'' AND card_segment = ''COMMERCIAL_CREDIT'' AND txn_amount > CAST(10000.0000 AS NUMERIC(18,4)) THEN LEAST(CAST(txn_amount * CAST(0.00350000 AS NUMERIC(18,8)) AS NUMERIC(18,4)), CAST(150.0000 AS NUMERIC(18,4))) WHEN payment_rail = ''CARD'' AND card_segment = ''COMMERCIAL_CREDIT'' AND txn_amount <= CAST(10000.0000 AS NUMERIC(18,4)) THEN CAST(25.0000 AS NUMERIC(18,4)) ELSE CAST(0 AS NUMERIC(18,4)) END',
  'extracted',
  'deterministic',
  1,
  0
)
ON CONFLICT (rule_id) DO UPDATE SET
  sql_expression=EXCLUDED.sql_expression, cap=EXCLUDED.cap, flat_fee=EXCLUDED.flat_fee,
  rule_name=EXCLUDED.rule_name, citation=EXCLUDED.citation;

-- Backfill expressions for existing structured rules
UPDATE ra_extracted_rules SET
  rule_name = COALESCE(rule_name, party || ' ' || replace(fee_type, '_', ' ')),
  sql_expression = CASE fee_type
    WHEN 'merchant_rebate' THEN
      'CASE WHEN txn_amount > CAST(' || COALESCE(threshold,0)::text || ' AS NUMERIC(18,4)) THEN CAST(txn_amount * CAST(' || (COALESCE(rate,0)/10000)::text || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) ELSE CAST(0 AS NUMERIC(18,4)) END'
    WHEN 'merchant_mdr_tier' THEN
      'CASE WHEN txn_amount >= CAST(' || COALESCE(threshold,0)::text || ' AS NUMERIC(18,4)) THEN CAST(txn_amount * CAST(' || (COALESCE(rate,0)/10000)::text || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) ELSE CAST(txn_amount * CAST(' || (COALESCE(previous_rate,rate,0)/10000)::text || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) END'
    WHEN 'partner_share_tier' THEN
      'CASE WHEN txn_amount >= CAST(' || COALESCE(threshold,0)::text || ' AS NUMERIC(18,4)) THEN CAST(txn_amount * CAST(' || (COALESCE(rate,0)/10000)::text || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) ELSE CAST(txn_amount * CAST(' || (COALESCE(previous_rate,rate,0)/10000)::text || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) END'
    WHEN 'settlement_sla' THEN 'CAST(0 AS NUMERIC(18,4))'
    ELSE
      'CASE WHEN payment_rail = ''UPI'' AND COALESCE(is_rupay_credit, FALSE) = FALSE THEN CAST(0 AS NUMERIC(18,4)) ELSE CAST(txn_amount * CAST(' ||
        CASE WHEN unit = 'pct' THEN (COALESCE(rate,0)/100)::text ELSE (COALESCE(rate,0)/10000)::text END
      || ' AS NUMERIC(18,8)) AS NUMERIC(18,4)) END'
  END
WHERE sql_expression IS NULL;

INSERT INTO ra_ingest_files (file_id, kind, filename, status, record_count, error_count, notes, parsed_at, is_synthetic) VALUES
  ('ING-CAMT053-20261022', 'camt053', 'camt053_sample.xml', 'parsed', 2, 0, 'ISO 20022 camt.053 synthetic statement. Raw XML is not sent to the LLM.', now(), 1),
  ('ING-NPCI-UPI-20261022', 'npci_upi', 'npci_upi_ntsc_sample.txt', 'parsed', 8, 0, 'NPCI UPI / NTSL-style pipe file. 12-digit RRN and UPI txn id used for matching.', now(), 1),
  ('ING-IPM-20261022', 'mastercard_ipm', 'mastercard_ipm_sample.bin', 'parsed', 3, 0, 'Simplified Mastercard IPM: RDW + EBCDIC (cp500) body with DE4/DE5, PDS 0158, PDS 0146.', now(), 1),
  ('ING-BASEII-20261022', 'visa_baseii', 'visa_baseii_sample.bin', 'parsed', 2, 0, 'Simplified Visa BASE II: 80-byte EBCDIC (cp500) TCR0/TCR1/TCR5 records.', now(), 1)
ON CONFLICT (file_id) DO UPDATE SET record_count=EXCLUDED.record_count, notes=EXCLUDED.notes, status=EXCLUDED.status;

DELETE FROM ra_canonical_settlement;
INSERT INTO ra_canonical_settlement (
  canonical_id, source_file, source_kind, txn_id, end_to_end_id, msg_id, rrn, upi_txn_id,
  payment_rail, card_segment, scheme, method, mcc, merchant_id, currency,
  txn_amount, recon_amount, settlement_amount, actual_fee, interchange_fee, irf, ird, pds0146_fee,
  intermediary_charge, charge_agent, response_code, txn_status, p2m_flag,
  is_rupay_credit, is_ppi, tcr5_expected, tcr5_actual, tcr5_qualification,
  ledger_status, ledger_fee, ts, is_synthetic
) VALUES
  ('CAN-CAMT-001','camt053_sample.xml','camt053','TXN-CAMT-1001','E2E-MER001-1001','CAMT053-20261022-001',NULL,NULL,
   'NEFT','NA',NULL,'credit','5411','MER001','INR',
   25000,25000,25000,0,NULL,NULL,NULL,NULL,
   0,NULL,'00','approved',NULL,FALSE,FALSE,NULL,NULL,NULL,'settled',0,'2026-10-22T18:30:00+05:30',1),
  ('CAN-CAMT-002','camt053_sample.xml','camt053','TXN-CAMT-1002','E2E-MER004-1002','CAMT053-20261022-001',NULL,NULL,
   'NEFT','NA',NULL,'credit',NULL,'MER004','INR',
   18000,17875,17875,125,NULL,NULL,NULL,NULL,
   125,'INTERMEDIARY-SCB','00','approved',NULL,FALSE,FALSE,NULL,NULL,NULL,'settled',125,'2026-10-22T18:30:00+05:30',1),
  ('CAN-UPI-001','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0001','UPI20261022A0001',NULL,'123456789001','UPI20261022A0001',
   'UPI','NA','UPI','upi','5411','MER001','INR',
   1500,1500,1500,0,NULL,NULL,NULL,NULL,0,NULL,'00','approved','P2M',FALSE,FALSE,NULL,NULL,NULL,'approved',0,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-002','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0002','UPI20261022A0002',NULL,'123456789002','UPI20261022A0002',
   'UPI','NA','UPI','upi','5411','MER002','INR',
   3200,3200,3200,25,NULL,NULL,NULL,NULL,0,NULL,'91','timeout','P2M',FALSE,FALSE,NULL,NULL,NULL,'settled',25,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-003','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0003','UPI20261022A0003',NULL,'123456789003','UPI20261022A0003',
   'UPI','COMMERCIAL_CREDIT','RUPAY','upi','6012','MER003','INR',
   4500,4500,4500,36,NULL,NULL,NULL,NULL,0,NULL,'00','approved','P2M',TRUE,FALSE,NULL,NULL,NULL,'approved',36,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-004','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0004','UPI20261022A0004',NULL,'123456789004','UPI20261022A0004',
   'UPI','COMMERCIAL_CREDIT','RUPAY','upi','6012','MER003','INR',
   8000,8000,8000,0,NULL,NULL,NULL,NULL,0,NULL,'00','approved','P2M',TRUE,FALSE,NULL,NULL,NULL,'approved',0,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-005','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0005','UPI20261022A0005',NULL,'123456789005','UPI20261022A0005',
   'UPI','COMMERCIAL_CREDIT','RUPAY','upi','5411','MER003','INR',
   2000,2000,2000,0,NULL,NULL,NULL,NULL,0,NULL,'00','approved','P2M',TRUE,FALSE,NULL,NULL,NULL,'approved',0,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-006','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0006','UPI20261022A0006',NULL,'123456789006','UPI20261022A0006',
   'UPI','NA','PPI','upi','5411','MER006','INR',
   5000,5000,5000,55,55,NULL,NULL,NULL,0,NULL,'00','approved','P2M',FALSE,TRUE,NULL,NULL,NULL,'approved',55,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-007','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0007','UPI20261022A0007',NULL,'123456789007','UPI20261022A0007',
   'UPI','NA','PPI','upi','5411','MER006','INR',
   5000,5000,5000,80,80,NULL,NULL,NULL,0,NULL,'00','approved','P2M',FALSE,TRUE,NULL,NULL,NULL,'approved',80,'2026-10-22T12:00:00+05:30',1),
  ('CAN-UPI-008','npci_upi_ntsc_sample.txt','npci_upi','UPI20261022A0008','UPI20261022A0008',NULL,'123456789008','UPI20261022A0008',
   'UPI','NA','UPI','upi','0000','MER000','INR',
   9000,9000,9000,0,NULL,NULL,NULL,NULL,0,NULL,'00','approved','P2P',FALSE,FALSE,NULL,NULL,NULL,'approved',0,'2026-10-22T12:00:00+05:30',1),
  ('CAN-IPM-001','mastercard_ipm_sample.bin','mastercard_ipm','IPM0001','IPM0001',NULL,NULL,NULL,
   'CARD','CONSUMER_DEBIT','MASTERCARD','card',NULL,'MER004','INR',
   10000,10000,10000,12,12,12,'STD',12,0,NULL,'00','approved','P2M',FALSE,FALSE,NULL,NULL,'STD','settled',12,'2026-10-22T14:00:00+05:30',1),
  ('CAN-IPM-002','mastercard_ipm_sample.bin','mastercard_ipm','IPM0002','IPM0002',NULL,NULL,NULL,
   'CARD','CONSUMER_DEBIT','MASTERCARD','card',NULL,'MER005','USD',
   10000,10300,10300,18,18,18,'STD',18,0,NULL,'00','approved','P2M',FALSE,FALSE,NULL,NULL,'STD','settled',18,'2026-10-22T14:00:00+05:30',1),
  ('CAN-IPM-003','mastercard_ipm_sample.bin','mastercard_ipm','IPM0003','IPM0003',NULL,NULL,NULL,
   'CARD','CONSUMER_DEBIT','MASTERCARD','card',NULL,'MER001','INR',
   7500,7500,7500,9,9,9,'STD',9,0,NULL,'00','approved','P2M',FALSE,FALSE,NULL,NULL,'STD','settled',9,'2026-10-22T14:00:00+05:30',1),
  ('CAN-VISA-001','visa_baseii_sample.bin','visa_baseii','VISA0001','VISA0001',NULL,NULL,NULL,
   'CARD','CONSUMER_DEBIT','VISA','card','5411','MER001','INR',
   20000,20000,20000,20,20,20,'STD',NULL,0,NULL,'00','approved','P2M',FALSE,FALSE,'STANDARD','STANDARD','STANDARD','settled',20,'2026-10-22T15:00:00+05:30',1),
  ('CAN-VISA-002','visa_baseii_sample.bin','visa_baseii','VISA0002','VISA0002',NULL,NULL,NULL,
   'CARD','CONSUMER_DEBIT','VISA','card','5812','MER007','INR',
   15000,15000,15000,45,45,45,'STD',NULL,0,NULL,'00','approved','P2M',FALSE,FALSE,'STANDARD','NONQUAL','NONQUAL','settled',45,'2026-10-22T15:00:00+05:30',1);

CREATE OR REPLACE VIEW v_ra_clearing AS
SELECT canonical_id AS ref_id, merchant_id,
       'clearing_deemed_approved_mdr'::text AS category,
       'unmatched'::text AS status,
       0::numeric AS expected_amount,
       COALESCE(actual_fee, ledger_fee, 0) AS actual_amount,
       COALESCE(actual_fee, ledger_fee, 0) AS leakage,
       COALESCE(rrn, txn_id, canonical_id) AS recon_ref,
       payment_rail AS method, scheme, 'INR'::text AS currency,
       COALESCE(ts::text, '2026-10-22') AS ts
FROM ra_canonical_settlement
WHERE txn_status IN ('timeout','deemed_approved')
  AND (COALESCE(ledger_status,'') = 'settled' OR COALESCE(actual_fee,0) > 0 OR COALESCE(ledger_fee,0) > 0)
UNION ALL
SELECT canonical_id || '-RUPAY', merchant_id, 'clearing_rupay_credit_mdr', 'variance',
       ROUND((txn_amount * 0.0080)::numeric, 4),
       COALESCE(actual_fee,0),
       ROUND(ABS(COALESCE(actual_fee,0) - txn_amount * 0.0080)::numeric, 4),
       COALESCE(upi_txn_id, canonical_id), payment_rail, scheme, currency, COALESCE(ts::text, '2026-10-22')
FROM ra_canonical_settlement
WHERE payment_rail = 'UPI' AND is_rupay_credit AND txn_amount > 2000
  AND ABS(COALESCE(actual_fee,0) - txn_amount * 0.0080) > 0.005
UNION ALL
SELECT canonical_id || '-PPI', merchant_id, 'clearing_ppi_interchange', 'variance',
       ROUND((txn_amount * 0.011)::numeric, 4),
       COALESCE(actual_fee,0),
       ROUND((COALESCE(actual_fee,0) - txn_amount * 0.011)::numeric, 4),
       COALESCE(upi_txn_id, canonical_id), payment_rail, scheme, currency, COALESCE(ts::text, '2026-10-22')
FROM ra_canonical_settlement
WHERE is_ppi AND mcc IN ('5411','5812','5912')
  AND COALESCE(actual_fee,0) - txn_amount * 0.011 > 0.005
UNION ALL
SELECT canonical_id || '-FX', merchant_id, 'clearing_fx_markup', 'variance',
       ROUND((txn_amount * 1.015)::numeric, 4),
       recon_amount,
       ROUND(((recon_amount - txn_amount) - txn_amount * 0.015)::numeric, 4),
       COALESCE(txn_id, canonical_id), payment_rail, scheme, currency, COALESCE(ts::text, '2026-10-22')
FROM ra_canonical_settlement
WHERE source_kind = 'mastercard_ipm' AND txn_amount > 0 AND recon_amount IS NOT NULL
  AND (recon_amount - txn_amount) / txn_amount > 0.015
UNION ALL
SELECT canonical_id || '-DG', merchant_id, 'clearing_interchange_downgrade', 'variance',
       0::numeric, COALESCE(irf, actual_fee, 0), COALESCE(irf, actual_fee, 0),
       COALESCE(txn_id, canonical_id), payment_rail, scheme, currency, COALESCE(ts::text, '2026-10-22')
FROM ra_canonical_settlement
WHERE source_kind = 'visa_baseii' AND tcr5_expected IS NOT NULL AND tcr5_actual IS NOT NULL
  AND tcr5_expected <> tcr5_actual
UNION ALL
SELECT canonical_id || '-CHG', merchant_id, 'clearing_intermediary_charges', 'variance',
       0::numeric, intermediary_charge, intermediary_charge,
       COALESCE(end_to_end_id, canonical_id), payment_rail, scheme, currency, COALESCE(ts::text, '2026-10-22')
FROM ra_canonical_settlement
WHERE source_kind = 'camt053' AND COALESCE(intermediary_charge,0) > 0;

CREATE OR REPLACE VIEW v_ask_clearing AS
SELECT canonical_id, source_kind, txn_id, rrn, upi_txn_id, payment_rail, scheme, merchant_id,
       txn_amount, recon_amount, actual_fee, response_code, txn_status, p2m_flag,
       is_rupay_credit, is_ppi, tcr5_expected, tcr5_actual
FROM ra_canonical_settlement;

GRANT SELECT ON v_ra_clearing, v_ask_clearing, ra_canonical_settlement, ra_ingest_files, ra_rule_tests TO ra_readonly;

CREATE OR REPLACE FUNCTION public.refresh_ra_v7b()
RETURNS void
LANGUAGE plpgsql
AS $v7b$
BEGIN
  DELETE FROM ra_exception_rows WHERE area = 'clearing';
  INSERT INTO ra_exception_rows (
    ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  )
  SELECT ref_id, 'clearing', status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_clearing;

  DELETE FROM ra_area_summary WHERE area = 'clearing';
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT 'clearing', 'Clearing & ingestion',
         (SELECT COUNT(*) FROM ra_canonical_settlement) - (SELECT COUNT(DISTINCT split_part(ref_id,'-',1) || '-' || split_part(ref_id,'-',2) || '-' || split_part(ref_id,'-',3)) FROM v_ra_clearing),
         (SELECT COUNT(*) FROM v_ra_clearing WHERE status='unmatched'),
         (SELECT COUNT(*) FROM v_ra_clearing WHERE status='variance'),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_clearing),0),
         CASE WHEN (SELECT COUNT(*) FROM ra_canonical_settlement)=0 THEN 1
              ELSE 1 - (SELECT COUNT(*) FROM v_ra_clearing)::numeric / GREATEST((SELECT COUNT(*) FROM ra_canonical_settlement),1)
         END,
         (SELECT COUNT(*) FROM v_ra_clearing);

  UPDATE ra_kpi_summary SET
    total_leakage = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    exception_count = (
      SELECT COALESCE(SUM(exception_count),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )
  WHERE id = 1;

  INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
  VALUES
    ('CTL-CLEARING-HEALTH', 'Clearing ingestion health', 'Canonical settlement rows are checked for timeout MDR, interchange downgrades, FX markup and intermediary charges.', 'clearing', 'RA Ops', 'daily', 'Match rate ≥ 90%', 'clearing', '__health__', 1),
    ('CTL-PROC-INGEST', 'File ingestion adapters', 'camt.053, NPCI UPI, IPM and BASE II samples are parsed deterministically; raw files are never sent to an LLM.', 'clearing', 'RA Ops', 'weekly', 'Adapters live', 'clearing', '__process__', 1)
  ON CONFLICT (control_id) DO NOTHING;

  INSERT INTO ra_control_status (control_id, last_run, status, exception_count, leakage, trend, coverage)
  SELECT c.control_id, '2026-10-31',
         CASE
           WHEN c.maps_category='__process__' THEN 'pass'
           WHEN c.maps_category='__health__' THEN CASE WHEN COALESCE(h.match_rate,1) >= 0.90 THEN 'pass' ELSE 'fail' END
           ELSE CASE WHEN COALESCE(x.n,0)=0 THEN 'pass' ELSE 'fail' END
         END,
         CASE WHEN c.maps_category='__health__' THEN COALESCE(h.exception_count,0) ELSE COALESCE(x.n,0) END,
         ROUND((CASE WHEN c.maps_category='__health__' THEN COALESCE(h.leakage,0) ELSE COALESCE(x.leak,0) END)::numeric,2),
         'watch', 1
  FROM ra_controls c
  LEFT JOIN (
    SELECT area, category, COUNT(*)::int AS n, SUM(leakage) AS leak
    FROM ra_exception_rows GROUP BY 1,2
  ) x ON x.area=c.maps_area AND x.category=c.maps_category
  LEFT JOIN ra_area_summary h ON h.area=c.maps_area AND c.maps_category='__health__'
  WHERE c.control_id IN ('CTL-CLEARING-HEALTH','CTL-PROC-INGEST')
  ON CONFLICT (control_id) DO UPDATE SET
    status=EXCLUDED.status, exception_count=EXCLUDED.exception_count, leakage=EXCLUDED.leakage;

  UPDATE ra_governance_kpi SET
    controls_total = (SELECT COUNT(*) FROM ra_controls),
    controls_pass = (SELECT COUNT(*) FROM ra_control_status WHERE status='pass'),
    controls_fail = (SELECT COUNT(*) FROM ra_control_status WHERE status='fail'),
    coverage_pct = 1
  WHERE id = 1;
END;
$v7b$;

CREATE OR REPLACE FUNCTION public.refresh_ra_summaries()
RETURNS void
LANGUAGE plpgsql
AS $wrap$
BEGIN
  PERFORM refresh_ra_summaries_core();
  PERFORM refresh_ra_v7();
  PERFORM refresh_ra_v7b();
END;
$wrap$;

SELECT refresh_ra_v7b();

COMMIT;
