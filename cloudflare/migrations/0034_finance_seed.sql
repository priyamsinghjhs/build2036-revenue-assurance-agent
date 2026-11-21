-- 0034 Finance seed: contracts, billing, invoices, cash, vendor, GL (SYNTHETIC)
INSERT INTO ra_contracts (contract_id, merchant_id, plan_name, mdr_bps, per_txn_fee, monthly_min, terminal_rental, vas_bps, gst_pct, start_date, status, is_synthetic) VALUES
  ('CTR-MER001', 'MER001', 'Enterprise 180bps', 180, 2.00, 8000.00, 3600.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER002', 'MER002', 'Standard 160bps', 160, 2.00, 3000.00, 3600.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER003', 'MER003', 'Standard 220bps', 220, 2.00, 3000.00, 4800.00, 5, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER004', 'MER004', 'Standard 190bps', 190, 2.00, 3000.00, 4800.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER005', 'MER005', 'Standard 170bps', 170, 2.00, 3000.00, 3600.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER006', 'MER006', 'Enterprise 200bps', 200, 2.00, 8000.00, 4800.00, 5, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER007', 'MER007', 'Standard 175bps', 175, 2.00, 3000.00, 3600.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER008', 'MER008', 'Standard 150bps', 150, 2.00, 3000.00, 2400.00, 0, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER009', 'MER009', 'Standard 240bps', 240, 2.00, 500.00, 105.00, 5, 18.00, '2026-04-01', 'active', 1),
  ('CTR-MER010', 'MER010', 'Standard 165bps', 165, 2.00, 3000.00, 3600.00, 0, 18.00, '2026-04-01', 'active', 1);

