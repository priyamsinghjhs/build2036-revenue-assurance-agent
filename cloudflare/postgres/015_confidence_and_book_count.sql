-- Confidence is stored as an integer percent 0–100 (not a 0–1 fraction).
-- Convert any legacy fraction in (0, 1] still sitting in integer/numeric columns.
UPDATE ra_action_queue
   SET confidence = ROUND(confidence * 100)
 WHERE confidence IS NOT NULL AND confidence > 0 AND confidence <= 1;

UPDATE ra_learning_policy
   SET min_confidence = ROUND(min_confidence * 100)
 WHERE min_confidence IS NOT NULL AND min_confidence > 0 AND min_confidence <= 1;

-- Single source of truth for the book open-exception count: COUNT of book
-- exception rows, excluding exposure areas (AML, KYC, network risk, success,
-- interfaces, anomalies, files). Never SUM(area_summary), which can double-count.
CREATE OR REPLACE FUNCTION public.ra_book_exception_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::int
  FROM ra_exception_rows
  WHERE area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files');
$$;

CREATE OR REPLACE FUNCTION public.refresh_ra_summaries()
RETURNS void
LANGUAGE plpgsql
AS $wrap$
BEGIN
  PERFORM refresh_ra_summaries_core();
  PERFORM refresh_ra_v7();
  PERFORM refresh_ra_v7b();
  PERFORM refresh_ra_v9();
  UPDATE ra_kpi_summary
     SET exception_count = public.ra_book_exception_count()
   WHERE id = 1;
END;
$wrap$;

UPDATE ra_kpi_summary
   SET exception_count = public.ra_book_exception_count()
 WHERE id = 1;
