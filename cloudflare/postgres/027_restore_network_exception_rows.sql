-- Restore the 32 Network Fees variance rows that are missing from ra_exception_rows.
-- 001 seeds them (INSERT ... FROM v_ra_fee_network WHERE status != 'matched' AND leakage > 0),
-- and ra_area_summary.network (32 rows, 45.05) is still computed from that view, but the
-- materialised rows were lost in the Neon copy. The executive overlay therefore counted
-- 32 summary-only exceptions that the row-level screens (review, recovery) could not see.
-- Additive and idempotent: only inserts rows that are absent; deletes nothing.
INSERT INTO ra_exception_rows (ref_id, area, status, category, merchant_id, ts, expected_amount, actual_amount, leakage, recon_ref, method, scheme, currency)
SELECT v.ref_id, v.area, v.status, v.category, v.merchant_id, v.ts, v.expected_amount, v.actual_amount, v.leakage, v.recon_ref, v.method, v.scheme, v.currency
FROM v_ra_fee_network v
WHERE v.status <> 'matched' AND v.leakage > 0
  AND NOT EXISTS (
    SELECT 1 FROM ra_exception_rows e
    WHERE e.area = v.area AND e.category = v.category AND e.ref_id = v.ref_id
  );

-- Keep the category rollup in step for the one restored area (insert only if absent).
INSERT INTO ra_leakage_category (area, category, n, leakage)
SELECT area, category, COUNT(*)::int, ROUND(SUM(leakage)::numeric, 2)
FROM ra_exception_rows
WHERE area = 'network'
  AND NOT EXISTS (SELECT 1 FROM ra_leakage_category c WHERE c.area = 'network')
GROUP BY area, category;
