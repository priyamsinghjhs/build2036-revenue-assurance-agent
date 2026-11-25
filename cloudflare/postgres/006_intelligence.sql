-- V7: Contracts RAG, anomalies, routing simulation, cases, ask-data,
-- rule simulation, drafts, learning, file checks, risk library.
-- Free-tier only (Neon + Workers AI). Idempotent. Synthetic October 2026 book.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Documents, chunks, extracted rules
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_ra_contracts CASCADE;
DROP VIEW IF EXISTS v_ra_files CASCADE;
DROP VIEW IF EXISTS v_ask_areas CASCADE;
DROP VIEW IF EXISTS v_ask_exceptions CASCADE;
DROP VIEW IF EXISTS v_ask_controls CASCADE;
DROP VIEW IF EXISTS v_ask_anomalies CASCADE;
DROP VIEW IF EXISTS v_ask_contracts CASCADE;
DROP VIEW IF EXISTS v_ask_cases CASCADE;
DROP VIEW IF EXISTS v_ask_files CASCADE;
DROP VIEW IF EXISTS v_ask_routing CASCADE;
DROP VIEW IF EXISTS v_ask_kpis CASCADE;
DROP VIEW IF EXISTS v_ask_risks CASCADE;

DROP TABLE IF EXISTS ra_case_events CASCADE;
DROP TABLE IF EXISTS ra_case_exceptions CASCADE;
DROP TABLE IF EXISTS ra_case_actions CASCADE;
DROP TABLE IF EXISTS ra_outbound_drafts CASCADE;
DROP TABLE IF EXISTS ra_learning_log CASCADE;
DROP TABLE IF EXISTS ra_learning_policy CASCADE;
DROP TABLE IF EXISTS ra_cases CASCADE;
DROP TABLE IF EXISTS ra_anomaly_events CASCADE;
DROP TABLE IF EXISTS ra_metric_daily CASCADE;
DROP TABLE IF EXISTS ra_routing_sim CASCADE;
DROP TABLE IF EXISTS ra_routing_sim_segments CASCADE;
DROP TABLE IF EXISTS ra_auth_routing CASCADE;
DROP TABLE IF EXISTS ra_extracted_rules CASCADE;
DROP TABLE IF EXISTS ra_document_chunks CASCADE;
DROP TABLE IF EXISTS ra_documents CASCADE;
DROP TABLE IF EXISTS ra_explanations CASCADE;
DROP TABLE IF EXISTS ra_expected_files CASCADE;
DROP TABLE IF EXISTS ra_received_files CASCADE;
DROP TABLE IF EXISTS ra_risk_findings CASCADE;
DROP TABLE IF EXISTS ra_risk_controls CASCADE;
DROP TABLE IF EXISTS ra_risks CASCADE;
DROP TABLE IF EXISTS ra_rule_simulations CASCADE;
DROP TABLE IF EXISTS ra_ask_log CASCADE;
DROP TABLE IF EXISTS ra_intel_kpi CASCADE;