INSERT INTO ra_billing_lines (line_id, run_id, merchant_id, period, charge_type, usage_qty, rate, amount, expected_amount, gst_amount, is_synthetic) VALUES
  ('BL-MER001-2026-10-MDR', 'BR-2026-10', 'MER001', '2026-10', 'mdr', 643485.53, 0.02, 10295.77, 11582.74, 1853.24, 1),
  ('BL-MER001-2026-10-PERTXN', 'BR-2026-10', 'MER001', '2026-10', 'per_txn', 209.00, 2.00, 418.00, 418.00, 75.24, 1),
  ('BL-MER001-2026-10-TERMINAL', 'BR-2026-10', 'MER001', '2026-10', 'terminal_rental', 1.00, 3600.00, 3600.00, 3600.00, 648.00, 1),
  ('BL-MER002-2026-10-MDR', 'BR-2026-10', 'MER002', '2026-10', 'mdr', 661669.40, 0.02, 10586.71, 10586.71, 1905.61, 1),
  ('BL-MER002-2026-10-PERTXN', 'BR-2026-10', 'MER002', '2026-10', 'per_txn', 227.00, 2.00, 454.00, 454.00, 81.72, 1),
  ('BL-MER002-2026-10-TERMINAL', 'BR-2026-10', 'MER002', '2026-10', 'terminal_rental', 1.00, 3600.00, 3600.00, 3600.00, 648.00, 1),
  ('BL-MER003-2026-10-MDR', 'BR-2026-10', 'MER003', '2026-10', 'mdr', 370368.75, 0.02, 8148.11, 8148.11, 1466.66, 1),
  ('BL-MER003-2026-10-PERTXN', 'BR-2026-10', 'MER003', '2026-10', 'per_txn', 129.00, 2.00, 258.00, 258.00, 46.44, 1),
  ('BL-MER003-2026-10-TERMINAL', 'BR-2026-10', 'MER003', '2026-10', 'terminal_rental', 1.00, 4800.00, 4800.00, 4800.00, 864.00, 1),
  ('BL-MER003-2026-10-VAS', 'BR-2026-10', 'MER003', '2026-10', 'vas', 370368.75, 0.00, 185.18, 185.18, 33.33, 1),
  ('BL-MER004-2026-10-MDR', 'BR-2026-10', 'MER004', '2026-10', 'mdr', 468305.48, 0.02, 8897.80, 8897.80, 1601.60, 1),
  ('BL-MER004-2026-10-PERTXN', 'BR-2026-10', 'MER004', '2026-10', 'per_txn', 157.00, 2.00, 314.00, 314.00, 56.52, 1),
  ('BL-MER004-2026-10-TERMINAL', 'BR-2026-10', 'MER004', '2026-10', 'terminal_rental', 1.00, 4800.00, 4800.00, 4800.00, 864.00, 1),
  ('BL-MER005-2026-10-MDR', 'BR-2026-10', 'MER005', '2026-10', 'mdr', 636144.66, 0.02, 10814.46, 10814.46, 1946.60, 1),
  ('BL-MER005-2026-10-PERTXN', 'BR-2026-10', 'MER005', '2026-10', 'per_txn', 185.00, 2.00, 370.00, 370.00, 66.60, 1),
  ('BL-MER005-2026-10-TERMINAL', 'BR-2026-10', 'MER005', '2026-10', 'terminal_rental', 1.00, 3600.00, 3600.00, 3600.00, 648.00, 1),
  ('BL-MER006-2026-10-MDR', 'BR-2026-10', 'MER006', '2026-10', 'mdr', 660490.22, 0.02, 13209.80, 13209.80, 2377.76, 1),
  ('BL-MER006-2026-10-PERTXN', 'BR-2026-10', 'MER006', '2026-10', 'per_txn', 212.00, 2.00, 424.00, 424.00, 76.32, 1),
  ('BL-MER006-2026-10-TERMINAL', 'BR-2026-10', 'MER006', '2026-10', 'terminal_rental', 1.00, 4800.00, 4800.00, 4800.00, 864.00, 1),
  ('BL-MER006-2026-10-VAS', 'BR-2026-10', 'MER006', '2026-10', 'vas', 660490.22, 0.00, 330.25, 330.25, 59.45, 1),
  ('BL-MER007-2026-10-MDR', 'BR-2026-10', 'MER007', '2026-10', 'mdr', 275464.78, 0.02, 4820.63, 5356.26, 867.71, 1),
  ('BL-MER007-2026-10-PERTXN', 'BR-2026-10', 'MER007', '2026-10', 'per_txn', 89.00, 2.00, 178.00, 198.00, 32.04, 1),
  ('BL-MER007-2026-10-TERMINAL', 'BR-2026-10', 'MER007', '2026-10', 'terminal_rental', 1.00, 3600.00, 3600.00, 3600.00, 648.00, 1),
  ('BL-MER008-2026-10-MDR', 'BR-2026-10', 'MER008', '2026-10', 'mdr', 262246.84, 0.02, 3933.70, 3933.70, 708.07, 1),
  ('BL-MER008-2026-10-PERTXN', 'BR-2026-10', 'MER008', '2026-10', 'per_txn', 105.00, 2.00, 210.00, 210.00, 37.80, 1),
  ('BL-MER008-2026-10-TERMINAL', 'BR-2026-10', 'MER008', '2026-10', 'terminal_rental', 1.00, 2400.00, 2400.00, 2400.00, 432.00, 1),
  ('BL-MER009-2026-10-MDR', 'BR-2026-10', 'MER009', '2026-10', 'mdr', 16535.89, 0.02, 396.86, 396.86, 71.43, 1),
  ('BL-MER009-2026-10-PERTXN', 'BR-2026-10', 'MER009', '2026-10', 'per_txn', 77.00, 2.00, 154.00, 154.00, 27.72, 1),
  ('BL-MER009-2026-10-TERMINAL', 'BR-2026-10', 'MER009', '2026-10', 'terminal_rental', 1.00, 105.00, 105.00, 105.00, 18.90, 1),
  ('BL-MER009-2026-10-VAS', 'BR-2026-10', 'MER009', '2026-10', 'vas', 16535.89, 0.00, 8.27, 8.27, 1.49, 1),
  ('BL-MER010-2026-10-MDR', 'BR-2026-10', 'MER010', '2026-10', 'mdr', 424986.58, 0.02, 7012.28, 7012.28, 1262.21, 1),
  ('BL-MER010-2026-10-PERTXN', 'BR-2026-10', 'MER010', '2026-10', 'per_txn', 133.00, 2.00, 266.00, 266.00, 47.88, 1),
  ('BL-MER010-2026-10-TERMINAL', 'BR-2026-10', 'MER010', '2026-10', 'terminal_rental', 1.00, 3600.00, 3600.00, 3600.00, 648.00, 1);

