-- 0035 Finance and hop reconciliation views (deterministic SQL)
-- Each view uses the shared exception column layout.

CREATE VIEW v_ra_contract_billing AS
SELECT
  b.line_id AS ref_id,
  'billing' AS area,
  CASE WHEN ROUND(b.amount,2) = ROUND(b.expected_amount,2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(b.amount,2) = ROUND(b.expected_amount,2) THEN 'rating_ok' ELSE 'contract_rating_mismatch' END AS category,
  b.merchant_id,
  b.period || '-01' AS ts,
  b.expected_amount AS expected_amount,
  b.amount AS actual_amount,
  ROUND(ABS(b.expected_amount - b.amount), 2) AS leakage,
  b.line_id AS recon_ref,
  b.charge_type AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_billing_lines b;

CREATE VIEW v_ra_usage_billing AS
SELECT
  c.merchant_id AS ref_id,
  'billing' AS area,
  CASE WHEN ROUND(x.billed_mdr,2) >= ROUND(x.expected_mdr,2) - 0.5 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN ROUND(x.billed_mdr,2) >= ROUND(x.expected_mdr,2) - 0.5 THEN 'usage_billed' ELSE 'unbilled_usage' END AS category,
  c.merchant_id,
  '2026-10-31' AS ts,
  x.expected_mdr AS expected_amount,
  x.billed_mdr AS actual_amount,
  ROUND(MAX(0, x.expected_mdr - x.billed_mdr), 2) AS leakage,
  c.merchant_id AS recon_ref,
  'mdr' AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_contracts c
JOIN (
  SELECT b.merchant_id,
         ROUND(SUM(CASE WHEN b.charge_type='mdr' THEN b.amount ELSE 0 END),2) AS billed_mdr,
         ROUND(SUM(CASE WHEN b.charge_type='mdr' THEN b.expected_amount ELSE 0 END),2) AS expected_mdr
  FROM ra_billing_lines b
  GROUP BY 1
) x ON x.merchant_id = c.merchant_id;

CREATE VIEW v_ra_billing_invoice AS
SELECT
  c.merchant_id AS ref_id,
  'invoicing' AS area,
  CASE WHEN i.invoice_id IS NULL THEN 'unmatched'
       WHEN ABS(ROUND(x.billed,2) - ROUND(i.subtotal,2)) > 0.5 THEN 'variance'
       ELSE 'matched' END AS status,
  CASE WHEN i.invoice_id IS NULL THEN 'billed_not_invoiced'
       WHEN ABS(ROUND(x.billed,2) - ROUND(i.subtotal,2)) > 0.5 THEN 'invoice_wrong_rate'
       ELSE 'invoice_ok' END AS category,
  c.merchant_id,
  '2026-10-31' AS ts,
  x.billed AS expected_amount,
  COALESCE(i.subtotal, 0) AS actual_amount,
  ROUND(ABS(x.billed - COALESCE(i.subtotal, 0)), 2) AS leakage,
  COALESCE(i.invoice_id, c.merchant_id) AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_contracts c
JOIN (
  SELECT merchant_id, ROUND(SUM(amount),2) AS billed
  FROM ra_billing_lines WHERE period='2026-10' GROUP BY 1
) x ON x.merchant_id = c.merchant_id
LEFT JOIN ra_fin_invoices i ON i.merchant_id = c.merchant_id AND i.billing_run_id = 'BR-2026-10';

CREATE VIEW v_ra_invoice_tax AS
SELECT
  i.invoice_id AS ref_id,
  'invoicing' AS area,
  CASE WHEN ABS(ROUND(i.gst_amount,2) - ROUND(i.subtotal * 0.18, 2)) <= 0.5 THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ABS(ROUND(i.gst_amount,2) - ROUND(i.subtotal * 0.18, 2)) <= 0.5 THEN 'gst_ok' ELSE 'gst_mismatch' END AS category,
  i.merchant_id,
  i.invoice_date AS ts,
  ROUND(i.subtotal * 0.18, 2) AS expected_amount,
  i.gst_amount AS actual_amount,
  ROUND(ABS(ROUND(i.subtotal * 0.18, 2) - i.gst_amount), 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_fin_invoices i;

CREATE VIEW v_ra_invoice_cash AS
SELECT
  i.invoice_id AS ref_id,
  'cash_ar' AS area,
  CASE
    WHEN COALESCE(w.wo, 0) >= ROUND(i.total - COALESCE(cn.cn,0), 2) - 0.5 THEN 'matched'
    WHEN COALESCE(p.paid, 0) + 0.5 >= ROUND(i.total - COALESCE(cn.cn,0), 2) THEN 'matched'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'variance'
    ELSE 'unmatched'
  END AS status,
  CASE
    WHEN COALESCE(w.wo, 0) >= ROUND(i.total - COALESCE(cn.cn,0), 2) - 0.5 THEN 'written_off'
    WHEN COALESCE(p.paid, 0) + 0.5 >= ROUND(i.total - COALESCE(cn.cn,0), 2) THEN 'paid'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'short_paid'
    WHEN i.due_date < '2026-11-21' THEN 'unpaid_overdue'
    ELSE 'unpaid_open'
  END AS category,
  i.merchant_id,
  i.due_date AS ts,
  ROUND(i.total - COALESCE(cn.cn,0), 2) AS expected_amount,
  ROUND(COALESCE(p.paid, 0) + COALESCE(w.wo, 0), 2) AS actual_amount,
  ROUND(MAX(0, i.total - COALESCE(cn.cn,0) - COALESCE(p.paid,0) - COALESCE(w.wo,0)), 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_fin_invoices i
LEFT JOIN (SELECT invoice_id, ROUND(SUM(amount),2) AS cn FROM ra_credit_notes GROUP BY 1) cn ON cn.invoice_id = i.invoice_id
LEFT JOIN (SELECT invoice_id, ROUND(SUM(applied_amount),2) AS paid FROM ra_cash_applications GROUP BY 1) p ON p.invoice_id = i.invoice_id
LEFT JOIN (SELECT invoice_id, ROUND(SUM(amount),2) AS wo FROM ra_writeoffs GROUP BY 1) w ON w.invoice_id = i.invoice_id;

CREATE VIEW v_ra_unapplied_cash AS
SELECT
  r.receipt_id AS ref_id,
  'cash_ar' AS area,
  CASE WHEN ROUND(r.amount - COALESCE(a.applied,0), 2) <= 0.5 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN ROUND(r.amount - COALESCE(a.applied,0), 2) <= 0.5 THEN 'applied' ELSE 'unapplied_cash' END AS category,
  r.merchant_id,
  r.receipt_date AS ts,
  r.amount AS expected_amount,
  COALESCE(a.applied, 0) AS actual_amount,
  ROUND(MAX(0, r.amount - COALESCE(a.applied,0)), 2) AS leakage,
  r.receipt_id AS recon_ref,
  r.method AS method, NULL AS scheme, 'INR' AS currency
FROM ra_cash_receipts r
LEFT JOIN (SELECT receipt_id, ROUND(SUM(applied_amount),2) AS applied FROM ra_cash_applications GROUP BY 1) a
  ON a.receipt_id = r.receipt_id;

CREATE VIEW v_ra_vendor_cost AS
SELECT
  v.vinvoice_id AS ref_id,
  'vendor' AS area,
  CASE WHEN ROUND(v.invoiced,2) = ROUND(v.expected,2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(v.invoiced,2) = ROUND(v.expected,2) THEN 'vendor_ok' ELSE 'vendor_overcharge' END AS category,
  NULL AS merchant_id,
  v.invoice_date AS ts,
  v.expected AS expected_amount,
  v.invoiced AS actual_amount,
  ROUND(ABS(v.invoiced - v.expected), 2) AS leakage,
  v.vinvoice_id AS recon_ref,
  v.vendor_type AS method, v.vendor_id AS scheme, 'INR' AS currency
FROM ra_vendor_invoices v;

CREATE VIEW v_ra_vendor_pay AS
SELECT
  v.vinvoice_id AS ref_id,
  'vendor' AS area,
  CASE
    WHEN COALESCE(p.dup, 0) > 0 THEN 'variance'
    WHEN COALESCE(p.paid, 0) + 0.5 >= v.invoiced THEN 'matched'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'variance'
    ELSE 'unmatched'
  END AS status,
  CASE
    WHEN COALESCE(p.dup, 0) > 0 THEN 'vendor_duplicate_payment'
    WHEN COALESCE(p.paid, 0) + 0.5 >= v.invoiced THEN 'vendor_paid'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'vendor_short_paid'
    ELSE 'vendor_unpaid'
  END AS category,
  NULL AS merchant_id,
  v.due_date AS ts,
  v.invoiced AS expected_amount,
  COALESCE(p.paid, 0) AS actual_amount,
  CASE
    WHEN COALESCE(p.dup, 0) > 0 THEN ROUND(p.paid - v.invoiced, 2)
    ELSE ROUND(MAX(0, v.invoiced - COALESCE(p.paid,0)), 2)
  END AS leakage,
  v.vinvoice_id AS recon_ref,
  v.vendor_type AS method, v.vendor_id AS scheme, 'INR' AS currency
FROM ra_vendor_invoices v
LEFT JOIN (
  SELECT vinvoice_id, ROUND(SUM(amount),2) AS paid, SUM(is_duplicate) AS dup
  FROM ra_vendor_payments GROUP BY 1
) p ON p.vinvoice_id = v.vinvoice_id;

CREATE VIEW v_ra_gl_unposted AS
SELECT
  j.journal_id AS ref_id,
  'gl' AS area,
  CASE WHEN j.posted = 1 THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN j.posted = 1 THEN 'posted' ELSE 'gl_unposted' END AS category,
  NULL AS merchant_id,
  j.je_date AS ts,
  ROUND(COALESCE((SELECT SUM(debit) FROM ra_gl_lines l WHERE l.journal_id = j.journal_id),0),2) AS expected_amount,
  CASE WHEN j.posted = 1 THEN ROUND(COALESCE((SELECT SUM(debit) FROM ra_gl_lines l WHERE l.journal_id = j.journal_id),0),2) ELSE 0 END AS actual_amount,
  CASE WHEN j.posted = 1 THEN 0 ELSE ROUND(COALESCE((SELECT SUM(debit) FROM ra_gl_lines l WHERE l.journal_id = j.journal_id),0),2) END AS leakage,
  j.source_ref AS recon_ref,
  j.source_system AS method, NULL AS scheme, 'INR' AS currency
FROM ra_gl_journals j;

CREATE VIEW v_ra_gl_invoice AS
SELECT
  i.invoice_id AS ref_id,
  'gl' AS area,
  CASE
    WHEN j.journal_id IS NULL THEN 'unmatched'
    WHEN j.posted = 0 THEN 'unmatched'
    WHEN ABS(ROUND(COALESCE(rev.credit,0),2) - ROUND(i.subtotal,2)) > 0.5 THEN 'variance'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN j.journal_id IS NULL THEN 'gl_unposted'
    WHEN j.posted = 0 THEN 'gl_unposted'
    WHEN ABS(ROUND(COALESCE(rev.credit,0),2) - ROUND(i.subtotal,2)) > 0.5 THEN 'gl_misposted'
    ELSE 'gl_ok'
  END AS category,
  i.merchant_id,
  i.invoice_date AS ts,
  i.subtotal AS expected_amount,
  COALESCE(rev.credit, 0) AS actual_amount,
  ROUND(ABS(i.subtotal - COALESCE(rev.credit,0)), 2) AS leakage,
  i.invoice_id AS recon_ref,
  'invoicing' AS method, NULL AS scheme, 'INR' AS currency
FROM ra_fin_invoices i
LEFT JOIN ra_gl_journals j ON j.source_ref = i.invoice_id AND j.source_system = 'invoicing'
LEFT JOIN (
  SELECT journal_id, ROUND(SUM(credit),2) AS credit FROM ra_gl_lines WHERE account = '4100' GROUP BY 1
) rev ON rev.journal_id = j.journal_id;

CREATE VIEW v_ra_gateway_switch AS
SELECT
  g.log_id AS ref_id,
  'hops' AS area,
  CASE WHEN s.switch_id IS NULL THEN 'unmatched'
       WHEN ROUND(g.amount,2) != ROUND(s.amount,2) THEN 'variance'
       ELSE 'matched' END AS status,
  CASE WHEN s.switch_id IS NULL THEN 'gateway_missing_in_switch'
       WHEN ROUND(g.amount,2) != ROUND(s.amount,2) THEN 'gateway_switch_mismatch'
       ELSE 'hop_ok' END AS category,
  g.merchant_id,
  g.ts,
  g.amount AS expected_amount,
  COALESCE(s.amount, 0) AS actual_amount,
  CASE WHEN s.switch_id IS NULL THEN g.amount ELSE ROUND(ABS(g.amount - s.amount),2) END AS leakage,
  g.gateway_ref AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_gateway_logs g
LEFT JOIN ra_switch_logs s ON s.auth_id = g.auth_id;

CREATE VIEW v_ra_switch_orphan AS
SELECT
  s.switch_id AS ref_id,
  'hops' AS area,
  'unmatched' AS status,
  'switch_without_gateway' AS category,
  NULL AS merchant_id,
  s.ts,
  s.amount AS expected_amount,
  0 AS actual_amount,
  s.amount AS leakage,
  s.rrn AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_switch_logs s
LEFT JOIN ra_gateway_logs g ON g.auth_id = s.auth_id
WHERE g.log_id IS NULL;

CREATE VIEW v_ra_switch_clearing AS
SELECT
  s.switch_id AS ref_id,
  'hops' AS area,
  CASE
    WHEN g.status = 'declined' THEN 'matched'
    WHEN a.auth_id IS NULL THEN 'matched'
    WHEN clr.rec_id IS NULL THEN 'unmatched'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN g.status = 'declined' THEN 'declined_no_clearing'
    WHEN a.auth_id IS NULL THEN 'no_capture'
    WHEN clr.rec_id IS NULL THEN 'switch_missing_in_clearing'
    ELSE 'cleared'
  END AS category,
  g.merchant_id,
  s.ts,
  s.amount AS expected_amount,
  COALESCE(clr.gross, 0) AS actual_amount,
  CASE WHEN g.status = 'declined' OR a.auth_id IS NULL THEN 0
       WHEN clr.rec_id IS NULL THEN s.amount ELSE 0 END AS leakage,
  s.rrn AS recon_ref,
  NULL AS method, clr.scheme AS scheme, 'INR' AS currency
FROM ra_switch_logs s
LEFT JOIN ra_gateway_logs g ON g.auth_id = s.auth_id
LEFT JOIN ra_captures a ON a.auth_id = s.auth_id
LEFT JOIN ra_clearing_records clr ON clr.capture_id = a.capture_id;

CREATE VIEW v_ra_bank_trs AS
SELECT
  l.line_id AS ref_id,
  'hops' AS area,
  CASE WHEN t.trs_id IS NULL THEN 'unmatched' ELSE 'matched' END AS status,
  CASE WHEN t.trs_id IS NULL THEN 'bank_missing_in_trs' ELSE 'trs_ok' END AS category,
  NULL AS merchant_id,
  l.value_date AS ts,
  l.amount AS expected_amount,
  COALESCE(t.amount, 0) AS actual_amount,
  CASE WHEN t.trs_id IS NULL THEN ABS(l.amount) ELSE 0 END AS leakage,
  l.recon_ref AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_bank_statement_lines l
LEFT JOIN ra_trs_entries t ON t.bank_txn_id = l.bank_txn_id;

CREATE VIEW v_ra_ar_ageing AS
SELECT
  i.invoice_id AS ref_id,
  'cash_ar' AS area,
  CASE
    WHEN ROUND(i.total - COALESCE(cn.cn,0) - COALESCE(p.paid,0) - COALESCE(w.wo,0), 2) <= 0.5 THEN 'matched'
    WHEN CAST(julianday('2026-11-21') - julianday(i.due_date) AS INTEGER) > 30 THEN 'unmatched'
    ELSE 'variance'
  END AS status,
  CASE
    WHEN ROUND(i.total - COALESCE(cn.cn,0) - COALESCE(p.paid,0) - COALESCE(w.wo,0), 2) <= 0.5 THEN 'current_or_settled'
    WHEN CAST(julianday('2026-11-21') - julianday(i.due_date) AS INTEGER) <= 0 THEN 'ar_current'
    WHEN CAST(julianday('2026-11-21') - julianday(i.due_date) AS INTEGER) <= 30 THEN 'ar_1_30'
    WHEN CAST(julianday('2026-11-21') - julianday(i.due_date) AS INTEGER) <= 60 THEN 'ar_31_60'
    WHEN CAST(julianday('2026-11-21') - julianday(i.due_date) AS INTEGER) <= 90 THEN 'ar_61_90'
    ELSE 'ar_90_plus'
  END AS category,
  i.merchant_id,
  i.due_date AS ts,
  ROUND(i.total - COALESCE(cn.cn,0), 2) AS expected_amount,
  ROUND(COALESCE(p.paid,0) + COALESCE(w.wo,0), 2) AS actual_amount,
  ROUND(MAX(0, i.total - COALESCE(cn.cn,0) - COALESCE(p.paid,0) - COALESCE(w.wo,0)), 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL AS method, NULL AS scheme, 'INR' AS currency
FROM ra_fin_invoices i
LEFT JOIN (SELECT invoice_id, ROUND(SUM(amount),2) AS cn FROM ra_credit_notes GROUP BY 1) cn ON cn.invoice_id = i.invoice_id
LEFT JOIN (SELECT invoice_id, ROUND(SUM(applied_amount),2) AS paid FROM ra_cash_applications GROUP BY 1) p ON p.invoice_id = i.invoice_id
LEFT JOIN (SELECT invoice_id, ROUND(SUM(amount),2) AS wo FROM ra_writeoffs GROUP BY 1) w ON w.invoice_id = i.invoice_id;
