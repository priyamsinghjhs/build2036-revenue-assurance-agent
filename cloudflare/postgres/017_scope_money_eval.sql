-- TA-13: record-level assignments, money paise correction, eval score archive.

CREATE TABLE IF NOT EXISTS ra_record_assignments (
  object_type text NOT NULL,
  object_id text NOT NULL,
  user_id text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text NOT NULL,
  PRIMARY KEY (object_type, object_id, user_id)
);
CREATE INDEX IF NOT EXISTS ra_record_assignments_user ON ra_record_assignments (user_id, object_type);

CREATE TABLE IF NOT EXISTS ra_data_corrections (
  correction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  record_key text NOT NULL,
  column_name text NOT NULL,
  old_value text,
  new_value text,
  reason text NOT NULL,
  applied_by text NOT NULL DEFAULT 'migration:017_scope_money_eval'
);

-- Archive of eval scores before any rescore. Never delete original numbers.
CREATE TABLE IF NOT EXISTS ra_eval_scores_archive (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_label text NOT NULL,
  eval_id text,
  run_id text,
  output_id text,
  agent_id text,
  faithfulness numeric(6,4),
  claims integer,
  supported integer,
  retries integer,
  verification text,
  unsupported jsonb,
  created_at timestamptz
);
CREATE INDEX IF NOT EXISTS ra_eval_scores_archive_eval ON ra_eval_scores_archive (eval_id, archived_at DESC);

ALTER TABLE ra_eval_scores ADD COLUMN IF NOT EXISTS rescore_label text;
ALTER TABLE ra_eval_scores ADD COLUMN IF NOT EXISTS rescored_at timestamptz;
ALTER TABLE ra_eval_scores ADD COLUMN IF NOT EXISTS previous_verification text;
ALTER TABLE ra_eval_scores ADD COLUMN IF NOT EXISTS previous_faithfulness numeric(6,4);

-- Cast payout and exception money to paise-exact numerics, then align
-- under/over-payout actuals so expected - actual = leakage at 2 decimals.
-- The ₹0.06 amount_reconciliation fail on PAY-MER002-2026-10 is a REAL
-- (float32) seed artefact: 627947.38 / 647368.43 stored as 627947.4 /
-- 647368.44, while leakage stayed 19421.10 (a 0.06 JS residual).
-- Book leakage 19421.10 is kept; actual is set to expected - leakage.

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_payouts', payout_id, 'amount', amount::text, amount::text, 'pre-cast snapshot'
FROM ra_payouts;

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_payouts', payout_id, 'expected_net', expected_net::text, expected_net::text, 'pre-cast snapshot'
FROM ra_payouts;

-- Views depend on these money columns; drop the chain, recast, then recreate.
DROP VIEW IF EXISTS v_ra_exceptions;
DROP VIEW IF EXISTS v_ra_exceptions_c;
DROP VIEW IF EXISTS v_ra_payouts;
DROP VIEW IF EXISTS v_ask_exceptions;

ALTER TABLE ra_payouts
  ALTER COLUMN amount TYPE numeric(14,2) USING ROUND(amount::text::numeric, 2),
  ALTER COLUMN expected_net TYPE numeric(14,2) USING ROUND(expected_net::text::numeric, 2);

ALTER TABLE ra_exception_rows
  ALTER COLUMN expected_amount TYPE numeric(14,2) USING CASE WHEN expected_amount IS NULL THEN NULL ELSE ROUND(expected_amount::text::numeric, 2) END,
  ALTER COLUMN actual_amount TYPE numeric(14,2) USING CASE WHEN actual_amount IS NULL THEN NULL ELSE ROUND(actual_amount::text::numeric, 2) END,
  ALTER COLUMN leakage TYPE numeric(14,2) USING CASE WHEN leakage IS NULL THEN NULL ELSE ROUND(leakage::text::numeric, 2) END;


