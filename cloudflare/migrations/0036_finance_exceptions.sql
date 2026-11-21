-- 0036 Materialize new finance/hop exceptions into ra_exception_rows (cheap dashboard reads)

INSERT INTO ra_exception_rows
SELECT * FROM v_ra_contract_billing WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_usage_billing WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_billing_invoice WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_invoice_tax WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_invoice_cash WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_unapplied_cash WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_vendor_cost WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_vendor_pay WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_gl_unposted WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_gl_invoice WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_gateway_switch WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_switch_orphan WHERE leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_switch_clearing WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_bank_trs WHERE status != 'matched' AND leakage > 0;
INSERT INTO ra_exception_rows
SELECT * FROM v_ra_ar_ageing WHERE status != 'matched' AND leakage > 0 AND category IN ('ar_31_60','ar_61_90','ar_90_plus');
