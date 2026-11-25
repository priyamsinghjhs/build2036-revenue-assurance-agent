-- Additional indexes for slow network-risk / exception queries and SLA ageing support.
CREATE INDEX IF NOT EXISTS ra_exception_rows_area_ts ON ra_exception_rows (area, ts DESC);
CREATE INDEX IF NOT EXISTS ra_exception_rows_leakage ON ra_exception_rows (leakage DESC) WHERE leakage > 0;

-- Simple SLA bucket helper view
CREATE OR REPLACE VIEW v_ra_sla_ageing AS
SELECT
  CASE
    -- Some rows carry a month only (e.g. '2026-10'); treat those as the 1st of the month.
    WHEN ts IS NULL OR ts !~ '^\d{4}-\d{2}' THEN 'unknown'
    WHEN (CURRENT_DATE - CAST(SUBSTR(ts || '-01', 1, 10) AS date)) <= 7 THEN '0-7'
    WHEN (CURRENT_DATE - CAST(SUBSTR(ts || '-01', 1, 10) AS date)) <= 30 THEN '8-30'
    WHEN (CURRENT_DATE - CAST(SUBSTR(ts || '-01', 1, 10) AS date)) <= 60 THEN '31-60'
    ELSE '61+'
  END AS sla_bucket,
  COUNT(*) AS n,
  COALESCE(SUM(leakage),0) AS leakage
FROM ra_exception_rows
WHERE leakage > 0
GROUP BY 1;
