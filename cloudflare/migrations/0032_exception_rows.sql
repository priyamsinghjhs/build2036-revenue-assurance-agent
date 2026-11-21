-- Materialize exceptions so dashboards do not scan the UNION view (high D1 rows-read).
DROP TABLE IF EXISTS ra_exception_rows;
CREATE TABLE ra_exception_rows (
  ref_id TEXT,
  area TEXT,
  status TEXT,
  category TEXT,
  merchant_id TEXT,
  ts TEXT,
  expected_amount REAL,
  actual_amount REAL,
  leakage REAL,
  recon_ref TEXT,
  method TEXT,
  scheme TEXT,
  currency TEXT
);

INSERT INTO ra_exception_rows SELECT * FROM v_ra_auth_capture WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_capture_scheme WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_scheme_fee_var WHERE leakage > 0.5;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_scheme_bank WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_bank_unidentified;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_fee_gateway WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_fee_network WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_fee_partner WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_terminal_recon WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_fx WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_apm WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_pricing WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_payouts WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows SELECT * FROM v_ra_chargebacks WHERE status != 'matched' AND leakage > 0;

CREATE INDEX idx_ra_exception_area ON ra_exception_rows(area, leakage);
CREATE INDEX idx_ra_exception_ts ON ra_exception_rows(ts);