CREATE OR REPLACE VIEW v_ask_exceptions AS
 SELECT area,
    category,
    ref_id,
    merchant_id,
    ts,
    expected_amount,
    actual_amount,
    leakage,
    scheme,
    method,
    status,
    (((area || ':'::text) || category) || ':'::text) || ref_id AS exception_id
   FROM ra_exception_rows;

-- Dropping the view removed 006's grant; restore it (see 019).
GRANT SELECT ON v_ask_exceptions TO ra_readonly;

CREATE OR REPLACE VIEW v_ra_payouts AS
 SELECT p.payout_id AS ref_id,
    'payouts'::text AS area,
        CASE
            WHEN round(p.amount, 2) = round(p.expected_net, 2) THEN 'matched'::text
            ELSE 'variance'::text
        END AS status,
        CASE
            WHEN p.amount < (p.expected_net - 0.50) THEN 'under_payout'::text
            WHEN p.amount > (p.expected_net + 0.50) THEN 'over_payout'::text
            ELSE 'payout_ok'::text
        END AS category,
    p.merchant_id,
    p.payout_date AS ts,
    p.expected_net AS expected_amount,
    p.amount AS actual_amount,
    round(abs(p.expected_net - p.amount), 2) AS leakage,
    p.payout_id AS recon_ref,
    NULL::text AS method,
    NULL::text AS scheme,
    'INR'::text AS currency
   FROM ra_payouts p
UNION ALL
 SELECT r.reserve_id AS ref_id,
    'payouts'::text AS area,
        CASE
            WHEN r.status = 'overdue'::text THEN 'unmatched'::text
            ELSE 'matched'::text
        END AS status,
        CASE
            WHEN r.status = 'overdue'::text THEN 'reserve_overdue'::text
            ELSE 'reserve_held'::text
        END AS category,
    r.merchant_id,
    r.held_since AS ts,
    0::numeric(14,2) AS expected_amount,
    r.amount::numeric(14,2) AS actual_amount,
        CASE
            WHEN r.status = 'overdue'::text THEN r.amount::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS leakage,
    r.reserve_id AS recon_ref,
    NULL::text AS method,
    NULL::text AS scheme,
    'INR'::text AS currency
   FROM ra_reserves r;


CREATE OR REPLACE VIEW v_ra_exceptions_c AS
 SELECT ref_id,
    area,
    status,
    category,
    merchant_id,
    ts,
    expected_amount,
    actual_amount,
    leakage,
    recon_ref,
    method,
    scheme,
    currency
   FROM ( SELECT v_ra_apm.ref_id,
            v_ra_apm.area,
            v_ra_apm.status,
            v_ra_apm.category,
            v_ra_apm.merchant_id,
            v_ra_apm.ts,
            v_ra_apm.expected_amount,
            v_ra_apm.actual_amount,
            v_ra_apm.leakage,
            v_ra_apm.recon_ref,
            v_ra_apm.method,
            v_ra_apm.scheme,
            v_ra_apm.currency
           FROM v_ra_apm
          WHERE v_ra_apm.status <> 'matched'::text AND v_ra_apm.leakage > 0::numeric
        UNION ALL
         SELECT v_ra_pricing.ref_id,
            v_ra_pricing.area,
            v_ra_pricing.status,
            v_ra_pricing.category,
            v_ra_pricing.merchant_id,
            v_ra_pricing.ts,
            v_ra_pricing.expected_amount,
            v_ra_pricing.actual_amount,
            v_ra_pricing.leakage,
            v_ra_pricing.recon_ref,
            v_ra_pricing.method,
            v_ra_pricing.scheme,
            v_ra_pricing.currency
           FROM v_ra_pricing
          WHERE v_ra_pricing.status <> 'matched'::text AND v_ra_pricing.leakage > 0::numeric
        UNION ALL
         SELECT v_ra_payouts.ref_id,
            v_ra_payouts.area,
            v_ra_payouts.status,
            v_ra_payouts.category,
            v_ra_payouts.merchant_id,
            v_ra_payouts.ts,
            v_ra_payouts.expected_amount,
            v_ra_payouts.actual_amount,
            v_ra_payouts.leakage,
            v_ra_payouts.recon_ref,
            v_ra_payouts.method,
            v_ra_payouts.scheme,
            v_ra_payouts.currency
           FROM v_ra_payouts
          WHERE v_ra_payouts.status <> 'matched'::text AND v_ra_payouts.leakage > 0
        UNION ALL
         SELECT v_ra_chargebacks.ref_id,
            v_ra_chargebacks.area,
            v_ra_chargebacks.status,
            v_ra_chargebacks.category,
            v_ra_chargebacks.merchant_id,
            v_ra_chargebacks.ts,
            v_ra_chargebacks.expected_amount,
            v_ra_chargebacks.actual_amount,
            v_ra_chargebacks.leakage,
            v_ra_chargebacks.recon_ref,
            v_ra_chargebacks.method,
            v_ra_chargebacks.scheme,
            v_ra_chargebacks.currency
           FROM v_ra_chargebacks
          WHERE v_ra_chargebacks.status <> 'matched'::text AND v_ra_chargebacks.leakage > 0::double precision) unnamed_subquery;

