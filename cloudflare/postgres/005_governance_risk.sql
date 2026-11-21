
-- V6: Governance, tax, KYC, interface monitoring, AML, network risk,
-- transaction-trace support, and payment success-rate attributes.
-- Idempotent. Derived from the October 2026 synthetic book. Free-tier only.

BEGIN;

DROP VIEW IF EXISTS v_ra_config CASCADE;
DROP VIEW IF EXISTS v_ra_tax CASCADE;
DROP VIEW IF EXISTS v_ra_kyc CASCADE;
DROP VIEW IF EXISTS v_ra_interfaces CASCADE;
DROP VIEW IF EXISTS v_ra_aml CASCADE;
DROP VIEW IF EXISTS v_ra_network CASCADE;
DROP VIEW IF EXISTS v_ra_success CASCADE;
DROP VIEW IF EXISTS v_ra_trace_gaps CASCADE;

DROP TABLE IF EXISTS ra_control_status;
DROP TABLE IF EXISTS ra_controls;
DROP TABLE IF EXISTS ra_config_changes;
DROP TABLE IF EXISTS ra_tds_entries;
DROP TABLE IF EXISTS ra_kyc_profiles;
DROP TABLE IF EXISTS ra_merchant_hierarchy;
DROP TABLE IF EXISTS ra_merchant_limits;
DROP TABLE IF EXISTS ra_aml_txns;
DROP TABLE IF EXISTS ra_risk_edges;
DROP TABLE IF EXISTS ra_risk_entities;
DROP TABLE IF EXISTS ra_auth_attributes;
DROP TABLE IF EXISTS ra_hop_daily;
DROP TABLE IF EXISTS ra_governance_kpi;

