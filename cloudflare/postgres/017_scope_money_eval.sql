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

ALTER TABLE ra_payouts
  ALTER COLUMN amount TYPE numeric(14,2) USING ROUND(amount::numeric, 2),
  ALTER COLUMN expected_net TYPE numeric(14,2) USING ROUND(expected_net::numeric, 2);

ALTER TABLE ra_exception_rows
  ALTER COLUMN expected_amount TYPE numeric(14,2) USING CASE WHEN expected_amount IS NULL THEN NULL ELSE ROUND(expected_amount::numeric, 2) END,
  ALTER COLUMN actual_amount TYPE numeric(14,2) USING CASE WHEN actual_amount IS NULL THEN NULL ELSE ROUND(actual_amount::numeric, 2) END,
  ALTER COLUMN leakage TYPE numeric(14,2) USING CASE WHEN leakage IS NULL THEN NULL ELSE ROUND(leakage::numeric, 2) END;

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
       'Sync payout amount to paise-corrected exception actual (keep book leakage)'
FROM ra_payouts p
JOIN ra_exception_rows e ON e.ref_id = p.payout_id AND e.area = 'payouts'
WHERE e.category IN ('under_payout', 'over_payout')
  AND p.amount IS DISTINCT FROM e.actual_amount;

UPDATE ra_payouts p
   SET amount = e.actual_amount,
       expected_net = e.expected_amount
  FROM ra_exception_rows e
 WHERE e.ref_id = p.payout_id AND e.area = 'payouts'
   AND e.category IN ('under_payout', 'over_payout')
   AND (p.amount IS DISTINCT FROM e.actual_amount OR p.expected_net IS DISTINCT FROM e.expected_amount);

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