INSERT INTO ra_fin_invoices (invoice_id, merchant_id, invoice_date, due_date, subtotal, gst_amount, total, status, billing_run_id, is_synthetic) VALUES
  ('INV-MER003-2026-09', 'MER003', '2026-09-30', '2026-10-15', 4200.00, 756.00, 4956.00, 'open', NULL, 1),
  ('INV-MER009-2026-08', 'MER009', '2026-08-31', '2026-09-15', 800.00, 144.00, 944.00, 'open', NULL, 1),
  ('INV-MER001-2026-10', 'MER001', '2026-10-31', '2026-11-15', 14313.77, 2576.48, 16890.25, 'open', 'BR-2026-10', 1),
  ('INV-MER002-2026-10', 'MER002', '2026-10-31', '2026-11-15', 13908.67, 2503.56, 16412.23, 'open', 'BR-2026-10', 1),
  ('INV-MER003-2026-10', 'MER003', '2026-10-31', '2026-11-15', 13391.29, 2410.43, 15801.72, 'open', 'BR-2026-10', 1),
  ('INV-MER004-2026-10', 'MER004', '2026-10-31', '2026-11-15', 14011.80, 1681.42, 15693.22, 'open', 'BR-2026-10', 1),
  ('INV-MER006-2026-10', 'MER006', '2026-10-31', '2026-11-15', 18764.05, 3377.53, 22141.58, 'open', 'BR-2026-10', 1),
  ('INV-MER007-2026-10', 'MER007', '2026-10-31', '2026-11-15', 8598.63, 1547.75, 10146.38, 'open', 'BR-2026-10', 1),
  ('INV-MER008-2026-10', 'MER008', '2026-10-31', '2026-11-15', 6543.70, 1177.87, 7721.57, 'open', 'BR-2026-10', 1),
  ('INV-MER009-2026-10', 'MER009', '2026-10-31', '2026-11-15', 664.13, 119.54, 783.67, 'open', 'BR-2026-10', 1),
  ('INV-MER010-2026-10', 'MER010', '2026-10-31', '2026-11-15', 10878.28, 1958.09, 12836.37, 'open', 'BR-2026-10', 1);

INSERT INTO ra_fin_invoice_lines (line_id, invoice_id, billing_line_id, description, amount, gst_rate, gst_amount) VALUES
  ('IL-MER003-2026-09-1', 'INV-MER003-2026-09', NULL, 'MDR Sep-26', 4200.00, 18.00, 756.00),
  ('IL-MER009-2026-08-1', 'INV-MER009-2026-08', NULL, 'MDR Aug-26', 800.00, 18.00, 144.00),
  ('IL-MER001-2026-10-1', 'INV-MER001-2026-10', NULL, 'Acquiring charges Oct-26', 14313.77, 18.00, 2576.48),
  ('IL-MER002-2026-10-1', 'INV-MER002-2026-10', NULL, 'Acquiring charges Oct-26', 13908.67, 18.00, 2503.56),
  ('IL-MER003-2026-10-1', 'INV-MER003-2026-10', NULL, 'Acquiring charges Oct-26', 13391.29, 18.00, 2410.43),
  ('IL-MER004-2026-10-1', 'INV-MER004-2026-10', NULL, 'Acquiring charges Oct-26', 14011.80, 12.00, 1681.42),
  ('IL-MER006-2026-10-1', 'INV-MER006-2026-10', NULL, 'Acquiring charges Oct-26', 18764.05, 18.00, 3377.53),
  ('IL-MER007-2026-10-1', 'INV-MER007-2026-10', NULL, 'Acquiring charges Oct-26', 8598.63, 18.00, 1547.75),
  ('IL-MER008-2026-10-1', 'INV-MER008-2026-10', NULL, 'Acquiring charges Oct-26', 6543.70, 18.00, 1177.87),
  ('IL-MER009-2026-10-1', 'INV-MER009-2026-10', NULL, 'Acquiring charges Oct-26', 664.13, 18.00, 119.54),
  ('IL-MER010-2026-10-1', 'INV-MER010-2026-10', NULL, 'Acquiring charges Oct-26', 10878.28, 18.00, 1958.09);