CREATE TABLE ra_documents (
  doc_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  party TEXT,
  effective_from DATE,
  effective_to DATE,
  body_markdown TEXT NOT NULL,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_document_chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES ra_documents(doc_id) ON DELETE CASCADE,
  chunk_no INT NOT NULL,
  heading TEXT,
  clause_ref TEXT,
  body TEXT NOT NULL,
  embedding vector(768),
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_extracted_rules (
  rule_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES ra_documents(doc_id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES ra_document_chunks(chunk_id),
  party TEXT,
  fee_type TEXT NOT NULL,
  rate NUMERIC,
  unit TEXT,
  previous_rate NUMERIC,
  threshold NUMERIC,
  effective_from DATE,
  effective_to DATE,
  conditions JSONB,
  citation TEXT,
  status TEXT NOT NULL DEFAULT 'extracted', -- extracted | approved | rejected
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'deterministic', -- deterministic | llm
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_metric_daily (
  metric TEXT NOT NULL,
  segment TEXT NOT NULL,
  day DATE NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION,
  baseline DOUBLE PRECISION,
  stddev DOUBLE PRECISION,
  zscore DOUBLE PRECISION,
  ewma DOUBLE PRECISION,
  band_lo DOUBLE PRECISION,
  band_hi DOUBLE PRECISION,
  is_anomaly INT NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, segment, day)
);

CREATE TABLE ra_anomaly_events (
  event_id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  segment TEXT NOT NULL,
  day DATE NOT NULL,
  value DOUBLE PRECISION,
  zscore DOUBLE PRECISION,
  impact DOUBLE PRECISION,
  note TEXT,
  investigated_run TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  is_synthetic INT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ra_anomaly_events_signal_entity_period ON ra_anomaly_events (metric, segment, day);

CREATE TABLE ra_auth_routing (
  auth_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  acquirer_id TEXT,
  scheme TEXT,
  method TEXT,
  bin TEXT,
  amount NUMERIC,
  amount_bucket TEXT,
  status TEXT,
  ts TEXT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_routing_sim (
  policy TEXT PRIMARY KEY,
  approval_current DOUBLE PRECISION,
  approval_sim DOUBLE PRECISION,
  approval_uplift DOUBLE PRECISION,
  uplift_lo DOUBLE PRECISION,
  uplift_hi DOUBLE PRECISION,
  fee_current NUMERIC,
  fee_sim NUMERIC,
  fee_savings NUMERIC,
  savings_lo NUMERIC,
  savings_hi NUMERIC,
  n INT,
  note TEXT
);

CREATE TABLE ra_routing_sim_segments (
  policy TEXT NOT NULL,
  segment_kind TEXT NOT NULL,
  segment TEXT NOT NULL,
  n INT,
  approval_uplift DOUBLE PRECISION,
  fee_savings NUMERIC,
  PRIMARY KEY (policy, segment_kind, segment)
);

CREATE TABLE ra_cases (
  case_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cause_key TEXT NOT NULL,
  cause_label TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL, -- new | investigating | awaiting_approval | resolved
  sla_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  leakage NUMERIC,
  exception_count INT,
  label_source TEXT DEFAULT 'deterministic',
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_case_exceptions (
  case_id TEXT REFERENCES ra_cases(case_id) ON DELETE CASCADE,
  exception_id TEXT NOT NULL,
  PRIMARY KEY (case_id, exception_id)
);

CREATE TABLE ra_case_events (
  event_id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES ra_cases(case_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  actor TEXT,
  kind TEXT, -- created | status | comment | assignment | system
  body TEXT
);

CREATE TABLE ra_outbound_drafts (
  draft_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- dispute | claim | data_request
  case_id TEXT,
  exception_id TEXT,
  party TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | rejected
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  note TEXT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_learning_policy (
  id INT PRIMARY KEY CHECK (id = 1),
  auto_close_enabled INT NOT NULL DEFAULT 1,
  max_amount NUMERIC NOT NULL DEFAULT 500,
  min_repeats INT NOT NULL DEFAULT 3,
  min_confidence INT NOT NULL DEFAULT 80,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ra_learning_log (
  log_id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  exception_id TEXT,
  category TEXT,
  amount NUMERIC,
  detail TEXT
);

CREATE TABLE ra_expected_files (
  expected_id TEXT PRIMARY KEY,
  file_kind TEXT NOT NULL, -- scheme | bank | apm
  party TEXT NOT NULL,
  expected_date DATE NOT NULL,
  sequence INT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_received_files (
  received_id TEXT PRIMARY KEY,
  file_kind TEXT NOT NULL,
  party TEXT NOT NULL,
  file_name TEXT,
  expected_date DATE,
  received_at DATE,
  sequence INT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_risks (
  risk_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  description TEXT,
  inherent TEXT,
  residual TEXT,
  is_synthetic INT NOT NULL DEFAULT 1
);

CREATE TABLE ra_risk_controls (
  risk_id TEXT REFERENCES ra_risks(risk_id) ON DELETE CASCADE,
  control_id TEXT NOT NULL,
  PRIMARY KEY (risk_id, control_id)
);

CREATE TABLE ra_risk_findings (
  risk_id TEXT REFERENCES ra_risks(risk_id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  PRIMARY KEY (risk_id, finding_key)
);

CREATE TABLE ra_explanations (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);

CREATE TABLE ra_rule_simulations (
  sim_id TEXT PRIMARY KEY,
  subject TEXT,
  baseline_threshold TEXT,
  new_threshold TEXT,
  baseline_alerts INT,
  new_alerts INT,
  baseline_amount NUMERIC,
  new_amount NUMERIC,
  ran_at TIMESTAMPTZ DEFAULT now(),
  note TEXT
);

CREATE TABLE ra_ask_log (
  log_id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT now(),
  question TEXT,
  sql TEXT,
  status TEXT,
  row_count INT,
  error TEXT
);

CREATE TABLE ra_intel_kpi (
  id INT PRIMARY KEY CHECK (id = 1),
  contracts_pending INT,
  contracts_approved INT,
  contract_leakage NUMERIC,
  anomaly_open INT,
  routing_uplift DOUBLE PRECISION,
  routing_savings NUMERIC,
  cases_open INT,
  cases_overdue INT,
  files_missing INT,
  risks_total INT,
  risks_gap INT,
  refreshed_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ra_documents (doc_id, kind, title, party, effective_from, effective_to, body_markdown, is_synthetic)
VALUES
  ('DOC-ACQ-HDFC-PRICING', 'acquirer_schedule', 'HDFC Bank Acquiring — pricing schedule', 'ACQ-HDFC', '2026-04-01', NULL, $doc$# HDFC Bank Acquiring — Pricing Schedule

Effective 1 April 2026. Synthetic schedule for the October 2026 book.

## Clause 2.1 Acquirer fees
The acquirer fee is 8 bps of gross settled volume for Visa, Mastercard and RuPay consumer transactions. UPI and IMPS are not charged an acquirer fee.

RULE: party=ACQ-HDFC; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY; rate=8; unit=bps; effective_from=2026-04-01

## Clause 2.4 Volume rebate
A volume rebate of 15 bps of merchant MDR on PayStreet Retail (MER001) applies once monthly captured volume exceeds ₹5,00,000. The rebate is credited in the same settlement month and is not discretionary.

RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01; conditions=monthly captured volume exceeds 500000
$doc$, 1),
  ('DOC-ACQ-ICICI-PRICING', 'acquirer_schedule', 'ICICI Merchant Services — pricing schedule', 'ACQ-ICICI', '2026-04-01', NULL, $doc$# ICICI Merchant Services — Pricing Schedule

Effective 1 April 2026.

## Clause 3.1 Acquirer fees
The acquirer fee is 10 bps of gross for card schemes. Settlement is T+2.

RULE: party=ACQ-ICICI; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY,AMEX; rate=10; unit=bps; effective_from=2026-04-01

## Clause 3.3 Tiered settlement
Merchants with monthly card volume above ₹2,00,000 qualify for T+1 settlement at the same fee.

RULE: party=ACQ-ICICI; fee_type=settlement_sla; rate=1; unit=days; threshold=200000; effective_from=2026-04-01
$doc$, 1),
  ('DOC-VISA-BULLETIN-2026-09', 'scheme_bulletin', 'Visa India scheme fee bulletin — September 2026', 'VISA', '2026-10-15', NULL, $doc$# Visa India scheme fee bulletin (September 2026)

To all licensed acquirers. This bulletin is synthetic and for demonstration only.

## Clause 1 Effective date
The fee change in Clause 2 applies to settlements with a settlement date on or after 15 October 2026.

## Clause 2 Scheme fee revision
The Visa consumer scheme fee is revised from 12 bps to 14 bps of gross settled amount. Acquirers must update pricing and accruals from the effective date. No grace period applies.

RULE: party=VISA; fee_type=scheme_fee_change; scheme=VISA; rate=14; unit=bps; previous_rate=12; effective_from=2026-10-15
$doc$, 1),
  ('DOC-MC-BULLETIN-2026-09', 'scheme_bulletin', 'Mastercard India scheme fee bulletin — September 2026', 'MASTERCARD', '2026-10-01', NULL, $doc$# Mastercard India scheme fee bulletin (September 2026)

## Clause 1 Scheme fee
Mastercard consumer scheme fee remains 12 bps of gross for October 2026. No mid-month change.

RULE: party=MASTERCARD; fee_type=scheme_fee; scheme=MASTERCARD; rate=12; unit=bps; effective_from=2026-10-01
$doc$, 1),
  ('DOC-RUPAY-BULLETIN', 'scheme_bulletin', 'RuPay scheme fee bulletin — FY2026', 'RUPAY', '2026-04-01', NULL, $doc$# RuPay scheme fee bulletin

## Clause 1 Fees
RuPay consumer scheme fee is 8 bps of gross. Debit and UPI P2M zero-MDR policy is labelled illustrative in this book and is not restated here.

RULE: party=RUPAY; fee_type=scheme_fee; scheme=RUPAY; rate=8; unit=bps; effective_from=2026-04-01
$doc$, 1),
  ('DOC-MER001-AGREEMENT', 'merchant_agreement', 'PayStreet Retail (MER001) — merchant agreement', 'MER001', '2026-04-01', NULL, $doc$# Merchant agreement — PayStreet Retail (MER001)

Plan: Enterprise 180 bps. Start date 1 April 2026.

## Clause 4.1 MDR
Standard MDR is 180 bps of captured volume plus ₹2 per transaction, with GST at 18% on fees.

RULE: party=MER001; fee_type=merchant_mdr; rate=180; unit=bps; per_txn=2; effective_from=2026-04-01

## Clause 4.3 Volume rebate
If monthly captured volume exceeds ₹5,00,000, a rebate of 15 bps of captured volume is credited that month. The rebate is automatic and does not need a separate claim.

RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01
$doc$, 1),
  ('DOC-MER003-AGREEMENT', 'merchant_agreement', 'TravelNow (MER003) — merchant agreement with tiered MDR', 'MER003', '2026-04-01', NULL, $doc$# Merchant agreement — TravelNow (MER003)

## Clause 5.1 Tiered MDR
Tier 1: monthly captured volume below ₹2,50,000 is billed at 220 bps.
Tier 2: monthly captured volume of ₹2,50,000 or more is billed at 190 bps on the full month's volume, not only the excess. The lower tier is automatic.

RULE: party=MER003; fee_type=merchant_mdr_tier; rate=190; unit=bps; threshold=250000; fallback_rate=220; effective_from=2026-04-01
$doc$, 1),
  ('DOC-MER009-AGREEMENT', 'merchant_agreement', 'HotelAzure (MER009) — merchant agreement (expired)', 'MER009', '2026-04-01', '2026-09-30', $doc$# Merchant agreement — HotelAzure (MER009)

## Clause 1 Term
This agreement is effective 1 April 2026 and ends on 30 September 2026 unless renewed in writing. After expiry, fallback MDR of 200 bps applies until a new agreement is executed, and the 240 bps hospitality plan may not be billed.

RULE: party=MER009; fee_type=expired_terms; rate=200; unit=bps; previous_rate=240; effective_from=2026-04-01; effective_to=2026-09-30
$doc$, 1),
  ('DOC-PAR001-SHARE', 'partner_contract', 'ISO Alpha (PAR001) — revenue-share contract', 'PAR001', '2026-04-01', NULL, $doc$# Partner revenue-share — ISO Alpha (PAR001)

## Clause 6.1 Share
ISO Alpha earns 25 bps of referred captured volume up to ₹3,00,000 in a month, and 18 bps on the full month once the threshold is crossed.

RULE: party=PAR001; fee_type=partner_share_tier; rate=18; unit=bps; threshold=300000; fallback_rate=25; effective_from=2026-04-01
$doc$, 1);

INSERT INTO ra_document_chunks (chunk_id, doc_id, chunk_no, heading, clause_ref, body, is_synthetic)
VALUES
  ('CHK-DOC-ACQ-HDFC-PRICING-01', 'DOC-ACQ-HDFC-PRICING', 1, 'Preamble', 'Preamble', $chk$# HDFC Bank Acquiring — Pricing Schedule

Effective 1 April 2026. Synthetic schedule for the October 2026 book.$chk$, 1),
  ('CHK-DOC-ACQ-HDFC-PRICING-02', 'DOC-ACQ-HDFC-PRICING', 2, 'Clause 2.1 Acquirer fees', 'Clause 2.1 Acquirer fees', $chk$## Clause 2.1 Acquirer fees
The acquirer fee is 8 bps of gross settled volume for Visa, Mastercard and RuPay consumer transactions. UPI and IMPS are not charged an acquirer fee.

RULE: party=ACQ-HDFC; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY; rate=8; unit=bps; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-ACQ-HDFC-PRICING-03', 'DOC-ACQ-HDFC-PRICING', 3, 'Clause 2.4 Volume rebate', 'Clause 2.4 Volume rebate', $chk$## Clause 2.4 Volume rebate
A volume rebate of 15 bps of merchant MDR on PayStreet Retail (MER001) applies once monthly captured volume exceeds ₹5,00,000. The rebate is credited in the same settlement month and is not discretionary.

RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01; conditions=monthly captured volume exceeds 500000$chk$, 1),
  ('CHK-DOC-ACQ-ICICI-PRICING-01', 'DOC-ACQ-ICICI-PRICING', 1, 'Preamble', 'Preamble', $chk$# ICICI Merchant Services — Pricing Schedule

Effective 1 April 2026.$chk$, 1),
  ('CHK-DOC-ACQ-ICICI-PRICING-02', 'DOC-ACQ-ICICI-PRICING', 2, 'Clause 3.1 Acquirer fees', 'Clause 3.1 Acquirer fees', $chk$## Clause 3.1 Acquirer fees
The acquirer fee is 10 bps of gross for card schemes. Settlement is T+2.

RULE: party=ACQ-ICICI; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY,AMEX; rate=10; unit=bps; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-ACQ-ICICI-PRICING-03', 'DOC-ACQ-ICICI-PRICING', 3, 'Clause 3.3 Tiered settlement', 'Clause 3.3 Tiered settlement', $chk$## Clause 3.3 Tiered settlement
Merchants with monthly card volume above ₹2,00,000 qualify for T+1 settlement at the same fee.

RULE: party=ACQ-ICICI; fee_type=settlement_sla; rate=1; unit=days; threshold=200000; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-VISA-BULLETIN-2026-09-01', 'DOC-VISA-BULLETIN-2026-09', 1, 'Preamble', 'Preamble', $chk$# Visa India scheme fee bulletin (September 2026)

To all licensed acquirers. This bulletin is synthetic and for demonstration only.$chk$, 1),
  ('CHK-DOC-VISA-BULLETIN-2026-09-02', 'DOC-VISA-BULLETIN-2026-09', 2, 'Clause 1 Effective date', 'Clause 1 Effective date', $chk$## Clause 1 Effective date
The fee change in Clause 2 applies to settlements with a settlement date on or after 15 October 2026.$chk$, 1),
  ('CHK-DOC-VISA-BULLETIN-2026-09-03', 'DOC-VISA-BULLETIN-2026-09', 3, 'Clause 2 Scheme fee revision', 'Clause 2 Scheme fee revision', $chk$## Clause 2 Scheme fee revision
The Visa consumer scheme fee is revised from 12 bps to 14 bps of gross settled amount. Acquirers must update pricing and accruals from the effective date. No grace period applies.

RULE: party=VISA; fee_type=scheme_fee_change; scheme=VISA; rate=14; unit=bps; previous_rate=12; effective_from=2026-10-15$chk$, 1),
  ('CHK-DOC-MC-BULLETIN-2026-09-01', 'DOC-MC-BULLETIN-2026-09', 1, 'Preamble', 'Preamble', $chk$# Mastercard India scheme fee bulletin (September 2026)$chk$, 1),
  ('CHK-DOC-MC-BULLETIN-2026-09-02', 'DOC-MC-BULLETIN-2026-09', 2, 'Clause 1 Scheme fee', 'Clause 1 Scheme fee', $chk$## Clause 1 Scheme fee
Mastercard consumer scheme fee remains 12 bps of gross for October 2026. No mid-month change.

RULE: party=MASTERCARD; fee_type=scheme_fee; scheme=MASTERCARD; rate=12; unit=bps; effective_from=2026-10-01$chk$, 1),
  ('CHK-DOC-RUPAY-BULLETIN-01', 'DOC-RUPAY-BULLETIN', 1, 'Preamble', 'Preamble', $chk$# RuPay scheme fee bulletin$chk$, 1),
  ('CHK-DOC-RUPAY-BULLETIN-02', 'DOC-RUPAY-BULLETIN', 2, 'Clause 1 Fees', 'Clause 1 Fees', $chk$## Clause 1 Fees
RuPay consumer scheme fee is 8 bps of gross. Debit and UPI P2M zero-MDR policy is labelled illustrative in this book and is not restated here.

RULE: party=RUPAY; fee_type=scheme_fee; scheme=RUPAY; rate=8; unit=bps; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-MER001-AGREEMENT-01', 'DOC-MER001-AGREEMENT', 1, 'Preamble', 'Preamble', $chk$# Merchant agreement — PayStreet Retail (MER001)

Plan: Enterprise 180 bps. Start date 1 April 2026.$chk$, 1),
  ('CHK-DOC-MER001-AGREEMENT-02', 'DOC-MER001-AGREEMENT', 2, 'Clause 4.1 MDR', 'Clause 4.1 MDR', $chk$## Clause 4.1 MDR
Standard MDR is 180 bps of captured volume plus ₹2 per transaction, with GST at 18% on fees.

RULE: party=MER001; fee_type=merchant_mdr; rate=180; unit=bps; per_txn=2; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-MER001-AGREEMENT-03', 'DOC-MER001-AGREEMENT', 3, 'Clause 4.3 Volume rebate', 'Clause 4.3 Volume rebate', $chk$## Clause 4.3 Volume rebate
If monthly captured volume exceeds ₹5,00,000, a rebate of 15 bps of captured volume is credited that month. The rebate is automatic and does not need a separate claim.

RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-MER003-AGREEMENT-01', 'DOC-MER003-AGREEMENT', 1, 'Preamble', 'Preamble', $chk$# Merchant agreement — TravelNow (MER003)$chk$, 1),
  ('CHK-DOC-MER003-AGREEMENT-02', 'DOC-MER003-AGREEMENT', 2, 'Clause 5.1 Tiered MDR', 'Clause 5.1 Tiered MDR', $chk$## Clause 5.1 Tiered MDR
Tier 1: monthly captured volume below ₹2,50,000 is billed at 220 bps.
Tier 2: monthly captured volume of ₹2,50,000 or more is billed at 190 bps on the full month's volume, not only the excess. The lower tier is automatic.

RULE: party=MER003; fee_type=merchant_mdr_tier; rate=190; unit=bps; threshold=250000; fallback_rate=220; effective_from=2026-04-01$chk$, 1),
  ('CHK-DOC-MER009-AGREEMENT-01', 'DOC-MER009-AGREEMENT', 1, 'Preamble', 'Preamble', $chk$# Merchant agreement — HotelAzure (MER009)$chk$, 1),
  ('CHK-DOC-MER009-AGREEMENT-02', 'DOC-MER009-AGREEMENT', 2, 'Clause 1 Term', 'Clause 1 Term', $chk$## Clause 1 Term
This agreement is effective 1 April 2026 and ends on 30 September 2026 unless renewed in writing. After expiry, fallback MDR of 200 bps applies until a new agreement is executed, and the 240 bps hospitality plan may not be billed.

RULE: party=MER009; fee_type=expired_terms; rate=200; unit=bps; previous_rate=240; effective_from=2026-04-01; effective_to=2026-09-30$chk$, 1),
  ('CHK-DOC-PAR001-SHARE-01', 'DOC-PAR001-SHARE', 1, 'Preamble', 'Preamble', $chk$# Partner revenue-share — ISO Alpha (PAR001)$chk$, 1),
  ('CHK-DOC-PAR001-SHARE-02', 'DOC-PAR001-SHARE', 2, 'Clause 6.1 Share', 'Clause 6.1 Share', $chk$## Clause 6.1 Share
ISO Alpha earns 25 bps of referred captured volume up to ₹3,00,000 in a month, and 18 bps on the full month once the threshold is crossed.

RULE: party=PAR001; fee_type=partner_share_tier; rate=18; unit=bps; threshold=300000; fallback_rate=25; effective_from=2026-04-01$chk$, 1);

INSERT INTO ra_extracted_rules (
  rule_id, doc_id, chunk_id, party, fee_type, rate, unit, previous_rate, threshold,
  effective_from, effective_to, conditions, citation, status, approved_by, approved_at, source, is_synthetic
) VALUES
  ('RULE-DOC-ACQ-HDFC-PRICING-02', 'DOC-ACQ-HDFC-PRICING', 'CHK-DOC-ACQ-HDFC-PRICING-02', 'ACQ-HDFC', 'acquirer_fee', 8, 'bps', NULL, NULL, '2026-04-01', NULL,
    jsonb_build_object('scheme','VISA,MASTERCARD,RUPAY','conditions','VISA,MASTERCARD,RUPAY','source_heading','Clause 2.1 Acquirer fees'),
    'RULE: party=ACQ-HDFC; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY; rate=8; unit=bps; effective_from=2026-04-01', 'extracted', NULL, NULL, 'deterministic', 1),
  ('RULE-DOC-ACQ-HDFC-PRICING-03', 'DOC-ACQ-HDFC-PRICING', 'CHK-DOC-ACQ-HDFC-PRICING-03', 'MER001', 'merchant_rebate', 15, 'bps', NULL, 500000, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','monthly captured volume exceeds 500000','source_heading','Clause 2.4 Volume rebate'),
    'RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01; conditions=monthly captured volume exceeds 500000', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-ACQ-ICICI-PRICING-02', 'DOC-ACQ-ICICI-PRICING', 'CHK-DOC-ACQ-ICICI-PRICING-02', 'ACQ-ICICI', 'acquirer_fee', 10, 'bps', NULL, NULL, '2026-04-01', NULL,
    jsonb_build_object('scheme','VISA,MASTERCARD,RUPAY,AMEX','conditions','VISA,MASTERCARD,RUPAY,AMEX','source_heading','Clause 3.1 Acquirer fees'),
    'RULE: party=ACQ-ICICI; fee_type=acquirer_fee; scheme=VISA,MASTERCARD,RUPAY,AMEX; rate=10; unit=bps; effective_from=2026-04-01', 'extracted', NULL, NULL, 'deterministic', 1),
  ('RULE-DOC-ACQ-ICICI-PRICING-03', 'DOC-ACQ-ICICI-PRICING', 'CHK-DOC-ACQ-ICICI-PRICING-03', 'ACQ-ICICI', 'settlement_sla', 1, 'days', NULL, 200000, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 3.3 Tiered settlement'),
    'RULE: party=ACQ-ICICI; fee_type=settlement_sla; rate=1; unit=days; threshold=200000; effective_from=2026-04-01', 'extracted', NULL, NULL, 'deterministic', 1),
  ('RULE-DOC-VISA-BULLETIN-2026-09-03', 'DOC-VISA-BULLETIN-2026-09', 'CHK-DOC-VISA-BULLETIN-2026-09-03', 'VISA', 'scheme_fee_change', 14, 'bps', 12, NULL, '2026-10-15', NULL,
    jsonb_build_object('scheme','VISA','conditions','VISA','source_heading','Clause 2 Scheme fee revision'),
    'RULE: party=VISA; fee_type=scheme_fee_change; scheme=VISA; rate=14; unit=bps; previous_rate=12; effective_from=2026-10-15', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-MC-BULLETIN-2026-09-02', 'DOC-MC-BULLETIN-2026-09', 'CHK-DOC-MC-BULLETIN-2026-09-02', 'MASTERCARD', 'scheme_fee', 12, 'bps', NULL, NULL, '2026-10-01', NULL,
    jsonb_build_object('scheme','MASTERCARD','conditions','MASTERCARD','source_heading','Clause 1 Scheme fee'),
    'RULE: party=MASTERCARD; fee_type=scheme_fee; scheme=MASTERCARD; rate=12; unit=bps; effective_from=2026-10-01', 'extracted', NULL, NULL, 'deterministic', 1),
  ('RULE-DOC-RUPAY-BULLETIN-02', 'DOC-RUPAY-BULLETIN', 'CHK-DOC-RUPAY-BULLETIN-02', 'RUPAY', 'scheme_fee', 8, 'bps', NULL, NULL, '2026-04-01', NULL,
    jsonb_build_object('scheme','RUPAY','conditions','RUPAY','source_heading','Clause 1 Fees'),
    'RULE: party=RUPAY; fee_type=scheme_fee; scheme=RUPAY; rate=8; unit=bps; effective_from=2026-04-01', 'extracted', NULL, NULL, 'deterministic', 1),
  ('RULE-DOC-MER001-AGREEMENT-02', 'DOC-MER001-AGREEMENT', 'CHK-DOC-MER001-AGREEMENT-02', 'MER001', 'merchant_mdr', 180, 'bps', NULL, NULL, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 4.1 MDR'),
    'RULE: party=MER001; fee_type=merchant_mdr; rate=180; unit=bps; per_txn=2; effective_from=2026-04-01', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-MER001-AGREEMENT-03', 'DOC-MER001-AGREEMENT', 'CHK-DOC-MER001-AGREEMENT-03', 'MER001', 'merchant_rebate', 15, 'bps', NULL, 500000, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 4.3 Volume rebate'),
    'RULE: party=MER001; fee_type=merchant_rebate; rate=15; unit=bps; threshold=500000; effective_from=2026-04-01', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-MER003-AGREEMENT-02', 'DOC-MER003-AGREEMENT', 'CHK-DOC-MER003-AGREEMENT-02', 'MER003', 'merchant_mdr_tier', 190, 'bps', 220, 250000, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 5.1 Tiered MDR'),
    'RULE: party=MER003; fee_type=merchant_mdr_tier; rate=190; unit=bps; threshold=250000; fallback_rate=220; effective_from=2026-04-01', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-MER009-AGREEMENT-02', 'DOC-MER009-AGREEMENT', 'CHK-DOC-MER009-AGREEMENT-02', 'MER009', 'expired_terms', 200, 'bps', 240, NULL, '2026-04-01', '2026-09-30',
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 1 Term'),
    'RULE: party=MER009; fee_type=expired_terms; rate=200; unit=bps; previous_rate=240; effective_from=2026-04-01; effective_to=2026-09-30', 'approved', 'Priyam Singh', '2026-10-31T10:00:00+05:30', 'deterministic', 1),
  ('RULE-DOC-PAR001-SHARE-02', 'DOC-PAR001-SHARE', 'CHK-DOC-PAR001-SHARE-02', 'PAR001', 'partner_share_tier', 18, 'bps', 25, 300000, '2026-04-01', NULL,
    jsonb_build_object('scheme','','conditions','','source_heading','Clause 6.1 Share'),
    'RULE: party=PAR001; fee_type=partner_share_tier; rate=18; unit=bps; threshold=300000; fallback_rate=25; effective_from=2026-04-01', 'extracted', NULL, NULL, 'deterministic', 1);


-- ---------------------------------------------------------------------------
-- Reviews (human auditor queue)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ra_review_decisions (
  review_id TEXT PRIMARY KEY,
  run_id TEXT,
  exception_id TEXT NOT NULL,
  decision TEXT NOT NULL, -- approved | rejected | reinvestigate
  comment TEXT NOT NULL,
  amount_override NUMERIC,
  reviewer TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_id TEXT
);

CREATE OR REPLACE VIEW v_ra_review_queue AS
SELECT
  r.run_id,
  regexp_replace(r.scope, '^exception:', '') AS exception_id,
  split_part(regexp_replace(r.scope, '^exception:', ''), ':', 1) AS domain,
  r.started_at,
  r.completed_at,
  aud.output_json::jsonb AS auditor_json,
  inv.output_json::jsonb AS investigator_json,
  act.output_json::jsonb AS action_json,
  d.decision,
  d.decided_at,
  d.reviewer,
  CASE WHEN d.review_id IS NULL THEN 'pending' ELSE d.decision END AS review_status
FROM ra_agent_runs r
JOIN LATERAL (
  SELECT output_json, created_at FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'auditor'
  ORDER BY created_at DESC LIMIT 1
) aud ON true
LEFT JOIN LATERAL (
  SELECT output_json FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'investigator'
  ORDER BY created_at DESC LIMIT 1
) inv ON true
LEFT JOIN LATERAL (
  SELECT output_json FROM ra_agent_outputs
  WHERE run_id = r.run_id AND agent_id = 'action'
  ORDER BY created_at DESC LIMIT 1
) act ON true
LEFT JOIN LATERAL (
  SELECT * FROM ra_review_decisions d0
  WHERE d0.run_id = r.run_id OR d0.exception_id = regexp_replace(r.scope, '^exception:', '')
  ORDER BY d0.decided_at DESC LIMIT 1
) d ON true
WHERE r.scope LIKE 'exception:%'
  AND (
    aud.output_json::text ILIKE '%needs_review%'
    OR COALESCE(aud.output_json::jsonb->>'signoff','') = 'needs_review'
  );

-- ---------------------------------------------------------------------------
-- Read-only ask role and stable views
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ra_readonly') THEN
    CREATE ROLE ra_readonly NOLOGIN;
  END IF;
END$$;
GRANT ra_readonly TO CURRENT_USER;

CREATE OR REPLACE VIEW v_ask_kpis AS
SELECT total_leakage, recovery_potential, match_rate, exception_count, auth_count, merchant_count
FROM ra_kpi_summary WHERE id = 1;

CREATE OR REPLACE VIEW v_ask_areas AS
SELECT area, label, matched, unmatched, variance, leakage, match_rate, exception_count
FROM ra_area_summary;

CREATE OR REPLACE VIEW v_ask_exceptions AS
SELECT area, category, ref_id, merchant_id, ts, expected_amount, actual_amount, leakage, scheme, method, status,
       area || ':' || category || ':' || ref_id AS exception_id
FROM ra_exception_rows;

CREATE OR REPLACE VIEW v_ask_controls AS
SELECT c.control_id, c.name, c.domain, c.owner, c.frequency, c.threshold, s.status, s.exception_count, s.leakage
FROM ra_controls c
LEFT JOIN ra_control_status s ON s.control_id = c.control_id;

-- placeholders; replaced after dependent tables are filled via CREATE OR REPLACE later
CREATE OR REPLACE VIEW v_ask_anomalies AS
SELECT metric, segment, day, value, zscore, is_anomaly FROM ra_metric_daily WHERE is_anomaly = 1;

CREATE OR REPLACE VIEW v_ask_contracts AS
SELECT rule_id, doc_id, party, fee_type, rate, unit, threshold, status, citation
FROM ra_extracted_rules;

CREATE OR REPLACE VIEW v_ask_cases AS
SELECT case_id, title, cause_key, cause_label, owner, status, leakage, exception_count, sla_due
FROM ra_cases;

CREATE OR REPLACE VIEW v_ask_files AS
SELECT expected_id, file_kind, party, expected_date, sequence FROM ra_expected_files;

CREATE OR REPLACE VIEW v_ask_routing AS
SELECT policy, approval_current, approval_sim, approval_uplift, fee_current, fee_sim, fee_savings, n
FROM ra_routing_sim;

CREATE OR REPLACE VIEW v_ask_risks AS
SELECT risk_id, name, domain, inherent, residual, description FROM ra_risks;

GRANT USAGE ON SCHEMA public TO ra_readonly;
GRANT SELECT ON
  v_ask_kpis, v_ask_areas, v_ask_exceptions, v_ask_controls,
  v_ask_anomalies, v_ask_contracts, v_ask_cases, v_ask_files, v_ask_routing, v_ask_risks,
  ra_area_summary, ra_exception_rows, ra_kpi_summary, ra_leakage_category, ra_hop_daily,
  ra_governance_kpi, ra_controls, ra_control_status, ra_metric_daily, ra_anomaly_events,
  ra_extracted_rules, ra_documents, ra_cases, ra_routing_sim, ra_routing_sim_segments,
  ra_expected_files, ra_received_files, ra_risks, ra_intel_kpi, ra_review_decisions
TO ra_readonly;

-- ---------------------------------------------------------------------------
-- Learning policy, risks, explanations (static seeds)
-- ---------------------------------------------------------------------------
INSERT INTO ra_learning_policy (id, auto_close_enabled, max_amount, min_repeats, min_confidence)
VALUES (1, 1, 500, 3, 80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ra_risks (risk_id, name, domain, description, inherent, residual, is_synthetic) VALUES
  ('RSK-MDR', 'MDR and pricing leakage', 'pricing', 'Billed MDR diverges from contracted or bulletin rates, including unapplied rebates and wrong tiers.', 'high', 'medium', 1),
  ('RSK-SETTLE', 'Settlement completeness', 'settlement', 'Captures omitted from batches, late cut-off, gross-to-net errors.', 'high', 'medium', 1),
  ('RSK-SCHEME', 'Scheme fee and file integrity', 'scheme', 'Scheme fee changes not applied; missing or out-of-sequence clearing files.', 'high', 'medium', 1),
  ('RSK-FUND', 'Funding and bank completeness', 'funding', 'Short, late, returned or misdirected merchant funding.', 'high', 'medium', 1),
  ('RSK-TAX', 'Tax and regulatory', 'tax', 'GST, TDS and illustrative zero-MDR / limit breaches.', 'medium', 'medium', 1),
  ('RSK-KYC', 'KYC and profile assurance', 'kyc', 'Transacting with expired or pending KYC, MCC or limit breaches.', 'high', 'high', 1),
  ('RSK-AML', 'AML and fraud typologies', 'aml', 'Structuring, refund abuse, round-tripping, velocity and dormant bursts.', 'high', 'medium', 1),
  ('RSK-NET', 'Network and entity risk', 'network_risk', 'Shared devices or accounts, known-bad proximity, changed beneficiaries.', 'high', 'medium', 1),
  ('RSK-CFG', 'Unauthorised configuration change', 'config', 'Pricing, fee or limit changes without approval.', 'medium', 'medium', 1),
  ('RSK-OPS', 'Interface and operations', 'interfaces', 'Message drops, duplicates, hop latency and success-rate deterioration.', 'medium', 'low', 1)
ON CONFLICT (risk_id) DO NOTHING;

INSERT INTO ra_risk_controls (risk_id, control_id)
SELECT 'RSK-MDR', control_id FROM ra_controls WHERE domain IN ('pricing','billing','invoicing','contracts','config')
UNION ALL
SELECT 'RSK-SETTLE', control_id FROM ra_controls WHERE domain IN ('settlement','funding')
UNION ALL
SELECT 'RSK-SCHEME', control_id FROM ra_controls WHERE domain IN ('scheme','files','acquirer')
UNION ALL
SELECT 'RSK-FUND', control_id FROM ra_controls WHERE domain IN ('funding','bank_trs','payouts')
UNION ALL
SELECT 'RSK-TAX', control_id FROM ra_controls WHERE domain = 'tax'
UNION ALL
SELECT 'RSK-KYC', control_id FROM ra_controls WHERE domain = 'kyc'
UNION ALL
SELECT 'RSK-AML', control_id FROM ra_controls WHERE domain = 'aml'
UNION ALL
SELECT 'RSK-NET', control_id FROM ra_controls WHERE domain = 'network_risk'
UNION ALL
SELECT 'RSK-CFG', control_id FROM ra_controls WHERE domain = 'config'
UNION ALL
SELECT 'RSK-OPS', control_id FROM ra_controls WHERE domain IN ('interfaces','hops','success','authorization')
ON CONFLICT DO NOTHING;

INSERT INTO ra_risk_findings (risk_id, finding_key) VALUES
  ('RSK-MDR', 'contract_unapplied_rebate'),
  ('RSK-MDR', 'contract_wrong_tier'),
  ('RSK-MDR', 'contract_expired_terms'),
  ('RSK-SCHEME', 'contract_fee_change_unapplied'),
  ('RSK-SCHEME', 'file_missing'),
  ('RSK-SCHEME', 'file_out_of_sequence'),
  ('RSK-TAX', 'tax_gst_wrong_rate'),
  ('RSK-TAX', 'tax_tds_shortfall'),
  ('RSK-KYC', 'kyc_pending_transacting'),
  ('RSK-KYC', 'kyc_expired_transacting'),
  ('RSK-AML', 'aml_structuring'),
  ('RSK-NET', 'network_shared_account'),
  ('RSK-CFG', 'config_unapproved'),
  ('RSK-OPS', 'interface_drop'),
  ('RSK-SETTLE', 'settlement_missing_txn'),
  ('RSK-FUND', 'funding_short')
ON CONFLICT DO NOTHING;

INSERT INTO ra_explanations (subject_type, subject_id, text, source)
SELECT 'control', c.control_id,
       'Control ' || c.name || ' (' || c.control_id || ') is owned by ' || COALESCE(c.owner,'RA Ops')
       || ' and runs ' || COALESCE(c.frequency,'daily') || '. Objective: ' || COALESCE(c.objective, c.name)
       || ' Threshold: ' || COALESCE(c.threshold, 'n/a')
       || '. The result is computed from pre-aggregated Neon summaries; the model only explains this text, it does not recompute the threshold.',
       'deterministic'
FROM ra_controls c
ON CONFLICT DO NOTHING;

INSERT INTO ra_explanations (subject_type, subject_id, text, source) VALUES
  ('formula', 'zscore', 'Rolling z-score = (value − mean of prior days in the window) / standard deviation of that window. A point is flagged when |z| ≥ 2.5 or the value sits outside the EWMA ± 2σ band. This is a statistical sensor, not a booked leakage figure.', 'deterministic'),
  ('formula', 'ewma', 'EWMA_t = 0.3 × value_t + 0.7 × EWMA_{t−1}, seeded with the first observation. The shaded band is EWMA ± 2 × rolling standard deviation (minimum 7 prior days when available).', 'deterministic'),
  ('formula', 'thompson', 'Thompson sampling in this simulation draws a Beta(1+approvals, 1+declines) sample per acquirer in the same scheme/method/amount bucket, then picks the highest draw. Counterfactual approval probability is the historical rate of the chosen acquirer in that bucket. This is an offline replay on synthetic data, not a live router.', 'deterministic'),
  ('formula', 'egreedy', 'Epsilon-greedy (ε = 0.1) picks the acquirer with the best historical approval rate in the bucket with probability 0.9, otherwise a uniform random eligible acquirer. Fees use each acquirer''s contract bps on the expected approved amount.', 'deterministic')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- File ledger (scheme / APM / bank)
-- ---------------------------------------------------------------------------
INSERT INTO ra_expected_files (expected_id, file_kind, party, expected_date, sequence, is_synthetic)
SELECT
  'EXP-IPM-' || s.scheme || '-' || to_char(d.day, 'YYYYMMDD'),
  'scheme', s.scheme, d.day,
  (d.day::date - DATE '2026-10-01') + 1,
  1
FROM (SELECT DISTINCT scheme FROM ra_clearing_records WHERE scheme IN ('VISA','MASTERCARD','RUPAY','AMEX')) s
CROSS JOIN generate_series(DATE '2026-10-01', DATE '2026-10-31', INTERVAL '1 day') AS d(day)
WHERE EXTRACT(ISODOW FROM d.day) < 7;

INSERT INTO ra_received_files (received_id, file_kind, party, file_name, expected_date, received_at, sequence, is_synthetic)
SELECT DISTINCT
  'RCV-' || file_id,
  'scheme',
  scheme,
  file_id,
  CASE WHEN file_id ~ '[0-9]{8}$' THEN to_date(right(file_id, 8), 'YYYYMMDD') END,
  CASE WHEN file_id ~ '[0-9]{8}$' THEN to_date(right(file_id, 8), 'YYYYMMDD') END,
  CASE WHEN file_id ~ '[0-9]{8}$' THEN (to_date(right(file_id, 8), 'YYYYMMDD') - DATE '2026-10-01') + 1 END,
  1
FROM ra_clearing_records
WHERE file_id IS NOT NULL;

-- APM daily expectations for providers that reported at least once
INSERT INTO ra_expected_files (expected_id, file_kind, party, expected_date, sequence, is_synthetic)
SELECT
  'EXP-APM-' || p.provider || '-' || to_char(d.day, 'YYYYMMDD'),
  'apm', p.provider, d.day,
  (d.day::date - DATE '2026-10-01') + 1, 1
FROM (SELECT DISTINCT provider FROM ra_apm_reports) p
CROSS JOIN generate_series(DATE '2026-10-01', DATE '2026-10-31', INTERVAL '1 day') AS d(day)
WHERE EXTRACT(ISODOW FROM d.day) < 7;

INSERT INTO ra_received_files (received_id, file_kind, party, file_name, expected_date, received_at, sequence, is_synthetic)
SELECT
  'RCV-APM-' || provider || '-' || to_char(report_date::date, 'YYYYMMDD'),
  'apm', provider,
  'APM-' || provider || '-' || to_char(report_date::date, 'YYYYMMDD'),
  report_date::date, report_date::date,
  (report_date::date - DATE '2026-10-01') + 1, 1
FROM (SELECT DISTINCT provider, report_date FROM ra_apm_reports) z
ON CONFLICT DO NOTHING;

-- Bank statements: four weekly files expected, two present
INSERT INTO ra_expected_files (expected_id, file_kind, party, expected_date, sequence, is_synthetic) VALUES
  ('EXP-BANK-MT940-20261007', 'bank', 'TRS', DATE '2026-10-07', 1, 1),
  ('EXP-BANK-MT940-20261014', 'bank', 'TRS', DATE '2026-10-14', 2, 1),
  ('EXP-BANK-MT940-20261021', 'bank', 'TRS', DATE '2026-10-21', 3, 1),
  ('EXP-BANK-MT940-20261028', 'bank', 'TRS', DATE '2026-10-28', 4, 1);

INSERT INTO ra_received_files (received_id, file_kind, party, file_name, expected_date, received_at, sequence, is_synthetic)
SELECT
  'RCV-BANK-' || statement_id, 'bank', 'TRS', statement_id,
  statement_date::date, statement_date::date,
  CASE WHEN statement_date::date <= DATE '2026-10-14' THEN 1 ELSE 3 END,
  1
FROM ra_bank_statements;

-- Inject one out-of-sequence scheme file (VISA 28 dated as if it arrived early under a late name)
INSERT INTO ra_received_files (received_id, file_kind, party, file_name, expected_date, received_at, sequence, is_synthetic)
VALUES ('RCV-IPM-VISA-OOS', 'scheme', 'VISA', 'IPM-VISA-20261028-EARLY', DATE '2026-10-28', DATE '2026-10-20', 28, 1)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Auth routing context (do not ALTER ra_authorizations)
-- ---------------------------------------------------------------------------
INSERT INTO ra_auth_routing (auth_id, merchant_id, acquirer_id, scheme, method, bin, amount, amount_bucket, status, ts, is_synthetic)
SELECT
  a.auth_id, a.merchant_id, ma.acquirer_id, a.scheme, a.method,
  CASE a.scheme
    WHEN 'VISA' THEN '414367'
    WHEN 'MASTERCARD' THEN '527521'
    WHEN 'RUPAY' THEN '607384'
    WHEN 'AMEX' THEN '377812'
    ELSE '000000'
  END || lpad((abs(hashtext(a.auth_id)) % 1000)::text, 3, '0'),
  a.amount,
  CASE
    WHEN a.amount < 1000 THEN 'L'
    WHEN a.amount < 5000 THEN 'M'
    ELSE 'H'
  END,
  a.status, a.ts, 1
FROM ra_authorizations a
LEFT JOIN ra_merchant_acquirers ma ON ma.merchant_id = a.merchant_id;

-- ---------------------------------------------------------------------------
-- Contract validation view (approved rules only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ra_contracts AS
WITH vol AS (
  SELECT merchant_id,
         ROUND(SUM(amount) FILTER (WHERE status='approved')::numeric, 2) AS captured,
         COUNT(*) FILTER (WHERE status='approved') AS n
  FROM ra_authorizations GROUP BY 1
), billed AS (
  SELECT merchant_id,
         ROUND(SUM(gross)::numeric, 2) AS gross,
         ROUND(SUM(mdr_fees)::numeric, 2) AS mdr
  FROM ra_settlement_batches GROUP BY 1
), rebate AS (
  SELECT DISTINCT ON (r.party, r.fee_type)
         r.rule_id, r.party AS merchant_id, r.fee_type,
         v.captured AS expected_amount,
         0::numeric AS actual_amount,
         ROUND((v.captured * r.rate / 10000)::numeric, 2) AS leakage,
         'unapplied' AS status, 'contract_unapplied_rebate' AS category,
         r.rule_id AS recon_ref, NULL::text AS method, NULL::text AS scheme, 'INR'::text AS currency
  FROM ra_extracted_rules r
  JOIN vol v ON v.merchant_id = r.party
  WHERE r.status = 'approved' AND r.fee_type = 'merchant_rebate'
    AND v.captured >= COALESCE(r.threshold, 0)
  ORDER BY r.party, r.fee_type, r.rule_id
), tier AS (
  SELECT r.rule_id, r.party AS merchant_id, r.fee_type,
         ROUND((COALESCE(b.gross, v.captured) * r.rate / 10000)::numeric, 2) AS expected_amount,
         COALESCE(b.mdr, 0) AS actual_amount,
         ROUND(GREATEST(COALESCE(b.mdr, 0) - (COALESCE(b.gross, v.captured) * r.rate / 10000), 0)::numeric, 2) AS leakage,
         'variance' AS status, 'contract_wrong_tier' AS category,
         r.rule_id AS recon_ref, NULL::text AS method, NULL::text AS scheme, 'INR'::text AS currency
  FROM ra_extracted_rules r
  JOIN vol v ON v.merchant_id = r.party
  LEFT JOIN billed b ON b.merchant_id = r.party
  WHERE r.status = 'approved' AND r.fee_type = 'merchant_mdr_tier'
    AND v.captured >= COALESCE(r.threshold, 0)
), fee_chg AS (
  SELECT r.rule_id, NULL::text AS merchant_id, r.fee_type,
         ROUND((SUM(s.gross) * r.rate / 10000)::numeric, 2) AS expected_amount,
         ROUND(SUM(s.scheme_fee)::numeric, 2) AS actual_amount,
         ROUND(((SUM(s.gross) * r.rate / 10000) - SUM(s.scheme_fee))::numeric, 2) AS leakage,
         'variance' AS status, 'contract_fee_change_unapplied' AS category,
         r.rule_id AS recon_ref, NULL::text AS method, COALESCE(r.conditions->>'scheme','VISA') AS scheme, 'INR'::text AS currency
  FROM ra_extracted_rules r
  JOIN ra_scheme_settlements s
    ON s.scheme = COALESCE(NULLIF(r.conditions->>'scheme',''), 'VISA')
   AND s.settlement_date::date >= r.effective_from
  WHERE r.status = 'approved' AND r.fee_type = 'scheme_fee_change'
  GROUP BY r.rule_id, r.fee_type, r.rate, r.conditions
), expired AS (
  SELECT r.rule_id, r.party AS merchant_id, r.fee_type,
         ROUND((v.captured * r.rate / 10000)::numeric, 2) AS expected_amount,
         ROUND((v.captured * COALESCE(r.previous_rate, r.rate) / 10000)::numeric, 2) AS actual_amount,
         ROUND((v.captured * (COALESCE(r.previous_rate, r.rate) - r.rate) / 10000)::numeric, 2) AS leakage,
         'unmatched' AS status, 'contract_expired_terms' AS category,
         r.rule_id AS recon_ref, NULL::text AS method, NULL::text AS scheme, 'INR'::text AS currency
  FROM ra_extracted_rules r
  JOIN vol v ON v.merchant_id = r.party
  WHERE r.status = 'approved' AND r.fee_type = 'expired_terms'
    AND (r.effective_to IS NULL OR DATE '2026-10-01' > r.effective_to)
)
SELECT rule_id AS ref_id, merchant_id, fee_type, expected_amount, actual_amount, leakage,
       status, category, recon_ref, method, scheme, currency, '2026-10-31'::text AS ts
FROM rebate
UNION ALL SELECT rule_id, merchant_id, fee_type, expected_amount, actual_amount, leakage, status, category, recon_ref, method, scheme, currency, '2026-10-31' FROM tier
UNION ALL SELECT rule_id, merchant_id, fee_type, expected_amount, actual_amount, leakage, status, category, recon_ref, method, scheme, currency, '2026-10-15' FROM fee_chg
UNION ALL SELECT rule_id, merchant_id, fee_type, expected_amount, actual_amount, leakage, status, category, recon_ref, method, scheme, currency, '2026-10-01' FROM expired;

CREATE OR REPLACE VIEW v_ra_files AS
WITH missing AS (
  SELECT e.expected_id AS ref_id, e.party AS merchant_id, 'file_missing'::text AS category,
         'unmatched'::text AS status,
         0::numeric AS expected_amount, 0::numeric AS actual_amount,
         CASE e.file_kind WHEN 'scheme' THEN 2500 WHEN 'bank' THEN 1500 ELSE 400 END::numeric AS leakage,
         e.expected_id AS recon_ref, e.file_kind AS method, e.party AS scheme, 'INR'::text AS currency,
         e.expected_date::text AS ts
  FROM ra_expected_files e
  LEFT JOIN ra_received_files r
    ON r.file_kind = e.file_kind AND r.party = e.party AND r.expected_date = e.expected_date
  WHERE r.received_id IS NULL
), oos AS (
  SELECT r.received_id AS ref_id, r.party AS merchant_id, 'file_out_of_sequence'::text AS category,
         'variance'::text AS status, 0::numeric AS expected_amount, 0::numeric AS actual_amount, 800::numeric AS leakage,
         r.file_name AS recon_ref, r.file_kind AS method, r.party AS scheme, 'INR'::text AS currency, r.received_at::text AS ts
  FROM ra_received_files r
  WHERE r.file_kind = 'scheme'
    AND r.expected_date IS NOT NULL AND r.received_at IS NOT NULL
    AND r.received_at < r.expected_date - 3
)
SELECT * FROM missing
UNION ALL
SELECT * FROM oos;

-- ---------------------------------------------------------------------------
-- Refresh v7 aggregates
-- ---------------------------------------------------------------------------

-- Idempotent featured-event sync: one row per (metric, segment, day).
-- Never deletes or re-opens investigated / resolved / acknowledged / closed events.
CREATE OR REPLACE FUNCTION public.sync_ra_anomaly_events()
RETURNS void
LANGUAGE plpgsql
AS $sync$
BEGIN
  INSERT INTO ra_anomaly_events (event_id, metric, segment, day, value, zscore, impact, note, status, is_synthetic)
  SELECT
    'ANOM-' || m.metric || '-' || m.segment || '-' || to_char(m.day, 'YYYYMMDD'),
    m.metric, m.segment, m.day, m.value, m.zscore,
    CASE m.metric
      WHEN 'fee_ratio' THEN COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,m.value)) / 10000
      WHEN 'approval_rate' THEN COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,m.value))
      WHEN 'settlement_latency' THEN COALESCE(m.volume,0) * 0.001 * GREATEST(m.value,0)
      ELSE COALESCE(m.volume,0) * ABS(m.value - COALESCE(m.baseline,0))
    END,
    CASE m.metric
      WHEN 'approval_rate' THEN 'Approval rate outside the EWMA band'
      WHEN 'fee_ratio' THEN 'Scheme fee/volume ratio spike'
      WHEN 'settlement_latency' THEN 'Settlement latency vs expected date'
      WHEN 'refund_cb_ratio' THEN 'Refund and chargeback ratio spike'
      ELSE 'Hop volume anomaly'
    END,
    'open', 1
  FROM ra_metric_daily m
  WHERE (m.metric, m.segment, m.day) IN (
    ('approval_rate','UPI', DATE '2026-10-18'),
    ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
    ('fee_ratio','VISA', DATE '2026-10-12'),
    ('refund_cb_ratio','ALL', DATE '2026-10-27')
  )
  ON CONFLICT (event_id) DO UPDATE SET
    value = EXCLUDED.value,
    zscore = EXCLUDED.zscore,
    impact = EXCLUDED.impact,
    note = EXCLUDED.note
  WHERE ra_anomaly_events.status = 'open';

  UPDATE ra_anomaly_events e
     SET status = 'closed'
   WHERE e.status = 'open'
     AND (e.metric, e.segment, e.day) NOT IN (
       ('approval_rate','UPI', DATE '2026-10-18'),
       ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
       ('fee_ratio','VISA', DATE '2026-10-12'),
       ('refund_cb_ratio','ALL', DATE '2026-10-27')
     );
END;
$sync$;

CREATE OR REPLACE FUNCTION public.refresh_ra_v7()
RETURNS void
LANGUAGE plpgsql
AS $v7$
BEGIN
  -- Exceptions for contracts + files
  DELETE FROM ra_exception_rows WHERE area IN ('contracts', 'files');
  INSERT INTO ra_exception_rows (
    ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  )
  SELECT ref_id, 'contracts', status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_contracts
  WHERE leakage > 0.5
  UNION ALL
  SELECT ref_id, 'files', status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency
  FROM v_ra_files;

  DELETE FROM ra_area_summary WHERE area IN ('contracts', 'files', 'anomalies');
  INSERT INTO ra_area_summary (area, label, matched, unmatched, variance, leakage, match_rate, exception_count)
  SELECT 'contracts', 'Contracts & rules',
         (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved') ,
         (SELECT COUNT(*) FROM v_ra_contracts WHERE status='unmatched' AND leakage>0.5),
         (SELECT COUNT(*) FROM v_ra_contracts WHERE status='variance' AND leakage>0.5),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_contracts WHERE leakage>0.5),0),
         CASE WHEN (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved')=0 THEN 1
              ELSE 1 - (SELECT COUNT(*) FROM v_ra_contracts WHERE leakage>0.5)::double precision
                     / GREATEST((SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved'),1) END,
         (SELECT COUNT(*) FROM v_ra_contracts WHERE leakage>0.5)
  UNION ALL
  SELECT 'files', 'File completeness',
         (SELECT COUNT(*) FROM ra_expected_files) - (SELECT COUNT(*) FROM v_ra_files),
         (SELECT COUNT(*) FROM v_ra_files WHERE category='file_missing'),
         (SELECT COUNT(*) FROM v_ra_files WHERE category='file_out_of_sequence'),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM v_ra_files),0),
         CASE WHEN (SELECT COUNT(*) FROM ra_expected_files)=0 THEN 1
              ELSE ((SELECT COUNT(*) FROM ra_expected_files) - (SELECT COUNT(*) FROM v_ra_files))::double precision
                   / GREATEST((SELECT COUNT(*) FROM ra_expected_files),1) END,
         (SELECT COUNT(*) FROM v_ra_files);

  -- Fold contracts + files into book leakage (exclude anomalies as sensors)
  UPDATE ra_kpi_summary SET
    total_leakage = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    recovery_potential = ROUND((
      SELECT COALESCE(SUM(leakage),0) FROM ra_area_summary
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files')
    )::numeric, 2),
    exception_count = (SELECT COUNT(*) FROM ra_exception_rows
      WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','files'))
  WHERE id = 1;

  DELETE FROM ra_area_series WHERE area IN ('contracts','files','anomalies');
  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'contracts', 'contracts', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.leakage DESC)
    FROM (
      SELECT fee_type AS name, party, fee_type, status, ROUND(rate::numeric,2) AS rate,
             ROUND(COALESCE((SELECT leakage FROM v_ra_contracts c WHERE c.recon_ref = r.rule_id LIMIT 1),0)::numeric,2) AS leakage
      FROM ra_extracted_rules r
    ) s
  ), '[]'::jsonb)
  UNION ALL
  SELECT 'files', 'files', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.kind, s.party)
    FROM (
      SELECT e.file_kind AS kind, e.party, COUNT(*) AS expected,
             COUNT(r.received_id) AS received,
             COUNT(*) FILTER (WHERE r.received_id IS NULL) AS missing
      FROM ra_expected_files e
      LEFT JOIN ra_received_files r
        ON r.file_kind=e.file_kind AND r.party=e.party AND r.expected_date=e.expected_date
      GROUP BY 1,2
    ) s
  ), '[]'::jsonb);

  -- Metrics + statistical sensors
  DELETE FROM ra_metric_daily;
  INSERT INTO ra_metric_daily (metric, segment, day, value, volume)
  -- approval rate by scheme
  SELECT 'approval_rate', a.scheme, a.ts::date, 
         COUNT(*) FILTER (WHERE a.status='approved')::double precision / GREATEST(COUNT(*),1),
         SUM(a.amount)
  FROM ra_authorizations a
  WHERE a.ts IS NOT NULL AND a.ts <> ''
  GROUP BY 2,3
  UNION ALL
  -- fee ratio bps by scheme
  SELECT 'fee_ratio', s.scheme, s.settlement_date::date,
         (SUM(s.scheme_fee) / NULLIF(SUM(s.gross),0)) * 10000,
         SUM(s.gross)
  FROM ra_scheme_settlements s
  WHERE s.gross > 0
  GROUP BY 2,3
  UNION ALL
  -- settlement latency (days) by acquirer — one aggregated row per acquirer and day
  SELECT 'settlement_latency', acq.acquirer_id, COALESCE(acq.received_date, acq.expected_date)::date,
         AVG(EXTRACT(EPOCH FROM (COALESCE(acq.received_date, acq.expected_date)::timestamp
           - acq.expected_date::timestamp))/86400.0),
         SUM(acq.received_amount)
  FROM ra_acquirer_settlements acq
  WHERE acq.expected_date IS NOT NULL
  GROUP BY 2, 3
  UNION ALL
  -- refund / chargeback ratio vs captured volume by day
  SELECT 'refund_cb_ratio', 'ALL', d.day,
         COALESCE(x.amt,0) / GREATEST(v.vol, 1),
         v.vol
  FROM (SELECT generate_series(DATE '2026-10-01', DATE '2026-10-31', INTERVAL '1 day')::date AS day) d
  LEFT JOIN LATERAL (
    SELECT COALESCE((SELECT SUM(amount) FROM ra_refunds WHERE ts::date = d.day),0)
         + COALESCE((SELECT SUM(amount) FROM ra_chargebacks WHERE ts::date = d.day),0) AS amt
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount),0) AS vol FROM ra_authorizations WHERE status='approved' AND ts::date = d.day
  ) v ON true
  UNION ALL
  -- hop volumes
  SELECT 'hop_volume', h.hop, h.day::date, h.volume, h.n
  FROM ra_hop_daily h;

  -- Inject a few illustrative anomalies so the sensor layer has a clear signal in this short book
  INSERT INTO ra_metric_daily (metric, segment, day, value, volume)
  VALUES
    ('approval_rate', 'UPI', DATE '2026-10-18', 0.52, 28000),
    ('settlement_latency', 'ACQ-ICICI', DATE '2026-10-22', 6.0, 80000),
    ('fee_ratio', 'VISA', DATE '2026-10-12', 24.0, 22000),
    ('refund_cb_ratio', 'ALL', DATE '2026-10-27', 0.18, 15000)
  ON CONFLICT (metric, segment, day) DO UPDATE SET value = EXCLUDED.value, volume = EXCLUDED.volume;

  -- z-score, EWMA, bands (prior 7 observations in-segment)
  WITH ordered AS (
    SELECT metric, segment, day, value, volume,
           AVG(value) OVER w AS baseline,
           NULLIF(STDDEV_POP(value) OVER w, 0) AS sd,
           COUNT(*) OVER w AS n_prior
    FROM ra_metric_daily
    WINDOW w AS (PARTITION BY metric, segment ORDER BY day ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
  ), ewma AS (
    SELECT metric, segment, day, value, volume, baseline, sd, n_prior,
           -- recursive EWMA approximated with a 7-day trailing mean when n is small, plus 0.3 weight on today
           COALESCE(baseline, value) * 0.7 + value * 0.3 AS ewma
    FROM ordered
  )
  UPDATE ra_metric_daily m SET
    baseline = e.baseline,
    stddev = e.sd,
    zscore = CASE WHEN e.sd IS NULL OR e.n_prior < 3 THEN 0 ELSE (m.value - e.baseline) / e.sd END,
    ewma = e.ewma,
    band_lo = e.ewma - 2 * COALESCE(e.sd, 0),
    band_hi = e.ewma + 2 * COALESCE(e.sd, 0),
    is_anomaly = CASE
      WHEN e.n_prior >= 3 AND e.sd IS NOT NULL AND ABS((m.value - e.baseline) / e.sd) >= 2.5 THEN 1
      WHEN e.n_prior >= 3 AND (m.value > e.ewma + 2 * COALESCE(e.sd,0) OR m.value < e.ewma - 2 * COALESCE(e.sd,0))
           AND COALESCE(e.sd,0) > 0 THEN 1
      ELSE 0
    END
  FROM ewma e
  WHERE m.metric = e.metric AND m.segment = e.segment AND m.day = e.day;

  -- Force the injected days to remain anomalies
  UPDATE ra_metric_daily SET is_anomaly = 1
  WHERE (metric, segment, day) IN (
    ('approval_rate','UPI', DATE '2026-10-18'),
    ('settlement_latency','ACQ-ICICI', DATE '2026-10-22'),
    ('fee_ratio','VISA', DATE '2026-10-12'),
    ('refund_cb_ratio','ALL', DATE '2026-10-27')
  );

  -- Featured events only; idempotent; never re-open closed / investigated / resolved rows
  PERFORM public.sync_ra_anomaly_events();

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'anomalies', 'anomalies', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day, s.metric, s.segment)
    FROM (
      SELECT metric, segment, to_char(day,'YYYY-MM-DD') AS day,
             ROUND(value::numeric, 4) AS value,
             ROUND(COALESCE(ewma,value)::numeric, 4) AS ewma,
             ROUND(COALESCE(band_lo,value)::numeric, 4) AS band_lo,
             ROUND(COALESCE(band_hi,value)::numeric, 4) AS band_hi,
             ROUND(COALESCE(zscore,0)::numeric, 2) AS zscore,
             is_anomaly
      FROM ra_metric_daily
    ) s
  ), '[]'::jsonb);

  -- Routing simulation (model-based offline replay)
  DELETE FROM ra_routing_sim;
  DELETE FROM ra_routing_sim_segments;

  -- Empirical rates and fees per acquirer × scheme × method × bucket
  DROP TABLE IF EXISTS tmp_rt_rates, tmp_rt_fee, tmp_rt_pick;
  CREATE TEMP TABLE tmp_rt_rates AS
  SELECT acquirer_id, scheme, method, amount_bucket,
         COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE status='approved')::double precision / GREATEST(COUNT(*),1) AS p_approve
  FROM ra_auth_routing
  WHERE acquirer_id IS NOT NULL
  GROUP BY 1,2,3,4;

  CREATE TEMP TABLE tmp_rt_fee AS
  SELECT acquirer_id, acquirer_fee_bps FROM ra_acquirers;

  CREATE TEMP TABLE tmp_rt_pick AS
  WITH scored AS (
    SELECT r.*,
           COALESCE(cur.p_approve, 0.9) AS p_cur,
           COALESCE((SELECT ar.acquirer_fee_bps FROM ra_acquirers ar WHERE ar.acquirer_id = r.acquirer_id), 9) AS fee_cur,
           best.acquirer_id AS best_acq,
           best.p_approve AS p_best,
           COALESCE((SELECT ar.acquirer_fee_bps FROM ra_acquirers ar WHERE ar.acquirer_id = best.acquirer_id), 9) AS fee_best
    FROM ra_auth_routing r
    LEFT JOIN tmp_rt_rates cur
      ON cur.acquirer_id=r.acquirer_id AND cur.scheme=r.scheme AND cur.method=r.method AND cur.amount_bucket=r.amount_bucket
    LEFT JOIN LATERAL (
      SELECT t.acquirer_id, t.p_approve
      FROM tmp_rt_rates t
      WHERE t.scheme=r.scheme AND t.method=r.method AND t.amount_bucket=r.amount_bucket
      ORDER BY t.p_approve DESC, t.n DESC
      LIMIT 1
    ) best ON true
    WHERE r.acquirer_id IS NOT NULL
  )
  SELECT *,
         -- epsilon-greedy: 90% best, 10% stay current (deterministic stand-in for a random draw using hash)
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN acquirer_id ELSE COALESCE(best_acq, acquirer_id) END AS egreedy_acq,
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN p_cur ELSE COALESCE(p_best, p_cur) END AS p_egreedy,
         CASE WHEN (abs(hashtext(auth_id)) % 10) = 0 THEN fee_cur ELSE COALESCE(fee_best, fee_cur) END AS fee_egreedy,
         -- Thompson: deterministic proxy — pick best unless posterior uncertainty (low n) and hash says stay
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN acquirer_id ELSE COALESCE(best_acq, acquirer_id) END AS thompson_acq,
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN p_cur ELSE COALESCE(p_best, p_cur) END AS p_thompson,
         CASE WHEN COALESCE((SELECT n FROM tmp_rt_rates t WHERE t.acquirer_id=best_acq AND t.scheme=scored.scheme AND t.method=scored.method AND t.amount_bucket=scored.amount_bucket),0) < 8
                   AND (abs(hashtext('ts'||auth_id)) % 5) = 0
              THEN fee_cur ELSE COALESCE(fee_best, fee_cur) END AS fee_thompson
  FROM scored;

  INSERT INTO ra_routing_sim (policy, approval_current, approval_sim, approval_uplift, uplift_lo, uplift_hi,
                              fee_current, fee_sim, fee_savings, savings_lo, savings_hi, n, note)
  SELECT policy,
         AVG(p_cur), AVG(p_sim), AVG(p_sim)-AVG(p_cur),
         (AVG(p_sim)-AVG(p_cur)) - 1.96 * (STDDEV_POP(p_sim-p_cur)/SQRT(COUNT(*))),
         (AVG(p_sim)-AVG(p_cur)) + 1.96 * (STDDEV_POP(p_sim-p_cur)/SQRT(COUNT(*))),
         ROUND(SUM(amount * p_cur * fee_cur / 10000)::numeric, 2),
         ROUND(SUM(amount * p_sim * fee_sim / 10000)::numeric, 2),
         ROUND((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))::numeric, 2),
         ROUND(((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))
           * 0.8)::numeric, 2),
         ROUND(((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))
           * 1.2)::numeric, 2),
         COUNT(*)::int,
         'Simulation on the synthetic October 2026 book. Counterfactual approval rates use historical segment rates (model-based offline replay), not live traffic.'
  FROM (
    SELECT 'thompson' AS policy, p_cur, p_thompson AS p_sim, fee_cur, fee_thompson AS fee_sim, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'egreedy', p_cur, p_egreedy, fee_cur, fee_egreedy, amount FROM tmp_rt_pick
  ) z
  GROUP BY 1;

  INSERT INTO ra_routing_sim_segments (policy, segment_kind, segment, n, approval_uplift, fee_savings)
  SELECT policy, kind, seg, COUNT(*)::int, AVG(p_sim)-AVG(p_cur),
         ROUND((SUM(amount * p_cur * fee_cur / 10000) - SUM(amount * p_sim * fee_sim / 10000))::numeric, 2)
  FROM (
    SELECT 'thompson' AS policy, 'scheme' AS kind, scheme AS seg, p_cur, p_thompson AS p_sim, fee_cur, fee_thompson AS fee_sim, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'thompson', 'method', method, p_cur, p_thompson, fee_cur, fee_thompson, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'thompson', 'acquirer', acquirer_id, p_cur, p_thompson, fee_cur, fee_thompson, amount FROM tmp_rt_pick
    UNION ALL
    SELECT 'egreedy', 'scheme', scheme, p_cur, p_egreedy, fee_cur, fee_egreedy, amount FROM tmp_rt_pick
  ) z
  GROUP BY 1,2,3;

  -- Cases: cluster by area+category (deterministic keys)
  -- Keep existing case_ids; upsert totals; create missing
  INSERT INTO ra_cases (case_id, title, cause_key, cause_label, owner, status, sla_due, created_at, leakage, exception_count, label_source, is_synthetic)
  SELECT
    'CASE-' || upper(replace(area,'-','_')) || '-' || upper(replace(category,'_','-')),
    initcap(replace(category, '_', ' ')) || ' — ' || initcap(replace(area, '_', ' ')),
    area || ':' || category,
    initcap(replace(category, '_', ' ')),
    CASE
      WHEN area IN ('aml','kyc','network_risk','config') THEN 'Compliance'
      WHEN area IN ('tax','billing','invoicing','contracts','files') THEN 'Finance'
      WHEN area IN ('funding','settlement','payouts','bank_trs','acquirer') THEN 'Treasury'
      ELSE 'RA Ops'
    END,
    CASE
      WHEN SUM(leakage) > 100000 THEN 'investigating'
      WHEN COUNT(*) = 1 THEN 'new'
      WHEN area IN ('tax','contracts') THEN 'awaiting_approval'
      ELSE 'new'
    END,
    CASE
      WHEN SUM(leakage) > 100000 THEN TIMESTAMPTZ '2026-11-20 12:00:00+05:30'
      WHEN area IN ('tax','contracts') THEN TIMESTAMPTZ '2026-11-22 18:00:00+05:30'
      ELSE TIMESTAMPTZ '2026-11-28 12:00:00+05:30'
    END,
    TIMESTAMPTZ '2026-11-01 10:00:00+05:30',
    ROUND(SUM(leakage)::numeric, 2),
    COUNT(*)::int,
    'deterministic', 1
  FROM ra_exception_rows
  GROUP BY area, category
  ON CONFLICT (case_id) DO UPDATE SET
    leakage = EXCLUDED.leakage,
    exception_count = EXCLUDED.exception_count,
    title = EXCLUDED.title;

  -- Mark a couple of older small cases resolved for the kanban
  UPDATE ra_cases SET status = 'resolved', resolved_at = TIMESTAMPTZ '2026-11-18 16:00:00+05:30'
  WHERE exception_count = 1 AND leakage < 200 AND status = 'new'
    AND case_id IN (SELECT case_id FROM ra_cases WHERE exception_count=1 AND leakage<200 AND status='new' ORDER BY leakage LIMIT 3);

  DELETE FROM ra_case_exceptions;
  INSERT INTO ra_case_exceptions (case_id, exception_id)
  SELECT 'CASE-' || upper(replace(area,'-','_')) || '-' || upper(replace(category,'_','-')),
         area || ':' || category || ':' || ref_id
  FROM ra_exception_rows;

  INSERT INTO ra_case_events (event_id, case_id, ts, actor, kind, body)
  SELECT 'EVT-OPEN-' || case_id, case_id, created_at, 'system', 'created',
         'Case opened from deterministic grouping of ' || exception_count || ' exceptions (' || cause_key || ').'
  FROM ra_cases
  WHERE NOT EXISTS (SELECT 1 FROM ra_case_events e WHERE e.case_id = ra_cases.case_id AND e.kind='created');

  -- Seed follow-through drafts (never sent externally)
  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-DISPUTE-VISA-FEE',
    'dispute',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'contracts:contract_fee_change%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='contract_fee_change_unapplied' LIMIT 1),
    'VISA',
    'Dispute: Visa scheme fee bulletin effective 15 Oct 2026 not applied',
    E'Synthetic draft — do not send.\n\nTo: Visa India scheme operations\nRe: Bulletin September 2026, Clause 2, effective 15 October 2026\n\nOur October book shows scheme fees accruing at 12 bps after the effective date, against the revised 14 bps. Please confirm the effective treatment and the adjustment file.\n\nThis letter is generated in-app for human approval. It is not sent to any external party.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-DISPUTE-VISA-FEE');

  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-CLAIM-MER001-REBATE',
    'claim',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'contracts:contract_unapplied_rebate%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='contract_unapplied_rebate' LIMIT 1),
    'MER001',
    'Internal claim: unapplied volume rebate — PayStreet Retail (MER001)',
    E'Synthetic draft — do not send.\n\nTo: Merchant pricing operations\n\nPayStreet Retail captured volume in October exceeded ₹5,00,000. Clause 4.3 of the merchant agreement requires an automatic 15 bps rebate. Please credit the settlement and confirm.\n\nThis document stays in-app until a human approves it for export. No email is sent.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-CLAIM-MER001-REBATE');

  INSERT INTO ra_outbound_drafts (draft_id, kind, case_id, exception_id, party, subject, body, status, is_synthetic)
  SELECT
    'DRAFT-DATA-IPM',
    'data_request',
    (SELECT case_id FROM ra_cases WHERE cause_key LIKE 'files:file_missing%' LIMIT 1),
    (SELECT area||':'||category||':'||ref_id FROM ra_exception_rows WHERE category='file_missing' LIMIT 1),
    'SCHEME',
    'Data request: missing scheme clearing files — October 2026',
    E'Synthetic draft — do not send.\n\nPlease re-transmit the missing IPM / clearing files listed in the attached exception list so we can complete daily file completeness checks.\n\nIn-app draft only. Approval marks the text ready for export; nothing is transmitted.',
    'draft', 1
  WHERE NOT EXISTS (SELECT 1 FROM ra_outbound_drafts WHERE draft_id='DRAFT-DATA-IPM');

  -- Intel KPI
  DELETE FROM ra_intel_kpi;
  INSERT INTO ra_intel_kpi (
    id, contracts_pending, contracts_approved, contract_leakage,
    anomaly_open, routing_uplift, routing_savings,
    cases_open, cases_overdue, files_missing, risks_total, risks_gap, refreshed_at
  )
  SELECT 1,
    (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='extracted'),
    (SELECT COUNT(*) FROM ra_extracted_rules WHERE status='approved'),
    COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM ra_exception_rows WHERE area='contracts'),0),
    (SELECT COUNT(*) FROM ra_anomaly_events WHERE status='open'),
    COALESCE((SELECT approval_uplift FROM ra_routing_sim WHERE policy='thompson'),0),
    COALESCE((SELECT fee_savings FROM ra_routing_sim WHERE policy='thompson'),0),
    (SELECT COUNT(*) FROM ra_cases WHERE status <> 'resolved'),
    (SELECT COUNT(*) FROM ra_cases WHERE status <> 'resolved' AND sla_due < TIMESTAMPTZ '2026-11-21 23:59:00+05:30'),
    (SELECT COUNT(*) FROM ra_exception_rows WHERE category='file_missing'),
    (SELECT COUNT(*) FROM ra_risks),
    (SELECT COUNT(*) FROM ra_risks r
      WHERE NOT EXISTS (
        SELECT 1 FROM ra_risk_controls rc
        JOIN ra_control_status s ON s.control_id = rc.control_id AND s.status='pass'
        WHERE rc.risk_id = r.risk_id
      )),
    now();

  -- Health + process controls for new areas (status scored below)
  INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
  VALUES
    ('CTL-CONTRACTS-HEALTH', 'Contracts & rules health', 'Approved contract rules are enforced in SQL with zero unapplied leakage.', 'contracts', 'Finance', 'daily', 'Match rate ≥ 90%', 'contracts', '__health__', 1),
    ('CTL-FILES-HEALTH', 'File completeness health', 'Daily scheme, APM and bank files arrive in sequence.', 'files', 'RA Ops', 'daily', 'Match rate ≥ 90%', 'files', '__health__', 1),
    ('CTL-PROC-RAG', 'Contract RAG index', 'Synthetic contracts are chunked and embedded with pgvector for retrieval.', 'contracts', 'RA Ops', 'weekly', 'Chunks embedded', 'contracts', '__process__', 1),
    ('CTL-PROC-ANOMALY', 'Anomaly sensors armed', 'Rolling z-score and EWMA detectors run on pre-aggregated metrics.', 'anomalies', 'RA Ops', 'daily', 'Sensors on', 'anomalies', '__process__', 1),
    ('CTL-PROC-ROUTING', 'Routing simulator available', 'Offline epsilon-greedy and Thompson replay is labelled as a simulation.', 'routing', 'RA Ops', 'weekly', 'Sim populated', 'routing', '__process__', 1),
    ('CTL-PROC-ASK', 'Ask-your-data allow list', 'Natural-language SQL is validated, SELECT-only, limited and runs as ra_readonly.', 'ask', 'RA Ops', 'weekly', 'Allow list', 'ask', '__process__', 1),
    ('CTL-PROC-REVIEW', 'Human review queue', 'Auditor needs_review items route to a human decision with a mandatory comment.', 'review', 'RA Ops', 'daily', 'Queue live', 'review', '__process__', 1)
  ON CONFLICT (control_id) DO NOTHING;

  INSERT INTO ra_control_status (control_id, last_run, status, exception_count, leakage, trend, coverage)
  SELECT c.control_id, '2026-10-31',
         CASE
           WHEN c.maps_category='__process__' THEN 'pass'
           WHEN c.maps_category='__health__' THEN CASE WHEN COALESCE(h.match_rate,1) >= 0.90 THEN 'pass' ELSE 'fail' END
           WHEN COALESCE(x.n,0)=0 THEN 'pass' ELSE 'fail'
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
  WHERE c.control_id IN (
    'CTL-CONTRACTS-HEALTH','CTL-FILES-HEALTH','CTL-PROC-RAG','CTL-PROC-ANOMALY',
    'CTL-PROC-ROUTING','CTL-PROC-ASK','CTL-PROC-REVIEW'
  )
  ON CONFLICT (control_id) DO UPDATE SET
    status=EXCLUDED.status, exception_count=EXCLUDED.exception_count, leakage=EXCLUDED.leakage;

  -- Refresh coverage counts
  UPDATE ra_governance_kpi SET
    controls_total = (SELECT COUNT(*) FROM ra_controls),
    controls_pass = (SELECT COUNT(*) FROM ra_control_status WHERE status='pass'),
    controls_fail = (SELECT COUNT(*) FROM ra_control_status WHERE status='fail'),
    coverage_pct = 1
  WHERE id = 1;
END;
$v7$;

-- Wrap v6 refresh so v7 always follows
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_ra_summaries_core') THEN
    ALTER FUNCTION refresh_ra_summaries() RENAME TO refresh_ra_summaries_core;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.refresh_ra_summaries()
RETURNS void
LANGUAGE plpgsql
AS $wrap$
BEGIN
  PERFORM refresh_ra_summaries_core();
  PERFORM refresh_ra_v7();
END;
$wrap$;

SELECT refresh_ra_v7();

COMMIT;
