-- TA-13 follow-up: 017's real::numeric typemod rounded large payout amounts
-- to whole rupees (float32 has ~7 significant digits). Restore expected_net
-- (and matched amounts) from the pre-cast text snapshot, then realign
-- under/over actuals so expected ± actual = book leakage.

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_payouts', p.payout_id, 'expected_net', p.expected_net::text,
       ROUND(c.old_value::numeric, 2)::text,
       'Restore expected_net from pre-cast snapshot (real::numeric typemod rounding)'
FROM ra_payouts p
JOIN ra_data_corrections c
  ON c.record_key = p.payout_id AND c.table_name = 'ra_payouts'
 AND c.column_name = 'expected_net' AND c.reason = 'pre-cast snapshot'
WHERE p.expected_net IS DISTINCT FROM ROUND(c.old_value::numeric, 2);

UPDATE ra_payouts p
   SET expected_net = ROUND(c.old_value::numeric, 2)
  FROM ra_data_corrections c
 WHERE c.record_key = p.payout_id AND c.table_name = 'ra_payouts'
   AND c.column_name = 'expected_net' AND c.reason = 'pre-cast snapshot'
   AND p.expected_net IS DISTINCT FROM ROUND(c.old_value::numeric, 2);

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_payouts', p.payout_id, 'amount', p.amount::text,
       ROUND(c.old_value::numeric, 2)::text,
       'Restore matched payout amount from pre-cast snapshot (real::numeric typemod rounding)'
FROM ra_payouts p
JOIN ra_data_corrections c
  ON c.record_key = p.payout_id AND c.table_name = 'ra_payouts'
 AND c.column_name = 'amount' AND c.reason = 'pre-cast snapshot'
WHERE p.amount IS DISTINCT FROM ROUND(c.old_value::numeric, 2)
  AND NOT EXISTS (
    SELECT 1 FROM ra_exception_rows e
     WHERE e.ref_id = p.payout_id AND e.area = 'payouts'
       AND e.category IN ('under_payout', 'over_payout')
  );

UPDATE ra_payouts p
   SET amount = ROUND(c.old_value::numeric, 2)
  FROM ra_data_corrections c
 WHERE c.record_key = p.payout_id AND c.table_name = 'ra_payouts'
   AND c.column_name = 'amount' AND c.reason = 'pre-cast snapshot'
   AND p.amount IS DISTINCT FROM ROUND(c.old_value::numeric, 2)
   AND NOT EXISTS (
     SELECT 1 FROM ra_exception_rows e
      WHERE e.ref_id = p.payout_id AND e.area = 'payouts'
        AND e.category IN ('under_payout', 'over_payout')
   );

INSERT INTO ra_data_corrections (table_name, record_key, column_name, old_value, new_value, reason)
SELECT 'ra_exception_rows',
       e.area || ':' || e.category || ':' || e.ref_id,
       'expected_amount', e.expected_amount::text, p.expected_net::text,
       'Restore exception expected from corrected payout expected_net'
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
       'actual_amount', actual_amount::text,
       ROUND((expected_amount - leakage)::numeric, 2)::text,
       'Re-align under_payout actual after restoring expected_net (keep book leakage)'
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
       'actual_amount', actual_amount::text,
       ROUND((expected_amount + leakage)::numeric, 2)::text,
       'Re-align over_payout actual after restoring expected_net (keep book leakage)'
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
       'Sync payout amount to re-aligned exception actual (keep book leakage and payout expected_net)'
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
SELECT 'migration:018', 'admin', 'PATCH', '/postgres/018_restore_payout_expected', 'data_correction', record_key,
       jsonb_build_object('table_name', table_name, 'column_name', column_name, 'old_value', old_value, 'new_value', new_value, 'reason', reason)
FROM ra_data_corrections
WHERE reason IN (
  'Restore expected_net from pre-cast snapshot (real::numeric typemod rounding)',
  'Restore matched payout amount from pre-cast snapshot (real::numeric typemod rounding)',
  'Restore exception expected from corrected payout expected_net',
  'Re-align under_payout actual after restoring expected_net (keep book leakage)',
  'Re-align over_payout actual after restoring expected_net (keep book leakage)',
  'Sync payout amount to re-aligned exception actual (keep book leakage and payout expected_net)'
);

SELECT public.refresh_ra_summaries();