INSERT INTO ra_credit_notes (cn_id, invoice_id, merchant_id, amount, reason, ts, is_synthetic) VALUES
  ('CN-MER006-2026-10', 'INV-MER006-2026-10', 'MER006', 2000.00, 'VAS adjustment', '2026-11-05', 1);

INSERT INTO ra_cash_receipts (receipt_id, merchant_id, receipt_date, amount, method, source, is_synthetic) VALUES
  ('CASH-MER001-20261112', 'MER001', '2026-11-12', 16890.25, 'neft', 'bank', 1),
  ('CASH-MER002-20261116', 'MER002', '2026-11-16', 13129.78, 'neft', 'bank', 1),
  ('CASH-MER004-20261114', 'MER004', '2026-11-14', 15693.22, 'imps', 'bank', 1),
  ('CASH-MER006-20261118', 'MER006', '2026-11-18', 20141.58, 'neft', 'bank', 1),
  ('CASH-MER007-20261113', 'MER007', '2026-11-13', 10146.38, 'neft', 'bank', 1),
  ('CASH-MER008-20261110', 'MER008', '2026-11-10', 15000.00, 'neft', 'bank', 1),
  ('CASH-MER010-20261108', 'MER010', '2026-11-08', 12836.37, 'net_settlement', 'bank', 1);

INSERT INTO ra_cash_applications (app_id, receipt_id, invoice_id, applied_amount) VALUES
  ('APP-CASH-MER001-20261112', 'CASH-MER001-20261112', 'INV-MER001-2026-10', 16890.25),
  ('APP-CASH-MER002-20261116', 'CASH-MER002-20261116', 'INV-MER002-2026-10', 13129.78),
  ('APP-CASH-MER004-20261114', 'CASH-MER004-20261114', 'INV-MER004-2026-10', 15693.22),
  ('APP-CASH-MER006-20261118', 'CASH-MER006-20261118', 'INV-MER006-2026-10', 20141.58),
  ('APP-CASH-MER007-20261113', 'CASH-MER007-20261113', 'INV-MER007-2026-10', 10146.38),
  ('APP-CASH-MER010-20261108', 'CASH-MER010-20261108', 'INV-MER010-2026-10', 12836.37);

INSERT INTO ra_writeoffs (wo_id, invoice_id, merchant_id, amount, reason, ts, is_synthetic) VALUES
  ('WO-MER009-2026-08', 'INV-MER009-2026-08', 'MER009', 944.00, 'small balance write-off', '2026-11-01', 1);


INSERT INTO ra_vendor_invoices (vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst_amount, status, is_synthetic)
SELECT 'VIN-GW-2026-10', 'gateway', 'PAYGW', 'Payment Gateway', '2026-10', '2026-11-02', '2026-11-17',
       ROUND(SUM(expected),2), ROUND(SUM(invoiced),2), ROUND(SUM(invoiced)*0.18,2), 'open', 1
FROM ra_gateway_charges;

INSERT INTO ra_vendor_invoices (vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst_amount, status, is_synthetic)
SELECT 'VIN-NET-2026-10', 'network', 'SWITCH', 'Network / Switch', '2026-10', '2026-11-02', '2026-11-17',
       ROUND(SUM(expected),2), ROUND(SUM(invoiced),2), ROUND(SUM(invoiced)*0.18,2), 'open', 1
FROM ra_network_fees;

INSERT INTO ra_vendor_invoices (vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst_amount, status, is_synthetic)
SELECT 'VIN-PAR-2026-10', 'partner', 'PARTNERS', 'ISO / referral / platform', '2026-10', '2026-11-03', '2026-11-18',
       ROUND(SUM(expected),2), ROUND(SUM(invoiced),2), ROUND(SUM(invoiced)*0.18,2), 'open', 1
FROM ra_partner_fees;

INSERT INTO ra_vendor_invoices (vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst_amount, status, is_synthetic)
SELECT 'VIN-SCH-2026-10', 'scheme', 'SCHEMES', 'Visa/MC/RuPay/Amex fees', '2026-10', '2026-11-03', '2026-11-18',
       ROUND(SUM(interchange+scheme_fee),2),
       ROUND(SUM(interchange+scheme_fee)*1.03,2),
       ROUND(SUM(interchange+scheme_fee)*1.03*0.18,2),
       'open', 1
FROM ra_scheme_settlements;

