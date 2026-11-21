-- Recreate core views dropped by 0030 before they were copied into that file

DROP VIEW IF EXISTS v_ra_exceptions;
DROP VIEW IF EXISTS v_ra_exceptions_a;
DROP VIEW IF EXISTS v_ra_auth_capture;
DROP VIEW IF EXISTS v_ra_scheme_fee_var;

CREATE VIEW v_ra_auth_capture AS
SELECT
  a.auth_id AS ref_id,
  'authorization' AS area,
  CASE
    WHEN a.status = 'declined' THEN 'matched'
    WHEN c.capture_id IS NULL THEN 'unmatched'
    WHEN ROUND(c.amount, 2) != ROUND(a.amount, 2) THEN 'variance'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN a.status = 'declined' THEN 'declined_auth'
    WHEN c.capture_id IS NULL THEN 'expired_auth'
    WHEN ROUND(c.amount, 2) != ROUND(a.amount, 2) THEN 'auth_capture_mismatch'
    ELSE 'auth_captured'
  END AS category,
  a.merchant_id,
  a.ts,
  a.amount AS expected_amount,
  COALESCE(c.amount, 0) AS actual_amount,
  CASE
    WHEN a.status = 'declined' THEN 0
    WHEN c.capture_id IS NULL THEN a.amount
    ELSE ROUND(ABS(a.amount - c.amount), 2)
  END AS leakage,
  a.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_authorizations a
LEFT JOIN ra_captures c ON c.auth_id = a.auth_id;

CREATE VIEW v_ra_scheme_fee_var AS
SELECT
  s.scheme_id AS ref_id,
  'scheme' AS area,
  CASE WHEN ABS(ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2)) > 0.5 THEN 'variance' ELSE 'matched' END AS status,
  CASE WHEN ABS(ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2)) > 0.5 THEN 'scheme_fee_variance' ELSE 'scheme_fee_ok' END AS category,
  a.merchant_id,
  s.settlement_date AS ts,
  ROUND(c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END, 2) AS expected_amount,
  ROUND(s.interchange + s.scheme_fee, 2) AS actual_amount,
  ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2) AS leakage,
  s.recon_ref,
  a.method,
  s.scheme,
  a.currency
FROM ra_scheme_settlements s
JOIN ra_captures c ON c.capture_id = s.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
WHERE a.method = 'card'
  AND ROUND((s.interchange + s.scheme_fee) - (c.amount * CASE s.scheme
    WHEN 'VISA' THEN 0.0092
    WHEN 'MASTERCARD' THEN 0.0097
    WHEN 'RUPAY' THEN 0.0048
    WHEN 'AMEX' THEN 0.0158
    ELSE 0.006 END), 2) > 0.5;

CREATE VIEW v_ra_exceptions_a AS
SELECT * FROM (
  SELECT * FROM v_ra_auth_capture WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_capture_scheme WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_scheme_fee_var WHERE leakage > 0.5
  UNION ALL SELECT * FROM v_ra_scheme_bank WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_bank_unidentified
);

CREATE VIEW v_ra_exceptions AS
SELECT * FROM v_ra_exceptions_a
UNION ALL SELECT * FROM v_ra_exceptions_b
UNION ALL SELECT * FROM v_ra_exceptions_c;