CREATE OR REPLACE VIEW v_ra_exceptions AS
 SELECT v_ra_exceptions_a.ref_id,
    v_ra_exceptions_a.area,
    v_ra_exceptions_a.status,
    v_ra_exceptions_a.category,
    v_ra_exceptions_a.merchant_id,
    v_ra_exceptions_a.ts,
    v_ra_exceptions_a.expected_amount,
    v_ra_exceptions_a.actual_amount,
    v_ra_exceptions_a.leakage,
    v_ra_exceptions_a.recon_ref,
    v_ra_exceptions_a.method,
    v_ra_exceptions_a.scheme,
    v_ra_exceptions_a.currency
   FROM v_ra_exceptions_a
UNION ALL
 SELECT v_ra_exceptions_b.ref_id,
    v_ra_exceptions_b.area,
    v_ra_exceptions_b.status,
    v_ra_exceptions_b.category,
    v_ra_exceptions_b.merchant_id,
    v_ra_exceptions_b.ts,
    v_ra_exceptions_b.expected_amount,
    v_ra_exceptions_b.actual_amount,
    v_ra_exceptions_b.leakage,
    v_ra_exceptions_b.recon_ref,
    v_ra_exceptions_b.method,
    v_ra_exceptions_b.scheme,
    v_ra_exceptions_b.currency
   FROM v_ra_exceptions_b
UNION ALL
 SELECT v_ra_exceptions_c.ref_id,
    v_ra_exceptions_c.area,
    v_ra_exceptions_c.status,
    v_ra_exceptions_c.category,
    v_ra_exceptions_c.merchant_id,
    v_ra_exceptions_c.ts,
    v_ra_exceptions_c.expected_amount,
    v_ra_exceptions_c.actual_amount,
    v_ra_exceptions_c.leakage,
    v_ra_exceptions_c.recon_ref,
    v_ra_exceptions_c.method,
    v_ra_exceptions_c.scheme,
    v_ra_exceptions_c.currency
   FROM v_ra_exceptions_c;

-- Payout expected_net (post text-cast) is the source of truth; copy it onto exception rows
-- before aligning actuals, and never write exception expected back onto payouts.
INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_exception_rows',
       e.area || ':' || e.category || ':' || e.ref_id,
       'expected_amount', e.expected_amount::text, p.expected_net::text,
       'Copy payout expected_net onto exception expected after numeric(14,2) text-cast'
FROM ra_exception_rows e
JOIN ra_payouts p ON p.payout_id = e.ref_id
WHERE e.area = 'payouts' AND e.category IN ('under_payout', 'over_payout')
  AND e.expected_amount IS DISTINCT FROM p.expected_net;