INSERT INTO ra_vendor_invoices (vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst_amount, status, is_synthetic) VALUES
  ('VIN-SCH-2026-10-ADJ', 'scheme', 'VISA-MC-RUPAY', 'Scheme fee invoice (uplift)', '2026-10', '2026-11-03', '2026-11-18', 0, 12500.00, 2250.00, 'open', 1),
  ('VIN-FX-2026-10', 'fx', 'FXPRO', 'FX provider markup invoice', '2026-10', '2026-11-04', '2026-11-19', 2100.00, 2850.00, 513.00, 'open', 1);


INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-GW-2026-10', 'VIN-GW-2026-10', invoiced, '2026-11-09', 0, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-GW-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-NET-2026-10-A', 'VIN-NET-2026-10', invoiced, '2026-11-10', 0, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-NET-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-NET-2026-10-B', 'VIN-NET-2026-10', invoiced, '2026-11-11', 1, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-NET-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
VALUES ('VPAY-FX-2026-10', 'VIN-FX-2026-10', 2850.00, '2026-11-12', 0, 1);
-- VIN-SCH, VIN-SCH-ADJ, VIN-PAR left unpaid

INSERT INTO ra_gl_journals (journal_id, je_date, source_system, source_ref, posted, memo, is_synthetic) VALUES
  ('JE-2026-0001', '2026-09-30', 'invoicing', 'INV-MER003-2026-09', 1, 'Merchant invoice INV-MER003-2026-09', 1),
  ('JE-2026-0002', '2026-08-31', 'invoicing', 'INV-MER009-2026-08', 1, 'Merchant invoice INV-MER009-2026-08', 1),
  ('JE-2026-0003', '2026-10-31', 'invoicing', 'INV-MER001-2026-10', 1, 'Merchant invoice INV-MER001-2026-10', 1),
  ('JE-2026-0004', '2026-10-31', 'invoicing', 'INV-MER002-2026-10', 1, 'Merchant invoice INV-MER002-2026-10', 1),
  ('JE-2026-0005', '2026-10-31', 'invoicing', 'INV-MER003-2026-10', 1, 'Merchant invoice INV-MER003-2026-10', 1),
  ('JE-2026-0006', '2026-10-31', 'invoicing', 'INV-MER004-2026-10', 1, 'Misposted tax INV-MER004-2026-10', 1),
  ('JE-2026-0007', '2026-10-31', 'invoicing', 'INV-MER006-2026-10', 1, 'Merchant invoice INV-MER006-2026-10', 1),
  ('JE-2026-0008', '2026-10-31', 'invoicing', 'INV-MER007-2026-10', 0, 'Unposted AR INV-MER007-2026-10', 1),
  ('JE-2026-0009', '2026-10-31', 'invoicing', 'INV-MER008-2026-10', 1, 'Merchant invoice INV-MER008-2026-10', 1),
  ('JE-2026-0010', '2026-10-31', 'invoicing', 'INV-MER009-2026-10', 1, 'Merchant invoice INV-MER009-2026-10', 1),
  ('JE-2026-0011', '2026-10-31', 'invoicing', 'INV-MER010-2026-10', 1, 'Merchant invoice INV-MER010-2026-10', 1),
  ('JE-2026-0012', '2026-11-12', 'cash', 'CASH-MER001-20261112', 1, 'Cash receipt CASH-MER001-20261112', 1),
  ('JE-2026-0013', '2026-11-16', 'cash', 'CASH-MER002-20261116', 1, 'Cash receipt CASH-MER002-20261116', 1),
  ('JE-2026-0014', '2026-11-14', 'cash', 'CASH-MER004-20261114', 1, 'Cash receipt CASH-MER004-20261114', 1),
  ('JE-2026-0015', '2026-11-18', 'cash', 'CASH-MER006-20261118', 1, 'Cash receipt CASH-MER006-20261118', 1),
  ('JE-2026-0016', '2026-11-13', 'cash', 'CASH-MER007-20261113', 1, 'Cash receipt CASH-MER007-20261113', 1),
  ('JE-2026-0017', '2026-11-10', 'cash', 'CASH-MER008-20261110', 1, 'Cash receipt CASH-MER008-20261110', 1),
  ('JE-2026-0018', '2026-11-08', 'cash', 'CASH-MER010-20261108', 1, 'Cash receipt CASH-MER010-20261108', 1),
  ('JE-2026-0019', '2026-11-02', 'bank', 'SETTLE-2026-10', 1, 'Scheme net vs bank (misposted short)', 1),
  ('JE-2026-0020', '2026-11-06', 'payouts', 'PAYOUT-2026-10', 1, 'Merchant payouts Oct', 1),
  ('JE-2026-0021', '2026-11-04', 'vendor', 'VIN-SCH-2026-10-ADJ', 0, 'Unposted scheme invoice accrual', 1);