CREATE TABLE ra_auth_attributes (
  auth_id TEXT PRIMARY KEY,
  decline_reason TEXT,
  is_emi INTEGER DEFAULT 0,
  emi_tenure INTEGER,
  channel TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_config_changes (
  change_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  impact DOUBLE PRECISION DEFAULT 0,
  note TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_tds_entries (
  tds_id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  period TEXT NOT NULL,
  commission DOUBLE PRECISION NOT NULL,
  tds_expected DOUBLE PRECISION NOT NULL,
  tds_withheld DOUBLE PRECISION NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_kyc_profiles (
  merchant_id TEXT PRIMARY KEY,
  kyc_status TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  kyc_expires_on TEXT,
  last_reviewed TEXT,
  pan_mask TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_merchant_hierarchy (
  child_id TEXT PRIMARY KEY,
  parent_id TEXT,
  role TEXT NOT NULL,
  commission_bps INTEGER,
  expected_commission_bps INTEGER,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_merchant_limits (
  merchant_id TEXT PRIMARY KEY,
  daily_limit DOUBLE PRECISION NOT NULL,
  txn_limit DOUBLE PRECISION NOT NULL,
  monthly_limit DOUBLE PRECISION NOT NULL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_aml_txns (
  txn_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  pattern TEXT NOT NULL,
  related_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_risk_entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  label TEXT NOT NULL,
  merchant_id TEXT,
  risk_score DOUBLE PRECISION DEFAULT 0,
  is_known_bad INTEGER DEFAULT 0,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_risk_edges (
  edge_id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  rel TEXT NOT NULL,
  weight DOUBLE PRECISION DEFAULT 1,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_hop_daily (
  day TEXT NOT NULL,
  hop TEXT NOT NULL,
  n INTEGER NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  drop_n INTEGER DEFAULT 0,
  drop_volume DOUBLE PRECISION DEFAULT 0,
  dup_n INTEGER DEFAULT 0,
  avg_latency_sec DOUBLE PRECISION DEFAULT 0,
  PRIMARY KEY (day, hop)
);

CREATE TABLE ra_controls (
  control_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  domain TEXT NOT NULL,
  owner TEXT NOT NULL,
  frequency TEXT NOT NULL,
  threshold TEXT NOT NULL,
  maps_area TEXT,
  maps_category TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE ra_control_status (
  control_id TEXT PRIMARY KEY,
  last_run TEXT,
  status TEXT NOT NULL,
  exception_count INTEGER NOT NULL,
  leakage DOUBLE PRECISION NOT NULL,
  trend TEXT,
  coverage DOUBLE PRECISION NOT NULL
);

CREATE TABLE ra_governance_kpi (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  controls_total INTEGER NOT NULL,
  controls_pass INTEGER NOT NULL,
  controls_fail INTEGER NOT NULL,
  coverage_pct DOUBLE PRECISION NOT NULL,
  unapproved_changes INTEGER NOT NULL,
  unapproved_impact DOUBLE PRECISION NOT NULL,
  tax_leakage DOUBLE PRECISION NOT NULL,
  kyc_open INTEGER NOT NULL,
  kyc_at_risk DOUBLE PRECISION NOT NULL,
  aml_flags INTEGER NOT NULL,
  aml_exposure DOUBLE PRECISION NOT NULL,
  interface_drop_pct DOUBLE PRECISION NOT NULL,
  success_rate DOUBLE PRECISION NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth attributes (decline reasons, EMI, channel) for success-rate analytics
INSERT INTO ra_auth_attributes (auth_id, decline_reason, is_emi, emi_tenure, channel, is_synthetic)
SELECT
  a.auth_id,
  CASE WHEN a.status = 'declined' THEN
    (ARRAY['insufficient_funds','do_not_honour','expired_card','issuer_timeout','invalid_pin','limit_exceeded','3ds_failed','kyc_block'])[
      ((ascii(substr(a.auth_id, length(a.auth_id), 1)) + ascii(substr(a.auth_id, 5, 1))) % 8) + 1
    ]
  ELSE NULL END,
  CASE WHEN a.method = 'card' AND a.status = 'approved'
            AND ((ascii(substr(a.auth_id, length(a.auth_id), 1))) % 9) = 0
       THEN 1 ELSE 0 END,
  CASE WHEN a.method = 'card' AND a.status = 'approved'
            AND ((ascii(substr(a.auth_id, length(a.auth_id), 1))) % 9) = 0
       THEN (ARRAY[3,6,9,12])[((ascii(substr(a.auth_id, 6, 1))) % 4) + 1]
       ELSE NULL END,
  CASE a.method
    WHEN 'upi' THEN 'upi'
    WHEN 'card' THEN 'card'
    WHEN 'wallet' THEN 'wallet'
    WHEN 'bnpl' THEN 'bnpl'
    WHEN 'netbanking' THEN 'netbanking'
    WHEN 'a2a' THEN 'a2a'
    ELSE COALESCE(a.method, 'other')
  END,
  1
FROM ra_authorizations a;

-- Config / rule-change audit log (approved and unapproved)
INSERT INTO ra_config_changes
  (change_id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at, approved, approved_by, approved_at, impact, note, is_synthetic)
VALUES
  ('CFG-001','merchant','MER003','mdr_bps','220','250','ops.ravi','2026-10-12T11:20:00',0,NULL,NULL,0,'Unapproved MDR hike on travel merchant',1),
  ('CFG-002','partner','PAR001','share_bps','25','40','partner.desk','2026-10-18T16:05:00',0,NULL,NULL,0,'Unapproved ISO commission increase',1),
  ('CFG-003','merchant','MER006','fx_markup_cap_bps','50','125','treasury.nisha','2026-10-20T09:40:00',0,NULL,NULL,0,'FX markup cap raised without approval',1),
  ('CFG-004','merchant','MER001','mdr_bps','180','175','pricing.lead','2026-10-05T14:00:00',1,'cfo.office','2026-10-05T18:00:00',0,'Approved promotional MDR cut',1),
  ('CFG-005','merchant','MER008','settlement_delay_days','2','1','treasury.nisha','2026-10-08T10:10:00',1,'cfo.office','2026-10-08T12:00:00',0,'Approved T+1 for healthcare',1),
  ('CFG-006','scheme','UPI','zero_mdr_flag','1','1','compliance','2026-10-01T09:00:00',1,'cfo.office','2026-10-01T09:00:00',0,'Illustrative UPI P2M zero-MDR policy in force',1),
  ('CFG-007','merchant','MER004','daily_limit','500000','350000','risk.ops','2026-10-15T13:30:00',1,'risk.head','2026-10-15T15:00:00',0,'Approved daily limit tightening',1),
  ('CFG-008','acquirer','ACQ-AXIS','acquirer_fee_bps','9','13','vendor.desk','2026-10-22T11:00:00',0,NULL,NULL,0,'Unapproved acquirer fee change (matches Axis invoice overcharge theme)',1),
  ('CFG-009','merchant','MER002','mdr_bps','160','160','pricing.lead','2026-10-03T10:00:00',1,'cfo.office','2026-10-03T10:30:00',0,'No-op confirmation of grocery MDR',1),
  ('CFG-010','partner','PAR003','share_bps','20','18','partner.desk','2026-10-09T17:45:00',1,'cfo.office','2026-10-10T09:00:00',0,'Approved ISO share reduction',1);

-- Quantify revenue impact since unapproved changes
UPDATE ra_config_changes c
SET impact = ROUND(s.impact::numeric, 2)
FROM (
  SELECT 'CFG-001' AS change_id,
         COALESCE(SUM(cap.amount) * 30 / 10000.0, 0) AS impact
  FROM ra_captures cap
  JOIN ra_authorizations a ON a.auth_id = cap.auth_id
  WHERE a.merchant_id = 'MER003'
    AND SUBSTR(cap.ts,1,10) >= '2026-10-12'
  UNION ALL
  SELECT 'CFG-002',
         COALESCE(SUM(cap.amount) * 15 / 10000.0, 0)
  FROM ra_captures cap
  JOIN ra_authorizations a ON a.auth_id = cap.auth_id
  WHERE a.partner_id = 'PAR001'
    AND SUBSTR(cap.ts,1,10) >= '2026-10-18'
  UNION ALL
  SELECT 'CFG-003',
         COALESCE(SUM(fx.amount * (fx.applied_rate - fx.reference_rate)), 0)
  FROM ra_fx_conversions fx
  WHERE SUBSTR(fx.ts,1,10) >= '2026-10-20'
  UNION ALL
  SELECT 'CFG-008',
         COALESCE((SELECT invoiced_fee - expected_fee FROM ra_acquirer_invoices WHERE acquirer_id = 'ACQ-AXIS'), 0)
) s
WHERE c.change_id = s.change_id;

-- TDS on partner commissions (illustrative 5% u/s 194H)
INSERT INTO ra_tds_entries (tds_id, partner_id, period, commission, tds_expected, tds_withheld, is_synthetic)
SELECT
  'TDS-' || p.partner_id || '-2026-10',
  p.partner_id,
  '2026-10',
  COALESCE(f.invoiced, f.expected, 0),
  ROUND((COALESCE(f.invoiced, f.expected, 0) * 0.05)::numeric, 2),
  ROUND((COALESCE(f.invoiced, f.expected, 0) * CASE WHEN p.partner_id IN ('PAR001','PAR004') THEN 0.01 ELSE 0.05 END)::numeric, 2),
  1
FROM ra_partners p
LEFT JOIN ra_partner_fees f ON f.partner_id = p.partner_id AND f.period = '2026-10';

-- KYC, hierarchy, limits
INSERT INTO ra_kyc_profiles (merchant_id, kyc_status, risk_tier, kyc_expires_on, last_reviewed, pan_mask, is_synthetic) VALUES
  ('MER001','active','low','2027-03-31','2026-09-01','XXXXX1234A',1),
  ('MER002','active','low','2027-06-30','2026-08-15','XXXXX5678B',1),
  ('MER003','active','medium','2026-11-30','2026-07-01','XXXXX9012C',1),
  ('MER004','active','low','2027-01-15','2026-09-20','XXXXX3456D',1),
  ('MER005','pending','medium','2026-12-31','2026-10-10','XXXXX7890E',1),
  ('MER006','active','high','2027-02-28','2026-09-05','XXXXX2345F',1),
  ('MER007','active','low','2027-04-30','2026-08-22','XXXXX6789G',1),
  ('MER008','active','low','2027-05-31','2026-09-12','XXXXX0123H',1),
  ('MER009','expired','medium','2026-09-30','2026-03-01','XXXXX4567I',1),
  ('MER010','active','low','2027-07-31','2026-10-01','XXXXX8901J',1),
  ('MER001A','pending','medium','2026-12-15','2026-10-20','XXXXX1111K',1);

INSERT INTO ra_merchant_hierarchy (child_id, parent_id, role, commission_bps, expected_commission_bps, is_synthetic) VALUES
  ('MER001', NULL, 'aggregator', 0, 0, 1),
  ('MER001A', 'MER001', 'sub_merchant', 40, 25, 1),
  ('MER002', NULL, 'merchant', 0, 0, 1),
  ('MER003', NULL, 'merchant', 0, 0, 1),
  ('MER004', NULL, 'merchant', 0, 0, 1),
  ('MER005', NULL, 'merchant', 0, 0, 1),
  ('MER006', NULL, 'merchant', 0, 0, 1),
  ('MER007', NULL, 'merchant', 0, 0, 1),
  ('MER008', NULL, 'merchant', 0, 0, 1),
  ('MER009', NULL, 'merchant', 0, 0, 1),
  ('MER010', NULL, 'merchant', 0, 0, 1);

INSERT INTO ra_merchant_limits (merchant_id, daily_limit, txn_limit, monthly_limit, is_synthetic)
SELECT m.merchant_id,
       CASE m.merchant_id WHEN 'MER006' THEN 80000 WHEN 'MER004' THEN 350000 ELSE 500000 END,
       CASE m.merchant_id WHEN 'MER006' THEN 25000 ELSE 200000 END,
       8000000,
       1
FROM ra_merchants m;

-- Sub-merchant shell so KYC queries can join
INSERT INTO ra_merchants (merchant_id, name, mcc, country, currency, mdr_bps, settlement_delay_days, segment, is_synthetic)
VALUES ('MER001A', 'PayStreet Express (sub)', '5411', 'IN', 'INR', 200, 2, 'retail', 1)
ON CONFLICT (merchant_id) DO NOTHING;

-- AML pattern injections (small synthetic extras, not mixed into capture recon)
INSERT INTO ra_aml_txns (txn_id, merchant_id, ts, amount, pattern, related_ref, is_synthetic)
SELECT
  'AML-STR-' || g.n, 'MER004', '2026-10-16T0' || ((g.n % 8)+1) || ':1' || g.n || ':00',
  49500, 'structuring', 'under-50k-split', 1
FROM generate_series(1, 4) g(n);

INSERT INTO ra_aml_txns (txn_id, merchant_id, ts, amount, pattern, related_ref, is_synthetic) VALUES
  ('AML-REF-1','MER002','2026-10-19T11:00:00', 18000, 'refund_abuse', 'refund-loop', 1),
  ('AML-REF-2','MER002','2026-10-19T11:20:00', 18000, 'refund_abuse', 'refund-loop', 1),
  ('AML-REF-3','MER002','2026-10-19T11:40:00', 18000, 'refund_abuse', 'refund-loop', 1),
  ('AML-RT-1','MER007','2026-10-21T10:00:00', 75000, 'round_trip', 'AML-RT-2', 1),
  ('AML-RT-2','MER007','2026-10-21T18:30:00', 74800, 'round_trip', 'AML-RT-1', 1),
  ('AML-VEL-1','MER006','2026-10-24T09:00:00', 92000, 'velocity_spike', 'peak-day', 1),
  ('AML-VEL-2','MER006','2026-10-24T12:00:00', 88000, 'velocity_spike', 'peak-day', 1),
  ('AML-VEL-3','MER006','2026-10-24T15:00:00', 91000, 'velocity_spike', 'peak-day', 1),
  ('AML-DOR-1','MER010','2026-10-28T10:00:00', 120000, 'dormant_burst', 'quiet-then-burst', 1),
  ('AML-DOR-2','MER010','2026-10-28T10:45:00', 115000, 'dormant_burst', 'quiet-then-burst', 1);

-- Network graph entities and edges
INSERT INTO ra_risk_entities (entity_id, entity_type, label, merchant_id, risk_score, is_known_bad, is_synthetic)
SELECT 'MER-' || merchant_id, 'merchant', name, merchant_id, 10, 0, 1 FROM ra_merchants WHERE merchant_id LIKE 'MER%';

INSERT INTO ra_risk_entities (entity_id, entity_type, label, merchant_id, risk_score, is_known_bad, is_synthetic)
SELECT 'ACC-' || account_id, 'bank_account', COALESCE(bank_name,'Bank') || ' ' || account_mask, merchant_id,
       CASE WHEN is_active = 0 THEN 40 ELSE 8 END, 0, 1
FROM ra_merchant_accounts;

INSERT INTO ra_risk_entities (entity_id, entity_type, label, merchant_id, risk_score, is_known_bad, is_synthetic)
SELECT 'POS-' || terminal_id, 'terminal', terminal_id, merchant_id, 5, 0, 1
FROM ra_terminals
WHERE terminal_id IN (SELECT terminal_id FROM ra_terminals ORDER BY terminal_id LIMIT 16);

INSERT INTO ra_risk_entities (entity_id, entity_type, label, merchant_id, risk_score, is_known_bad, is_synthetic) VALUES
  ('DEV-SHARED-46','device','Android POS shared','MER004',55,0,1),
  ('DEV-MER006','device','Android POS MER006','MER006',15,0,1),
  ('PAR-PAR001','partner','ISO Alpha',NULL,20,0,1),
  ('PAR-PAR003','partner','ISO Gamma',NULL,12,0,1),
  ('CARD-BAD-1111','card','Card ****1111',NULL,90,1,1),
  ('ENT-FUNNEL','entity','Funnel Co (known-bad)',NULL,95,1,1);

-- Merchant to account / terminal / partner
INSERT INTO ra_risk_edges (edge_id, src, dst, rel, weight, is_synthetic)
SELECT 'E-MA-' || account_id, 'MER-' || merchant_id, 'ACC-' || account_id, 'owns_account', 1, 1
FROM ra_merchant_accounts;

INSERT INTO ra_risk_edges (edge_id, src, dst, rel, weight, is_synthetic)
SELECT 'E-MT-' || terminal_id, 'MER-' || merchant_id, 'POS-' || terminal_id, 'operates_terminal', 1, 1
FROM ra_terminals
WHERE terminal_id IN (SELECT entity_id FROM ra_risk_entities WHERE entity_type='terminal')
   OR ('POS-' || terminal_id) IN (SELECT entity_id FROM ra_risk_entities);

INSERT INTO ra_risk_edges (edge_id, src, dst, rel, weight, is_synthetic)
SELECT 'E-MP-' || merchant_id || '-' || partner_id, 'MER-' || merchant_id, 'PAR-' || partner_id, 'partnered_with', 1, 1
FROM (
  SELECT DISTINCT a.merchant_id, a.partner_id
  FROM ra_authorizations a
  WHERE a.partner_id IS NOT NULL
) s
WHERE EXISTS (SELECT 1 FROM ra_risk_entities e WHERE e.entity_id = 'PAR-' || s.partner_id)
  AND EXISTS (SELECT 1 FROM ra_risk_entities e WHERE e.entity_id = 'MER-' || s.merchant_id);

-- Shared device across MER004 and MER006; shared account alias; known-bad proximity; funding to old account
INSERT INTO ra_risk_edges (edge_id, src, dst, rel, weight, is_synthetic) VALUES
  ('E-DEV-4','MER-MER004','DEV-SHARED-46','uses_device',1,1),
  ('E-DEV-6','MER-MER006','DEV-SHARED-46','uses_device',1,1),
  ('E-SHARE-ACC','MER-MER007','ACC-ACC-MER002-1','shared_account',1.5,1),
  ('E-BAD-3','MER-MER003','CARD-BAD-1111','processed_card',2,1),
  ('E-BAD-E','CARD-BAD-1111','ENT-FUNNEL','linked_to',2,1),
  ('E-FUND-OLD','MER-MER005','ACC-ACC-MER005-OLD','funded_changed_account',2,1),
  ('E-CYC-1','ACC-ACC-MER001-1','PAR-PAR001','commission_paid',1,1),
  ('E-CYC-2','PAR-PAR001','ACC-ACC-MER007-1','payout_routed',1,1),
  ('E-CYC-3','ACC-ACC-MER007-1','ACC-ACC-MER001-1','return_transfer',1,1),
  ('E-HIER','MER-MER001','MER-MER001A','aggregator_of',1,1);

-- Score: bump entities on shared/bad/cycle paths (refined in refresh)
UPDATE ra_risk_entities SET risk_score = 70 WHERE entity_id IN ('MER-MER004','MER-MER006','DEV-SHARED-46');
UPDATE ra_risk_entities SET risk_score = 65 WHERE entity_id IN ('MER-MER007','ACC-ACC-MER002-1');
UPDATE ra_risk_entities SET risk_score = 80 WHERE entity_id IN ('MER-MER003','MER-MER005','ACC-ACC-MER005-OLD');

COMMIT;


BEGIN;

-- Hop daily funnel (gateway → switch → clearing → settlement → bank → GL)
DELETE FROM ra_hop_daily;
INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT d.day, 'gateway', COUNT(*), ROUND(SUM(g.amount)::numeric,2), 0, 0, 0, 0
FROM ra_gateway_logs g
CROSS JOIN LATERAL (SELECT SUBSTR(g.ts,1,10) AS day) d
WHERE d.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY d.day;

INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT d.day, 'switch', COUNT(*), ROUND(SUM(s.amount)::numeric,2), 0, 0, 0, 0
FROM ra_switch_logs s
CROSS JOIN LATERAL (SELECT SUBSTR(s.ts,1,10) AS day) d
WHERE d.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY d.day;

INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT d.day, 'clearing', COUNT(*), ROUND(SUM(c.gross)::numeric,2), 0, 0, 0, 0
FROM ra_clearing_records c
CROSS JOIN LATERAL (SELECT SUBSTR(c.clearing_date,1,10) AS day) d
WHERE d.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY d.day;

INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT b.cut_off, 'settlement', SUM(b.txn_count)::int, ROUND(SUM(b.gross)::numeric,2), 0, 0, 0, 0
FROM ra_settlement_batches b
GROUP BY b.cut_off;

INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT SUBSTR(t.value_date,1,10), 'bank', COUNT(*), ROUND(SUM(t.amount)::numeric,2), 0, 0, 0, 0
FROM ra_bank_transactions t
WHERE SUBSTR(t.value_date,1,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY 1;

INSERT INTO ra_hop_daily (day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec)
SELECT SUBSTR(j.je_date,1,10), 'gl', COUNT(*), 0, 0, 0, 0, 0
FROM ra_gl_journals j
WHERE SUBSTR(j.je_date,1,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY 1;

-- Annotate switch drops vs gateway (same day, by count gap) and latency
UPDATE ra_hop_daily SET drop_n = 0, drop_volume = 0;
UPDATE ra_hop_daily sw
SET drop_n = sub.n, drop_volume = sub.vol
FROM (
  SELECT SUBSTR(g.ts,1,10) AS day, COUNT(*)::int AS n, COALESCE(SUM(g.amount),0) AS vol
  FROM ra_gateway_logs g
  WHERE NOT EXISTS (SELECT 1 FROM ra_switch_logs s WHERE s.auth_id = g.auth_id)
    AND SUBSTR(g.ts,1,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  GROUP BY 1
) sub
WHERE sw.hop = 'switch' AND sw.day = sub.day;


-- Latency gateway → switch for matching auth_ids (seconds)
WITH lat AS (
  SELECT SUBSTR(g.ts,1,10) AS day,
         AVG(EXTRACT(EPOCH FROM (
           to_timestamp(s.ts, 'YYYY-MM-DD HH24:MI:SS') - to_timestamp(g.ts, 'YYYY-MM-DD HH24:MI:SS')
         ))) AS avg_sec
  FROM ra_gateway_logs g
  JOIN ra_switch_logs s ON s.auth_id = g.auth_id
  WHERE g.ts ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND s.ts ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  GROUP BY 1
)
UPDATE ra_hop_daily sw
SET avg_latency_sec = ROUND(lat.avg_sec::numeric, 2)
FROM lat
WHERE sw.hop = 'switch' AND sw.day = lat.day;

-- Inject a visible duplicate-count on one busy day for the monitoring page
UPDATE ra_hop_daily SET dup_n = 3 WHERE hop = 'gateway' AND day = (
  SELECT day FROM ra_hop_daily WHERE hop = 'gateway' ORDER BY n DESC LIMIT 1
);

-- Views (exception-row shape)
CREATE VIEW v_ra_config AS
SELECT
  c.change_id AS ref_id,
  'config'::text AS area,
  CASE WHEN c.approved = 1 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN c.approved = 1 THEN 'config_ok' ELSE 'config_unapproved' END AS category,
  CASE WHEN c.entity_type = 'merchant' THEN c.entity_id ELSE NULL END AS merchant_id,
  c.changed_at AS ts,
  0::double precision AS expected_amount,
  c.impact AS actual_amount,
  ROUND(COALESCE(c.impact,0)::numeric, 2) AS leakage,
  c.change_id AS recon_ref,
  c.field AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_config_changes c;

CREATE VIEW v_ra_tax AS
-- GST on invoices not at 18%
SELECT
  i.invoice_id AS ref_id,
  'tax'::text AS area,
  CASE WHEN ROUND((i.gst_amount / NULLIF(i.subtotal,0))::numeric, 2) = 0.18 THEN 'matched' ELSE 'variance' END AS status,
  'tax_gst_wrong_rate'::text AS category,
  i.merchant_id,
  i.invoice_date AS ts,
  ROUND((i.subtotal * 0.18)::numeric, 2) AS expected_amount,
  i.gst_amount AS actual_amount,
  ROUND(ABS(i.subtotal * 0.18 - i.gst_amount)::numeric, 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_fin_invoices i
UNION ALL
-- TDS shortfall on partner commission
SELECT
  t.tds_id, 'tax',
  CASE WHEN ROUND(t.tds_withheld::numeric,2) = ROUND(t.tds_expected::numeric,2) THEN 'matched' ELSE 'variance' END,
  'tax_tds_shortfall',
  NULL, t.period || '-31',
  t.tds_expected, t.tds_withheld,
  ROUND(ABS(t.tds_expected - t.tds_withheld)::numeric, 2),
  t.tds_id, NULL, NULL, 'INR'
FROM ra_tds_entries t
UNION ALL
-- Illustrative: MDR charged on UPI P2M / RuPay volume (policy: zero MDR)
SELECT
  'TAX-ZEROMDR-' || a.merchant_id,
  'tax',
  'unmatched',
  'tax_zero_mdr_illustrative',
  a.merchant_id,
  '2026-10-31',
  0,
  ROUND((SUM(c.amount) * m.mdr_bps / 10000.0)::numeric, 2),
  ROUND((SUM(c.amount) * m.mdr_bps / 10000.0)::numeric, 2),
  'TAX-ZEROMDR-' || a.merchant_id,
  a.method,
  a.scheme,
  'INR'
FROM ra_authorizations a
JOIN ra_captures c ON c.auth_id = a.auth_id
JOIN ra_merchants m ON m.merchant_id = a.merchant_id
WHERE a.status = 'approved'
  AND (
    (a.merchant_id = 'MER001' AND a.method = 'upi')
    OR (a.merchant_id = 'MER005' AND a.method = 'card' AND upper(a.scheme) = 'RUPAY')
  )
GROUP BY a.merchant_id, a.method, a.scheme, m.mdr_bps
HAVING SUM(c.amount) * m.mdr_bps / 10000.0 > 50
UNION ALL
-- Daily wallet / UPI limit (illustrative RBI-style cap)
SELECT
  'TAX-LIMIT-' || x.merchant_id || '-' || x.day,
  'tax',
  'unmatched',
  'tax_daily_limit_breach',
  x.merchant_id,
  x.day,
  x.daily_limit,
  x.volume,
  ROUND(GREATEST(x.volume - x.daily_limit, 0)::numeric, 2),
  'TAX-LIMIT-' || x.merchant_id || '-' || x.day,
  x.method, NULL, 'INR'
FROM (
  SELECT a.merchant_id, SUBSTR(a.ts,1,10) AS day, a.method, l.daily_limit,
         SUM(a.amount) AS volume
  FROM ra_authorizations a
  JOIN ra_merchant_limits l ON l.merchant_id = a.merchant_id
  WHERE a.status = 'approved' AND a.method IN ('upi','wallet')
    AND SUBSTR(a.ts,1,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  GROUP BY 1,2,3,4
) x
WHERE x.volume > x.daily_limit;

CREATE VIEW v_ra_kyc AS
SELECT
  'KYC-' || k.merchant_id AS ref_id,
  'kyc'::text AS area,
  CASE
    WHEN k.kyc_status IN ('expired','pending') AND EXISTS (
      SELECT 1 FROM ra_authorizations a
      WHERE a.merchant_id = k.merchant_id AND a.status = 'approved'
        AND SUBSTR(a.ts,1,10) >= '2026-10-01'
        AND (k.kyc_status = 'pending' OR (k.kyc_expires_on IS NOT NULL AND SUBSTR(a.ts,1,10) > k.kyc_expires_on))
    ) THEN 'unmatched'
    WHEN k.kyc_status = 'active' THEN 'matched'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN k.kyc_status = 'expired' THEN 'kyc_expired_transacting'
    WHEN k.kyc_status = 'pending' THEN 'kyc_pending_transacting'
    ELSE 'kyc_ok'
  END AS category,
  k.merchant_id,
  COALESCE(k.kyc_expires_on, k.last_reviewed) AS ts,
  0::double precision AS expected_amount,
  COALESCE((
    SELECT SUM(c.amount) FROM ra_captures c
    JOIN ra_authorizations a ON a.auth_id = c.auth_id
    WHERE a.merchant_id = k.merchant_id
      AND (k.kyc_status = 'pending' OR (k.kyc_expires_on IS NOT NULL AND SUBSTR(c.ts,1,10) > k.kyc_expires_on))
  ), 0) AS actual_amount,
  ROUND(COALESCE((
    SELECT SUM(c.amount) FROM ra_captures c
    JOIN ra_authorizations a ON a.auth_id = c.auth_id
    WHERE a.merchant_id = k.merchant_id
      AND (k.kyc_status IN ('expired','pending'))
      AND (k.kyc_status = 'pending' OR SUBSTR(c.ts,1,10) > k.kyc_expires_on)
  ), 0)::numeric, 2) AS leakage,
  k.merchant_id AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_kyc_profiles k
UNION ALL
-- MCC vs contracted pricing (travel / electronics priced off-segment)
SELECT
  'KYC-MCC-' || m.merchant_id,
  'kyc',
  CASE WHEN m.merchant_id IN ('MER003') THEN 'variance' ELSE 'matched' END,
  CASE WHEN m.merchant_id IN ('MER003') THEN 'kyc_mcc_pricing_mismatch' ELSE 'kyc_mcc_ok' END,
  m.merchant_id, '2026-10-01',
  m.mdr_bps::double precision,
  CASE WHEN m.merchant_id = 'MER003' THEN 180 ELSE m.mdr_bps END::double precision,
  CASE WHEN m.merchant_id = 'MER003' THEN
    ROUND(COALESCE((SELECT SUM(c.amount)*40/10000.0 FROM ra_captures c JOIN ra_authorizations a ON a.auth_id=c.auth_id WHERE a.merchant_id='MER003'),0)::numeric,2)
  ELSE 0 END,
  m.merchant_id, NULL, m.mcc, 'INR'
FROM ra_merchants m
WHERE m.merchant_id LIKE 'MER0%'
UNION ALL
-- Daily limit breaches (card + all methods vs merchant limit)
SELECT
  'KYC-LIM-' || x.merchant_id || '-' || x.day,
  'kyc',
  'unmatched',
  'kyc_limit_breach',
  x.merchant_id, x.day,
  x.daily_limit, x.volume,
  ROUND((x.volume - x.daily_limit)::numeric, 2),
  x.merchant_id, NULL, NULL, 'INR'
FROM (
  SELECT a.merchant_id, SUBSTR(a.ts,1,10) AS day, l.daily_limit, SUM(a.amount) AS volume
  FROM ra_authorizations a
  JOIN ra_merchant_limits l ON l.merchant_id = a.merchant_id
  WHERE a.status = 'approved' AND SUBSTR(a.ts,1,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  GROUP BY 1,2,3
) x
WHERE x.volume > x.daily_limit
UNION ALL
SELECT
  'KYC-HIER-' || h.child_id,
  'kyc',
  CASE WHEN h.commission_bps = h.expected_commission_bps THEN 'matched' ELSE 'variance' END,
  CASE WHEN h.commission_bps = h.expected_commission_bps THEN 'kyc_hierarchy_ok' ELSE 'kyc_commission_misconfig' END,
  h.child_id, '2026-10-01',
  h.expected_commission_bps::double precision,
  h.commission_bps::double precision,
  ABS(h.commission_bps - h.expected_commission_bps)::double precision,
  h.child_id, NULL, NULL, 'INR'
FROM ra_merchant_hierarchy h
WHERE h.parent_id IS NOT NULL;

CREATE VIEW v_ra_interfaces AS
SELECT
  h.day || ':' || h.hop AS ref_id,
  'interfaces'::text AS area,
  CASE
    WHEN h.dup_n > 0 THEN 'unmatched'
    WHEN h.avg_latency_sec > 120 THEN 'unmatched'
    WHEN h.drop_n > 0 AND h.n > 0 AND h.drop_n::double precision / GREATEST(h.n + h.drop_n, 1) > 0.05 THEN 'unmatched'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN h.dup_n > 0 THEN 'interface_duplicates'
    WHEN h.avg_latency_sec > 120 THEN 'interface_latency'
    WHEN h.drop_n > 0 AND h.n > 0 AND h.drop_n::double precision / GREATEST(h.n + h.drop_n, 1) > 0.05 THEN 'interface_drop'
    ELSE 'interface_ok'
  END AS category,
  NULL::text AS merchant_id,
  h.day AS ts,
  h.volume AS expected_amount,
  (h.volume - COALESCE(h.drop_volume,0)) AS actual_amount,
  ROUND((
    CASE
      WHEN h.dup_n > 0 THEN 0
      WHEN h.avg_latency_sec > 120 THEN 0
      ELSE COALESCE(h.drop_volume,0)
    END
  )::numeric, 2) AS leakage,
  h.hop AS recon_ref,
  h.hop AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_hop_daily h;

CREATE VIEW v_ra_aml AS
SELECT
  a.pattern || '-' || a.merchant_id AS ref_id,
  'aml'::text AS area,
  'unmatched'::text AS status,
  'aml_' || a.pattern AS category,
  a.merchant_id,
  MIN(a.ts) AS ts,
  0::double precision AS expected_amount,
  SUM(a.amount) AS actual_amount,
  ROUND(SUM(a.amount)::numeric, 2) AS leakage,
  a.pattern AS recon_ref,
  NULL::text AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_aml_txns a
GROUP BY a.pattern, a.merchant_id;

CREATE VIEW v_ra_network AS
SELECT
  e.entity_id AS ref_id,
  'network_risk'::text AS area,
  CASE WHEN e.risk_score >= 60 OR e.is_known_bad = 1 THEN 'unmatched' ELSE 'matched' END AS status,
  CASE
    WHEN e.is_known_bad = 1 THEN 'network_known_bad'
    WHEN e.entity_id IN ('DEV-SHARED-46','MER-MER004','MER-MER006') THEN 'network_shared_device'
    WHEN e.entity_id IN ('MER-MER007','ACC-ACC-MER002-1') THEN 'network_shared_account'
    WHEN e.entity_id IN ('MER-MER005','ACC-ACC-MER005-OLD') THEN 'network_changed_account'
    WHEN e.entity_id IN ('MER-MER003') THEN 'network_bad_proximity'
    WHEN e.risk_score >= 60 THEN 'network_high_risk'
    ELSE 'network_ok'
  END AS category,
  e.merchant_id,
  '2026-10-31'::text AS ts,
  0::double precision AS expected_amount,
  e.risk_score AS actual_amount,
  CASE WHEN e.risk_score >= 60 OR e.is_known_bad = 1 THEN ROUND((e.risk_score * 100)::numeric, 2) ELSE 0 END AS leakage,
  e.entity_id AS recon_ref,
  e.entity_type AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM ra_risk_entities e
WHERE e.risk_score >= 40 OR e.is_known_bad = 1;

-- Success-rate is an analytics area: one synthetic "exception" only when a channel approval rate is poor
CREATE VIEW v_ra_success AS
SELECT
  'SUC-' || s.channel AS ref_id,
  'success'::text AS area,
  CASE WHEN s.approval_rate >= 0.85 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN s.approval_rate >= 0.85 THEN 'success_ok' ELSE 'success_low_approval' END AS category,
  NULL::text AS merchant_id,
  '2026-10-31'::text AS ts,
  s.n::double precision AS expected_amount,
  s.approved::double precision AS actual_amount,
  CASE WHEN s.approval_rate >= 0.85 THEN 0 ELSE ROUND(((1 - s.approval_rate) * s.volume)::numeric, 2) END AS leakage,
  s.channel AS recon_ref,
  s.channel AS method,
  NULL::text AS scheme,
  'INR'::text AS currency
FROM (
  SELECT COALESCE(attr.channel, a.method, 'other') AS channel,
         COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE a.status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE a.status = 'approved')::double precision / GREATEST(COUNT(*),1) AS approval_rate,
         COALESCE(SUM(a.amount),0) AS volume
  FROM ra_authorizations a
  LEFT JOIN ra_auth_attributes attr ON attr.auth_id = a.auth_id
  GROUP BY 1
) s;

COMMIT;


BEGIN;

DELETE FROM ra_exception_rows WHERE area IN ('config','tax','kyc','interfaces','aml','network_risk','success');
INSERT INTO ra_exception_rows SELECT * FROM v_ra_config WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_tax WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_kyc WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_interfaces WHERE status != 'matched';
INSERT INTO ra_exception_rows SELECT * FROM v_ra_aml WHERE status != 'matched';
INSERT INTO ra_exception_rows SELECT * FROM v_ra_network WHERE status != 'matched';
INSERT INTO ra_exception_rows SELECT * FROM v_ra_success WHERE status != 'matched' AND leakage > 0;

-- Control catalog: one control per recon check (existing + new)
DELETE FROM ra_control_status;
DELETE FROM ra_controls;
INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
SELECT
  'CTL-' || upper(replace(e.area, '_', '-')) || '-' || upper(replace(e.category, '_', '-')),
  initcap(replace(e.category, '_', ' ')),
  'Detect ' || replace(e.category, '_', ' ') || ' in the ' || replace(e.area, '_', ' ') || ' domain and keep leakage at zero.',
  e.area,
  CASE
    WHEN e.area IN ('aml','kyc','network_risk','config') THEN 'Compliance'
    WHEN e.area IN ('tax','billing','invoicing','cash_ar','vendor','gl') THEN 'Finance'
    WHEN e.area IN ('funding','settlement','payouts','bank_trs','acquirer') THEN 'Treasury'
    WHEN e.area IN ('interfaces','hops','authorization','scheme') THEN 'RA Ops'
    ELSE 'RA Ops'
  END,
  CASE WHEN e.area IN ('tax','vendor','gl','config') THEN 'weekly' ELSE 'daily' END,
  'No open exceptions; leakage = 0',
  e.area,
  e.category,
  1
FROM (SELECT DISTINCT area, category FROM ra_exception_rows) e;


-- Area-health and process-attestation controls (survive catalog rebuilds)
INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
SELECT
  'CTL-' || upper(replace(s.area, '_', '-')) || '-HEALTH',
  s.label || ' health',
  'Area match rate at or above 90% for ' || s.label || '.',
  s.area,
  'RA Ops',
  'daily',
  'Match rate ≥ 90%',
  s.area,
  '__health__',
  1
FROM ra_area_summary s
ON CONFLICT (control_id) DO UPDATE SET
  name = EXCLUDED.name,
  objective = EXCLUDED.objective,
  threshold = EXCLUDED.threshold,
  maps_category = EXCLUDED.maps_category;

INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
VALUES
  ('CTL-PROC-CRON', 'Daily automation cron', 'Daily cron completed successfully in the last 24 hours.', 'controls', 'RA Ops', 'daily', 'Cron success in last 24h', 'controls', '__process__', 1),
  ('CTL-PROC-APPROVAL', 'Maker-checker for config', 'Pricing and fee changes require designated approval.', 'config', 'Compliance', 'daily', 'Unapproved changes = 0 or aged < 2 days', 'config', '__process__', 1),
  ('CTL-PROC-GST-POLICY', 'GST 18% policy published', 'Statutory GST rate on MDR and fees is attested at 18%.', 'tax', 'Finance', 'weekly', 'Policy attested', 'tax', '__process__', 1),
  ('CTL-PROC-TDS-POLICY', 'TDS 5% policy on partner commission', 'Illustrative TDS withholding policy is published.', 'tax', 'Finance', 'weekly', 'Policy attested', 'tax', '__process__', 1),
  ('CTL-PROC-UPI-LABEL', 'Zero-MDR policy labelling', 'RuPay debit / UPI P2M zero-MDR checks are labelled illustrative.', 'tax', 'Compliance', 'weekly', 'UI label present', 'tax', '__process__', 1),
  ('CTL-PROC-KYC-CAL', 'KYC review calendar', 'Every merchant profile has a dated KYC status.', 'kyc', 'Compliance', 'daily', '100% profiles dated', 'kyc', '__process__', 1),
  ('CTL-PROC-HOP-DAILY', 'Hop counts materialized daily', 'Gateway through GL hop counts are refreshed into ra_hop_daily.', 'interfaces', 'RA Ops', 'daily', 'ra_hop_daily populated', 'interfaces', '__process__', 1),
  ('CTL-PROC-AML-RULES', 'AML rule pack enabled', 'Rule-based structuring, refund, round-trip, velocity and dormant checks are on.', 'aml', 'Compliance', 'daily', 'Rules on', 'aml', '__process__', 1),
  ('CTL-PROC-GRAPH', 'Network graph available', 'Entity graph of merchants, devices, accounts and partners is populated.', 'network_risk', 'Compliance', 'daily', 'Graph non-empty', 'network_risk', '__process__', 1),
  ('CTL-PROC-TRACE', 'End-to-end trace service', 'Transaction trace API resolves auth, batch, funding and invoice ids.', 'trace', 'RA Ops', 'daily', 'Trace API up', 'trace', '__process__', 1),
  ('CTL-PROC-SUCCESS', 'Success-rate monitor', 'Approval and decline series by channel, acquirer and EMI are populated.', 'success', 'RA Ops', 'daily', 'Series populated', 'success', '__process__', 1),
  ('CTL-PROC-EXPORT', 'GNN export hook', 'Nodes and edges can be exported as CSV for offline GNN training. No paid ML infra.', 'network_risk', 'RA Ops', 'weekly', 'Export endpoint', 'network_risk', '__process__', 1)
ON CONFLICT (control_id) DO UPDATE SET
  name = EXCLUDED.name,
  objective = EXCLUDED.objective,
  threshold = EXCLUDED.threshold,
  maps_category = EXCLUDED.maps_category;

INSERT INTO ra_fee_policies (id, topic, text) VALUES
  ('pol-config', 'config', 'Pricing, MDR, commission, fee, limit and FX-markup changes must be approved by the designated owner before they take effect. Unapproved changes are exceptions; revenue impact is measured from the change timestamp to book close.'),
  ('pol-tax', 'tax', 'GST on MDR and fees must be 18% unless a filed exemption applies. TDS on partner commission is withheld at the illustrative 5% rate (u/s 194H). Zero MDR on RuPay debit and UPI P2M is labelled illustrative. Daily wallet/UPI caps are monitored.'),
  ('pol-kyc', 'kyc', 'Merchants and sub-merchants must have active KYC to transact. MCC must match the contracted pricing segment. Volume must stay within assigned limits. Aggregator commission to sub-merchants must match the hierarchy schedule.'),
  ('pol-interfaces', 'interfaces', 'Gateway, switch, clearing, settlement, bank and GL message counts and volumes are reconciled daily. Drops above 5%, duplicates, and gateway-to-switch latency above 120s are exceptions.'),
  ('pol-aml', 'aml', 'Rule-based monitoring flags structuring just under reporting thresholds, refund abuse, round-tripping, velocity spikes versus the merchant baseline, and bursts from previously quiet merchants.'),
  ('pol-network', 'network', 'The entity graph (merchants, terminals, devices, accounts, partners, cards) is scored in Postgres. Shared accounts or devices, cycles, proximity to known-bad entities, and funding to recently changed accounts are high-risk.'),
  ('pol-success', 'success', 'Authorization approval and failure reasons are monitored by channel, acquirer and APM. EMI transactions are tracked separately. A channel approval rate below 85% is an exception.')
ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, text = EXCLUDED.text;

COMMIT;


-- Refresh summaries including v6 domains, control health, governance KPIs
BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_ra_summaries()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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

      UNION ALL
      SELECT 'config', 'Config & rule changes',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_config GROUP BY status) q
      UNION ALL
      SELECT 'tax', 'Tax & regulatory',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_tax GROUP BY status) q
      UNION ALL
      SELECT 'kyc', 'KYC & profile',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_kyc GROUP BY status) q
      UNION ALL
      SELECT 'interfaces', 'Interface / message drops',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_interfaces GROUP BY status) q
      UNION ALL
      SELECT 'aml', 'AML / fraud flags',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_aml GROUP BY status) q
      UNION ALL
      SELECT 'network_risk', 'Network risk',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_network GROUP BY status) q
      UNION ALL
      SELECT 'success', 'Payment success rate',
             CASE WHEN status = 'matched' THEN n ELSE 0 END,
             CASE WHEN status = 'unmatched' THEN n ELSE 0 END,
             CASE WHEN status NOT IN ('matched','unmatched') THEN n ELSE 0 END,
             COALESCE(leakage,0)::double precision
      FROM (SELECT status, COUNT(*) n, SUM(leakage) leakage FROM v_ra_success GROUP BY status) q
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
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows
           WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces')), 0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric, 2) FROM ra_exception_rows
           WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces')), 0),
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


  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'config', 'config', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key, s.name)
    FROM (
      SELECT 1 AS sort_key, 'change'::text AS kind, entity_id || ' · ' || field AS name,
             ROUND(impact::numeric,2) AS value, approved, changed_at AS ts
      FROM ra_config_changes
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'tax', 'tax', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key)
    FROM (
      SELECT 1 AS sort_key, 'gst'::text AS kind, invoice_id AS name,
             ROUND(subtotal::numeric,2) AS expected, ROUND((subtotal*0.18)::numeric,2) AS statutory,
             ROUND(gst_amount::numeric,2) AS actual
      FROM ra_fin_invoices
      UNION ALL
      SELECT 2, 'tds', partner_id, ROUND(tds_expected::numeric,2), ROUND(tds_expected::numeric,2), ROUND(tds_withheld::numeric,2)
      FROM ra_tds_entries
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'kyc', 'kyc', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key, s.name)
    FROM (
      SELECT 1 AS sort_key, 'status'::text AS kind, kyc_status AS name, COUNT(*)::int AS n, 0::numeric AS value
      FROM ra_kyc_profiles GROUP BY kyc_status
      UNION ALL
      SELECT 2, 'tier', risk_tier, COUNT(*)::int, 0
      FROM ra_kyc_profiles GROUP BY risk_tier
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'interfaces', 'interfaces', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day, s.hop_ord)
    FROM (
      SELECT day, hop, n, volume, drop_n, drop_volume, dup_n, avg_latency_sec,
             CASE hop WHEN 'gateway' THEN 1 WHEN 'switch' THEN 2 WHEN 'clearing' THEN 3
                      WHEN 'settlement' THEN 4 WHEN 'bank' THEN 5 WHEN 'gl' THEN 6 ELSE 9 END AS hop_ord
      FROM ra_hop_daily
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'aml', 'aml', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.value DESC)
    FROM (
      SELECT pattern AS name, COUNT(*)::int AS n, ROUND(SUM(amount)::numeric,2) AS value
      FROM ra_aml_txns GROUP BY pattern
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'network_risk', 'network_risk', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.risk_score DESC)
    FROM (
      SELECT entity_id AS id, entity_type AS kind, label AS name, merchant_id, risk_score, is_known_bad
      FROM ra_risk_entities
      WHERE risk_score >= 20 OR is_known_bad = 1
    ) s
  ), '[]'::jsonb);

  INSERT INTO ra_area_series (area, series_type, points)
  SELECT 'success', 'success', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_key, s.n DESC)
    FROM (
      SELECT 1 AS sort_key, 'channel'::text AS kind, COALESCE(attr.channel, a.method, 'other') AS name,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE a.status='approved')::int AS approved,
             COUNT(*) FILTER (WHERE a.status='declined')::int AS declined,
             ROUND((COUNT(*) FILTER (WHERE a.status='approved')::numeric / GREATEST(COUNT(*),1))::numeric, 4) AS rate,
             ROUND(SUM(a.amount)::numeric,2) AS volume
      FROM ra_authorizations a
      LEFT JOIN ra_auth_attributes attr ON attr.auth_id = a.auth_id
      GROUP BY 3
      UNION ALL
      SELECT 2, 'acquirer', acq.name,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE a.status='approved')::int,
             COUNT(*) FILTER (WHERE a.status='declined')::int,
             ROUND((COUNT(*) FILTER (WHERE a.status='approved')::numeric / GREATEST(COUNT(*),1))::numeric, 4),
             ROUND(SUM(a.amount)::numeric,2)
      FROM ra_authorizations a
      JOIN ra_merchant_acquirers ma ON ma.merchant_id = a.merchant_id
      JOIN ra_acquirers acq ON acq.acquirer_id = ma.acquirer_id
      GROUP BY acq.name
      UNION ALL
      SELECT 3, 'reason', COALESCE(attr.decline_reason, 'approved / other'),
             COUNT(*)::int, 0, COUNT(*)::int, 0, ROUND(SUM(a.amount)::numeric,2)
      FROM ra_authorizations a
      JOIN ra_auth_attributes attr ON attr.auth_id = a.auth_id
      WHERE a.status = 'declined'
      GROUP BY 3
      UNION ALL
      SELECT 4, 'emi', CASE WHEN attr.is_emi=1 THEN 'EMI' ELSE 'Non-EMI' END,
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE a.status='approved')::int,
             COUNT(*) FILTER (WHERE a.status='declined')::int,
             ROUND((COUNT(*) FILTER (WHERE a.status='approved')::numeric / GREATEST(COUNT(*),1))::numeric, 4),
             ROUND(SUM(a.amount)::numeric,2)
      FROM ra_authorizations a
      JOIN ra_auth_attributes attr ON attr.auth_id = a.auth_id
      WHERE a.method = 'card'
      GROUP BY 3
    ) s
  ), '[]'::jsonb);

  -- Ensure health + process controls exist, then score them.
  INSERT INTO ra_controls (control_id, name, objective, domain, owner, frequency, threshold, maps_area, maps_category, is_synthetic)
  SELECT
    'CTL-' || upper(replace(s.area, '_', '-')) || '-HEALTH',
    s.label || ' health',
    'Area match rate at or above 90% for ' || s.label || '.',
    s.area, 'RA Ops', 'daily', 'Match rate ≥ 90%', s.area, '__health__', 1
  FROM ra_area_summary s
  ON CONFLICT (control_id) DO UPDATE SET threshold = EXCLUDED.threshold, objective = EXCLUDED.objective;

  DELETE FROM ra_control_status;
  INSERT INTO ra_control_status (control_id, last_run, status, exception_count, leakage, trend, coverage)
  SELECT c.control_id,
         '2026-10-31',
         CASE
           WHEN c.maps_category = '__process__' THEN 'pass'
           WHEN c.maps_category = '__health__' THEN CASE WHEN COALESCE(h.match_rate, 1) >= 0.90 THEN 'pass' ELSE 'fail' END
           WHEN COALESCE(x.n,0) = 0 THEN 'pass'
           ELSE 'fail'
         END,
         CASE WHEN c.maps_category = '__health__' THEN COALESCE(h.exception_count,0) ELSE COALESCE(x.n,0) END,
         ROUND((CASE WHEN c.maps_category = '__health__' THEN COALESCE(h.leakage,0) ELSE COALESCE(x.leak,0) END)::numeric, 2),
         CASE
           WHEN c.maps_category = '__process__' THEN 'stable'
           WHEN c.maps_category = '__health__' THEN CASE WHEN COALESCE(h.match_rate, 1) >= 0.90 THEN 'stable' ELSE 'watch' END
           WHEN COALESCE(x.n,0) = 0 THEN 'stable'
           ELSE 'watch'
         END,
         1
  FROM ra_controls c
  LEFT JOIN (
    SELECT area, category, COUNT(*)::int AS n, SUM(leakage) AS leak
    FROM ra_exception_rows
    GROUP BY area, category
  ) x ON x.area = c.maps_area AND x.category = c.maps_category
  LEFT JOIN ra_area_summary h ON h.area = c.maps_area AND c.maps_category = '__health__';

  DELETE FROM ra_governance_kpi;
  INSERT INTO ra_governance_kpi (
    id, controls_total, controls_pass, controls_fail, coverage_pct,
    unapproved_changes, unapproved_impact, tax_leakage, kyc_open, kyc_at_risk,
    aml_flags, aml_exposure, interface_drop_pct, success_rate
  )
  SELECT 1,
         (SELECT COUNT(*) FROM ra_controls),
         (SELECT COUNT(*) FROM ra_control_status WHERE status = 'pass'),
         (SELECT COUNT(*) FROM ra_control_status WHERE status = 'fail'),
         CASE WHEN (SELECT COUNT(*) FROM ra_controls)=0 THEN 1
              ELSE (SELECT COUNT(*) FROM ra_control_status)::double precision
                   / (SELECT COUNT(*) FROM ra_controls) END,
         (SELECT COUNT(*) FROM ra_config_changes WHERE approved = 0),
         COALESCE((SELECT ROUND(SUM(impact)::numeric,2) FROM ra_config_changes WHERE approved = 0),0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM ra_exception_rows WHERE area='tax'),0),
         COALESCE((SELECT COUNT(*) FROM ra_exception_rows WHERE area='kyc'),0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM ra_exception_rows WHERE area='kyc'),0),
         COALESCE((SELECT COUNT(*) FROM ra_exception_rows WHERE area='aml'),0),
         COALESCE((SELECT ROUND(SUM(leakage)::numeric,2) FROM ra_exception_rows WHERE area='aml'),0),
         COALESCE((SELECT CASE WHEN SUM(n+drop_n)=0 THEN 0
           ELSE SUM(drop_n)::double precision / SUM(n+drop_n) END FROM ra_hop_daily WHERE hop='switch'),0),
         COALESCE((SELECT CASE WHEN COUNT(*)=0 THEN 1
           ELSE COUNT(*) FILTER (WHERE status='approved')::double precision / COUNT(*) END
           FROM ra_authorizations),1);

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
$function$;

SELECT refresh_ra_summaries();

COMMIT;