UPDATE ra_exception_rows e
   SET expected_amount = p.expected_net
  FROM ra_payouts p
 WHERE p.payout_id = e.ref_id
   AND e.area = 'payouts' AND e.category IN ('under_payout', 'over_payout')
   AND e.expected_amount IS DISTINCT FROM p.expected_net;

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_exception_rows',
       area || ':' || category || ':' || ref_id,
       'actual_amount',
       actual_amount::text,
       ROUND((expected_amount - leakage)::numeric, 2)::text,
       'Align under_payout actual so expected minus actual equals book leakage (seed REAL rounding)'
FROM ra_exception_rows
WHERE category = 'under_payout'
  AND expected_amount IS NOT NULL AND actual_amount IS NOT NULL AND leakage IS NOT NULL
  AND abs((expected_amount - actual_amount) - leakage) > 0.009;

UPDATE ra_exception_rows
   SET actual_amount = ROUND((expected_amount - leakage)::numeric, 2)
 WHERE category = 'under_payout'
   AND expected_amount IS NOT NULL AND actual_amount IS NOT NULL AND leakage IS NOT NULL
   AND abs((expected_amount - actual_amount) - leakage) > 0.009;

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_exception_rows',
       area || ':' || category || ':' || ref_id,
       'actual_amount',
       actual_amount::text,
       ROUND((expected_amount + leakage)::numeric, 2)::text,
       'Align over_payout actual so actual minus expected equals book leakage (seed REAL rounding)'
FROM ra_exception_rows
WHERE category = 'over_payout'
  AND expected_amount IS NOT NULL AND actual_amount IS NOT NULL AND leakage IS NOT NULL
  AND abs((actual_amount - expected_amount) - leakage) > 0.009;

UPDATE ra_exception_rows
   SET actual_amount = ROUND((expected_amount + leakage)::numeric, 2)
 WHERE category = 'over_payout'
   AND expected_amount IS NOT NULL AND actual_amount IS NOT NULL AND leakage IS NOT NULL
   AND abs((actual_amount - expected_amount) - leakage) > 0.009;

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_payouts', p.payout_id, 'amount', p.amount::text, e.actual_amount::text,
       'Sync payout amount to paise-corrected exception actual (keep book leakage and payout expected_net)'
FROM ra_payouts p
JOIN ra_exception_rows e ON e.ref_id = p.payout_id AND e.area = 'payouts'
WHERE e.category IN ('under_payout', 'over_payout')
  AND p.amount IS DISTINCT FROM e.actual_amount;

UPDATE ra_payouts p
   SET amount = e.actual_amount
  FROM ra_exception_rows e
 WHERE e.ref_id = p.payout_id AND e.area = 'payouts'
   AND e.category IN ('under_payout', 'over_payout')
   AND p.amount IS DISTINCT FROM e.actual_amount;

INSERT INTO ra_audit_events (user_id, role, method, path, action, entity_id, detail)
SELECT 'migration:017', 'admin', 'PATCH', '/postgres/017_scope_money_eval', 'data_correction', record_key,
       jsonb_build_object('table_name', table_name, 'column_name', column_name, 'old_value', old_value, 'new_value', new_value, 'reason', reason)
FROM ra_data_corrections
WHERE applied_by = 'migration:017_scope_money_eval'
  AND reason NOT LIKE 'pre-cast snapshot';

-- Seed assignments used by IDOR tests and recon_ops queues.
-- AML sits outside the recon_ops domain queue; the assigned velocity item is visible, others are not.
INSERT INTO ra_record_assignments (object_type, object_id, user_id, assigned_by)
VALUES
  ('exception', 'aml:aml_velocity_spike:velocity_spike-MER006', 'recon_ops@ra.local', 'migration:017_scope_money_eval'),
  ('review', 'aml:aml_velocity_spike:velocity_spike-MER006', 'recon_ops@ra.local', 'migration:017_scope_money_eval')
ON CONFLICT DO NOTHING;

-- Refresh book summaries after the paise correction (leakage totals unchanged).
SELECT public.refresh_ra_summaries();