INSERT INTO ra_gl_lines (line_id, journal_id, account, debit, credit) VALUES
  ('JE-2026-0001-1', 'JE-2026-0001', '1100', 4956.00, 0.00),
  ('JE-2026-0001-2', 'JE-2026-0001', '4100', 0.00, 4200.00),
  ('JE-2026-0001-3', 'JE-2026-0001', '2100', 0.00, 756.00),
  ('JE-2026-0002-1', 'JE-2026-0002', '1100', 944.00, 0.00),
  ('JE-2026-0002-2', 'JE-2026-0002', '4100', 0.00, 800.00),
  ('JE-2026-0002-3', 'JE-2026-0002', '2100', 0.00, 144.00),
  ('JE-2026-0003-1', 'JE-2026-0003', '1100', 16890.25, 0.00),
  ('JE-2026-0003-2', 'JE-2026-0003', '4100', 0.00, 14313.77),
  ('JE-2026-0003-3', 'JE-2026-0003', '2100', 0.00, 2576.48),
  ('JE-2026-0004-1', 'JE-2026-0004', '1100', 16412.23, 0.00),
  ('JE-2026-0004-2', 'JE-2026-0004', '4100', 0.00, 13908.67),
  ('JE-2026-0004-3', 'JE-2026-0004', '2100', 0.00, 2503.56),
  ('JE-2026-0005-1', 'JE-2026-0005', '1100', 15801.72, 0.00),
  ('JE-2026-0005-2', 'JE-2026-0005', '4100', 0.00, 13391.29),
  ('JE-2026-0005-3', 'JE-2026-0005', '2100', 0.00, 2410.43),
  ('JE-2026-0006-1', 'JE-2026-0006', '1100', 15693.22, 0.00),
  ('JE-2026-0006-2', 'JE-2026-0006', '4100', 0.00, 15693.22),
  ('JE-2026-0006-3', 'JE-2026-0006', '2100', 0.00, 0.00),
  ('JE-2026-0007-1', 'JE-2026-0007', '1100', 22141.58, 0.00),
  ('JE-2026-0007-2', 'JE-2026-0007', '4100', 0.00, 18764.05),
  ('JE-2026-0007-3', 'JE-2026-0007', '2100', 0.00, 3377.53),
  ('JE-2026-0008-1', 'JE-2026-0008', '1100', 10146.38, 0.00),
  ('JE-2026-0008-2', 'JE-2026-0008', '4100', 0.00, 8598.63),
  ('JE-2026-0008-3', 'JE-2026-0008', '2100', 0.00, 1547.75),
  ('JE-2026-0009-1', 'JE-2026-0009', '1100', 7721.57, 0.00),
  ('JE-2026-0009-2', 'JE-2026-0009', '4100', 0.00, 6543.70),
  ('JE-2026-0009-3', 'JE-2026-0009', '2100', 0.00, 1177.87),
  ('JE-2026-0010-1', 'JE-2026-0010', '1100', 783.67, 0.00),
  ('JE-2026-0010-2', 'JE-2026-0010', '4100', 0.00, 664.13),
  ('JE-2026-0010-3', 'JE-2026-0010', '2100', 0.00, 119.54),
  ('JE-2026-0011-1', 'JE-2026-0011', '1100', 12836.37, 0.00),
  ('JE-2026-0011-2', 'JE-2026-0011', '4100', 0.00, 10878.28),
  ('JE-2026-0011-3', 'JE-2026-0011', '2100', 0.00, 1958.09),
  ('JE-2026-0012-1', 'JE-2026-0012', '1110', 16890.25, 0.00),
  ('JE-2026-0012-2', 'JE-2026-0012', '1100', 0.00, 16890.25),
  ('JE-2026-0012-3', 'JE-2026-0012', '2300', 0.00, 0.00),
  ('JE-2026-0013-1', 'JE-2026-0013', '1110', 13129.78, 0.00),
  ('JE-2026-0013-2', 'JE-2026-0013', '1100', 0.00, 13129.78),
  ('JE-2026-0013-3', 'JE-2026-0013', '2300', 0.00, 0.00),
  ('JE-2026-0014-1', 'JE-2026-0014', '1110', 15693.22, 0.00),
  ('JE-2026-0014-2', 'JE-2026-0014', '1100', 0.00, 15693.22),
  ('JE-2026-0014-3', 'JE-2026-0014', '2300', 0.00, 0.00),
  ('JE-2026-0015-1', 'JE-2026-0015', '1110', 20141.58, 0.00),
  ('JE-2026-0015-2', 'JE-2026-0015', '1100', 0.00, 20141.58),
  ('JE-2026-0015-3', 'JE-2026-0015', '2300', 0.00, 0.00),
  ('JE-2026-0016-1', 'JE-2026-0016', '1110', 10146.38, 0.00),
  ('JE-2026-0016-2', 'JE-2026-0016', '1100', 0.00, 10146.38),
  ('JE-2026-0016-3', 'JE-2026-0016', '2300', 0.00, 0.00),
  ('JE-2026-0017-1', 'JE-2026-0017', '1110', 15000.00, 0.00),
  ('JE-2026-0017-2', 'JE-2026-0017', '1100', 0.00, 0.00),
  ('JE-2026-0017-3', 'JE-2026-0017', '2300', 0.00, 15000.00),
  ('JE-2026-0018-1', 'JE-2026-0018', '1110', 12836.37, 0.00),
  ('JE-2026-0018-2', 'JE-2026-0018', '1100', 0.00, 12836.37),
  ('JE-2026-0018-3', 'JE-2026-0018', '2300', 0.00, 0.00),
  ('JE-2026-0019-1', 'JE-2026-0019', '1110', 4300000.00, 0.00),
  ('JE-2026-0019-2', 'JE-2026-0019', '1200', 0.00, 4300000.00),
  ('JE-2026-0020-1', 'JE-2026-0020', '6100', 4200000.00, 0.00),
  ('JE-2026-0020-2', 'JE-2026-0020', '1110', 0.00, 4200000.00),
  ('JE-2026-0021-1', 'JE-2026-0021', '4200', 12500.00, 0.00),
  ('JE-2026-0021-2', 'JE-2026-0021', '2200', 0.00, 12500.00);

INSERT INTO ra_disputes (dispute_id, cb_id, stage, amount, status, ts, merchant_id, is_synthetic) VALUES
  ('DSP-MAN-001', NULL, 'representment', 8500.00, 'open', '2026-10-22', 'MER003', 1);

INSERT INTO ra_fee_policies (id, topic, text) VALUES
  ('POL13', 'billing', 'Billing rating must apply the contracted MDR, per-txn fee, monthly minimum and VAS bps. Under-rating or unbilled usage is leakage.'),
  ('POL14', 'invoicing', 'Every billing run must be invoiced in the same period. Invoice rate and GST (18% in this synthetic India book) must match the billing subledger.'),
  ('POL15', 'cash_ar', 'Cash receipts must be applied to open invoices. Short-pays, unapplied cash, overdue AR and write-offs are exceptions.'),
  ('POL16', 'vendor', 'Vendor invoices (gateway, network, scheme, partner, FX) must match expected cost. Duplicate or unauthorised vendor payments are leakage.'),
  ('POL17', 'gl', 'Subledgers (AR, AP, bank, billing) must post to the GL. Unposted or misposted journals and settlement≠bank≠GL breaks must be cleared.'),
  ('POL18', 'hops', 'Adjacent hops (gateway↔switch↔clearing↔scheme, bank↔TRS↔GL) must match on recon_ref and amount.'),
  ('POL19', 'tax', 'GST on merchant and vendor invoices is 18% of taxable value in this synthetic set.'),
  ('POL20', 'synthetic', 'ALL DATA IN THIS DATABASE IS SYNTHETIC AND FOR DEMO ONLY. It is labelled is_synthetic=1.');
