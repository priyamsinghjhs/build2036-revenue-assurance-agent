#!/usr/bin/env python3
"""Synthetic billing, invoicing, cash/AR, vendor, GL, and hop-source tables.

Ties to the existing October 2026 book (seed=2036). Deterministic. All rows is_synthetic=1.
Writes migrations 0033–0036 under cloudflare/migrations/.
"""
from __future__ import annotations

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "migrations"
AS_OF = "2026-11-21"
GST = 0.18

# Captured book from remote D1 (existing seed).
MERCHANTS = [
    # mid, name, mdr_bps, captures, volume, active_rental, monthly_min, vas_bps
    ("MER001", "PayStreet Retail", 180, 209, 643485.53, 3600.0, 8000.0, 0),
    ("MER002", "QuickMart Grocery", 160, 227, 661669.40, 3600.0, 3000.0, 0),
    ("MER003", "TravelNow", 220, 129, 370368.75, 4800.0, 3000.0, 5),
    ("MER004", "CafeCloud", 190, 157, 468305.48, 4800.0, 3000.0, 0),
    ("MER005", "ElectroHub", 170, 185, 636144.66, 3600.0, 3000.0, 0),
    ("MER006", "RideGo", 200, 212, 660490.22, 4800.0, 8000.0, 5),
    ("MER007", "BookHive", 175, 99, 306071.98, 3600.0, 3000.0, 0),
    ("MER008", "MediCare Plus", 150, 105, 262246.84, 2400.0, 3000.0, 0),
    ("MER009", "HotelAzure", 240, 77, 16535.89, 105.0, 500.0, 5),
    ("MER010", "EduPay", 165, 133, 424986.58, 3600.0, 3000.0, 0),
]

PER_TXN = 2.00


def r2(n: float) -> float:
    return round(n + 1e-9, 2)


def sql_str(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if isinstance(v, float):
            return f"{r2(v):.2f}"
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def values(rows: list[tuple]) -> str:
    lines = []
    for i, row in enumerate(rows):
        line = "  (" + ", ".join(sql_str(c) for c in row) + ")"
        line += "," if i < len(rows) - 1 else ";"
        lines.append(line)
    return "\n".join(lines)


def contract_expected(m):
    mid, name, mdr, txns, vol, rental, monthly_min, vas = m
    mdr_amt = r2(vol * mdr / 10000.0)
    per_txn = r2(txns * PER_TXN)
    vas_amt = r2(vol * vas / 10000.0)
    base = r2(mdr_amt + per_txn + vas_amt)
    min_top = r2(max(0.0, monthly_min - (mdr_amt + per_txn)))
    return {
        "mdr": mdr_amt,
        "per_txn": per_txn,
        "rental": rental,
        "vas": vas_amt,
        "min_top": min_top,
        "subtotal": r2(mdr_amt + per_txn + vas_amt + rental + min_top),
    }


def main() -> None:
    billing_lines = []
    invoices = []
    invoice_lines = []
    credit_notes = []
    receipts = []
    applications = []
    writeoffs = []
    billed_sub = {}  # mid -> subtotal actually billed
    open_balance = {}

    for m in MERCHANTS:
        mid, name, mdr, txns, vol, rental, monthly_min, vas = m
        exp = contract_expected(m)
        usage_vol, usage_txns, usage_mdr_bps = vol, txns, mdr
        # Injected rating breaks
        if mid == "MER001":
            usage_mdr_bps = 160  # under-rated vs contract 180
        if mid == "MER007":
            usage_vol = r2(vol * 0.90)  # unbilled 10% usage
            usage_txns = 89

        billed_mdr = r2(usage_vol * usage_mdr_bps / 10000.0)
        billed_txn = r2(usage_txns * PER_TXN)
        billed_vas = r2(usage_vol * vas / 10000.0)
        billed_min = r2(max(0.0, monthly_min - (billed_mdr + billed_txn)))
        parts = [
            ("mdr", usage_vol, usage_mdr_bps / 10000.0, billed_mdr, exp["mdr"]),
            ("per_txn", float(usage_txns), PER_TXN, billed_txn, exp["per_txn"]),
            ("terminal_rental", 1.0, rental, rental, exp["rental"]),
            ("monthly_min", 1.0, billed_min, billed_min, exp["min_top"]),
            ("vas", usage_vol, vas / 10000.0, billed_vas, exp["vas"]),
        ]
        sub = 0.0
        for typ, qty, rate, amt, _exp in parts:
            if amt == 0 and typ in ("monthly_min", "vas"):
                continue
            lid = f"BL-{mid}-2026-10-{typ.upper().replace('_', '')[:8]}"
            billing_lines.append((lid, "BR-2026-10", mid, "2026-10", typ, r2(qty), r2(rate), r2(amt), r2(_exp), r2(amt * GST), 1))
            sub = r2(sub + amt)
        billed_sub[mid] = sub

    # --- Invoices (skip MER005 billed-not-invoiced). Wrong GST on MER004. Short MDR on MER002. ---
    # Prior-period unpaid for ageing
    invoices.append(("INV-MER003-2026-09", "MER003", "2026-09-30", "2026-10-15", 4200.00, r2(4200 * GST), r2(4200 * 1.18), "open", None, 1))
    invoice_lines.append(("IL-MER003-2026-09-1", "INV-MER003-2026-09", None, "MDR Sep-26", 4200.00, 18.0, r2(4200 * GST)))
    invoices.append(("INV-MER009-2026-08", "MER009", "2026-08-31", "2026-09-15", 800.00, r2(800 * GST), r2(800 * 1.18), "open", None, 1))
    invoice_lines.append(("IL-MER009-2026-08-1", "INV-MER009-2026-08", None, "MDR Aug-26", 800.00, 18.0, r2(800 * GST)))
    open_balance["INV-MER003-2026-09"] = r2(4200 * 1.18)
    open_balance["INV-MER009-2026-08"] = r2(800 * 1.18)

    # open_balance already initialised

    for m in MERCHANTS:
        mid = m[0]
        if mid == "MER005":
            continue  # billed, not invoiced
        sub = billed_sub[mid]
        gst_rate = 12.0 if mid == "MER004" else 18.0
        # MER002: invoice MDR short ~5%
        invoice_sub = sub
        if mid == "MER002":
            invoice_sub = r2(sub * 0.95)
        gst_amt = r2(invoice_sub * gst_rate / 100.0)
        total = r2(invoice_sub + gst_amt)
        inv_id = f"INV-{mid}-2026-10"
        invoices.append((inv_id, mid, "2026-10-31", "2026-11-15", invoice_sub, gst_amt, total, "open", "BR-2026-10", 1))
        invoice_lines.append((f"IL-{mid}-2026-10-1", inv_id, None, "Acquiring charges Oct-26", invoice_sub, gst_rate, gst_amt))
        open_balance[inv_id] = total

    # Credit note MER006
    credit_notes.append(("CN-MER006-2026-10", "INV-MER006-2026-10", "MER006", 2000.00, "VAS adjustment", "2026-11-05", 1))
    open_balance["INV-MER006-2026-10"] = r2(open_balance["INV-MER006-2026-10"] - 2000.00)

    # Cash application
    def pay(mid, inv_id, amount, date, method, apply=True, unapplied=0.0):
        rid = f"CASH-{mid}-{date.replace('-', '')}"
        receipts.append((rid, mid, date, r2(amount), method, "bank", 1))
        if apply and inv_id:
            applications.append((f"APP-{rid}", rid, inv_id, r2(amount - unapplied)))
            open_balance[inv_id] = r2(open_balance[inv_id] - (amount - unapplied))
        return rid

    pay("MER001", "INV-MER001-2026-10", open_balance["INV-MER001-2026-10"], "2026-11-12", "neft", True)
    # MER002 short-pay 80%
    due2 = open_balance["INV-MER002-2026-10"]
    pay("MER002", "INV-MER002-2026-10", r2(due2 * 0.80), "2026-11-16", "neft", True)
    # MER003 Oct + Sep unpaid — no receipt
    # MER004 pays in full (despite tax error)
    pay("MER004", "INV-MER004-2026-10", open_balance["INV-MER004-2026-10"], "2026-11-14", "imps", True)
    # MER006 pays net after credit note
    pay("MER006", "INV-MER006-2026-10", open_balance["INV-MER006-2026-10"], "2026-11-18", "neft", True)
    # MER007 paid in full
    pay("MER007", "INV-MER007-2026-10", open_balance["INV-MER007-2026-10"], "2026-11-13", "neft", True)
    # MER008 unapplied cash (no invoice application)
    receipts.append(("CASH-MER008-20261110", "MER008", "2026-11-10", 15000.00, "neft", "bank", 1))
    # MER008 also leaves Oct invoice unpaid
    # MER009 write-off remainder of Aug invoice; Oct unpaid
    writeoffs.append(("WO-MER009-2026-08", "INV-MER009-2026-08", "MER009", open_balance["INV-MER009-2026-08"], "small balance write-off", "2026-11-01", 1))
    open_balance["INV-MER009-2026-08"] = 0.0
    # MER010 paid via net-settlement deduction
    pay("MER010", "INV-MER010-2026-10", open_balance["INV-MER010-2026-10"], "2026-11-08", "net_settlement", True)

    # Vendor invoices & payments (amounts are also derived in SQL for expected; seed carries explicit invoices)
    # Expected figures filled later by INSERT SELECT; here we add adjustment invoices + payments.
    vendor_invoices = [
        # vinvoice_id, vendor_type, vendor_id, vendor_name, period, invoice_date, due_date, expected, invoiced, gst, status
        ("VIN-SCH-2026-10-ADJ", "scheme", "VISA-MC-RUPAY", "Scheme fee invoice (uplift)", "2026-10", "2026-11-03", "2026-11-18", 0, 12500.00, r2(12500 * GST), "open"),
        ("VIN-FX-2026-10", "fx", "FXPRO", "FX provider markup invoice", "2026-10", "2026-11-04", "2026-11-19", 2100.00, 2850.00, r2(2850 * GST), "open"),
    ]
    vendor_payments = [
        # payment_id, vinvoice_id, amount, payment_date, is_duplicate
        ("VPAY-NET-2026-10-A", "VIN-NET-2026-10", 0, "2026-11-10", 0),  # amount filled in SQL from invoice
        ("VPAY-NET-2026-10-B", "VIN-NET-2026-10", 0, "2026-11-11", 1),  # duplicate
        ("VPAY-GW-2026-10", "VIN-GW-2026-10", 0, "2026-11-09", 0),
        ("VPAY-FX-2026-10", "VIN-FX-2026-10", 2850.00, "2026-11-12", 0),
        # scheme adj and partner left unpaid
    ]

    # GL journals
    journals = []
    gl_lines = []
    jid = 0

    def je(date, source, ref, posted, memo, lines):
        nonlocal jid
        jid += 1
        j = f"JE-2026-{jid:04d}"
        journals.append((j, date, source, ref, posted, memo, 1))
        for i, (acct, debit, credit) in enumerate(lines, 1):
            gl_lines.append((f"{j}-{i}", j, acct, r2(debit), r2(credit)))
        return j

    # Revenue recognition per invoiced merchant (skip unposted for MER007)
    for inv in invoices:
        inv_id, mid, idate, due, sub, gst_amt, total, status, run, _ = inv
        if mid == "MER007":
            je(idate, "invoicing", inv_id, 0, f"Unposted AR {inv_id}", [
                ("1100", total, 0),
                ("4100", 0, sub),
                ("2100", 0, gst_amt),
            ])
        elif mid == "MER004":
            # misposted: GST booked to revenue
            je(idate, "invoicing", inv_id, 1, f"Misposted tax {inv_id}", [
                ("1100", total, 0),
                ("4100", 0, total),
                ("2100", 0, 0),
            ])
        else:
            je(idate, "invoicing", inv_id, 1, f"Merchant invoice {inv_id}", [
                ("1100", total, 0),
                ("4100", 0, sub),
                ("2100", 0, gst_amt),
            ])

    for rec in receipts:
        rid, mid, rdate, amt, method, src, _ = rec
        je(rdate, "cash", rid, 1, f"Cash receipt {rid}", [
            ("1110", amt, 0),
            ("1100", 0, amt if mid != "MER008" else 0),
            ("2300", 0, amt if mid == "MER008" else 0),  # unapplied clearing
        ])

    # Bank / settlement / payout control JEs — one deliberately breaks vs bank
    je("2026-11-02", "bank", "SETTLE-2026-10", 1, "Scheme net vs bank (misposted short)", [
        ("1110", 4_300_000.00, 0),
        ("1200", 0, 4_300_000.00),
    ])
    je("2026-11-06", "payouts", "PAYOUT-2026-10", 1, "Merchant payouts Oct", [
        ("6100", 4_200_000.00, 0),
        ("1110", 0, 4_200_000.00),
    ])
    # Unposted vendor accrual
    je("2026-11-04", "vendor", "VIN-SCH-2026-10-ADJ", 0, "Unposted scheme invoice accrual", [
        ("4200", 12500.00, 0),
        ("2200", 0, 12500.00),
    ])

    # Disputes from a few open chargebacks — created via SQL INSERT SELECT plus extras
    disputes_extra = [
        ("DSP-MAN-001", None, "representment", 8500.00, "open", "2026-10-22", "MER003", 1),
    ]

    policies = [
        ("POL13", "billing", "Billing rating must apply the contracted MDR, per-txn fee, monthly minimum and VAS bps. Under-rating or unbilled usage is leakage."),
        ("POL14", "invoicing", "Every billing run must be invoiced in the same period. Invoice rate and GST (18% in this synthetic India book) must match the billing subledger."),
        ("POL15", "cash_ar", "Cash receipts must be applied to open invoices. Short-pays, unapplied cash, overdue AR and write-offs are exceptions."),
        ("POL16", "vendor", "Vendor invoices (gateway, network, scheme, partner, FX) must match expected cost. Duplicate or unauthorised vendor payments are leakage."),
        ("POL17", "gl", "Subledgers (AR, AP, bank, billing) must post to the GL. Unposted or misposted journals and settlement≠bank≠GL breaks must be cleared."),
        ("POL18", "hops", "Adjacent hops (gateway↔switch↔clearing↔scheme, bank↔TRS↔GL) must match on recon_ref and amount."),
        ("POL19", "tax", "GST on merchant and vendor invoices is 18% of taxable value in this synthetic set."),
        ("POL20", "synthetic", "ALL DATA IN THIS DATABASE IS SYNTHETIC AND FOR DEMO ONLY. It is labelled is_synthetic=1."),
    ]

    schema = r'''-- 0033 Finance hops + billing/invoicing/cash/GL schema (SYNTHETIC)
-- Source tables for every acquiring-firm system hop. Copies from the existing book plus new finance systems.

CREATE TABLE IF NOT EXISTS ra_contracts (
  contract_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  plan_name TEXT,
  mdr_bps INTEGER,
  per_txn_fee REAL,
  monthly_min REAL,
  terminal_rental REAL,
  vas_bps INTEGER,
  gst_pct REAL,
  start_date TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_tms_terminals (
  tms_id TEXT PRIMARY KEY,
  terminal_id TEXT,
  merchant_id TEXT,
  status TEXT,
  monthly_rental REAL,
  last_seen TEXT,
  source TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gateway_logs (
  log_id TEXT PRIMARY KEY,
  auth_id TEXT,
  merchant_id TEXT,
  ts TEXT,
  amount REAL,
  status TEXT,
  gateway_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_switch_logs (
  switch_id TEXT PRIMARY KEY,
  auth_id TEXT,
  ts TEXT,
  response_code TEXT,
  amount REAL,
  rrn TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_clearing_records (
  rec_id TEXT PRIMARY KEY,
  file_id TEXT,
  scheme TEXT,
  clearing_date TEXT,
  capture_id TEXT,
  gross REAL,
  interchange REAL,
  scheme_fee REAL,
  net REAL,
  direction TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_bank_statements (
  statement_id TEXT PRIMARY KEY,
  account_no TEXT,
  statement_date TEXT,
  opening REAL,
  closing REAL,
  format TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_bank_statement_lines (
  line_id TEXT PRIMARY KEY,
  statement_id TEXT,
  bank_txn_id TEXT,
  value_date TEXT,
  amount REAL,
  narrative TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_trs_entries (
  trs_id TEXT PRIMARY KEY,
  value_date TEXT,
  amount REAL,
  entry_type TEXT,
  recon_ref TEXT,
  bank_txn_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fx_rates (
  rate_id TEXT PRIMARY KEY,
  ts TEXT,
  pair TEXT,
  mid_rate REAL,
  provider TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_billing_runs (
  run_id TEXT PRIMARY KEY,
  period TEXT,
  run_ts TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_billing_lines (
  line_id TEXT PRIMARY KEY,
  run_id TEXT,
  merchant_id TEXT,
  period TEXT,
  charge_type TEXT,
  usage_qty REAL,
  rate REAL,
  amount REAL,
  expected_amount REAL,
  gst_amount REAL,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fin_invoices (
  invoice_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  invoice_date TEXT,
  due_date TEXT,
  subtotal REAL,
  gst_amount REAL,
  total REAL,
  status TEXT,
  billing_run_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_fin_invoice_lines (
  line_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  billing_line_id TEXT,
  description TEXT,
  amount REAL,
  gst_rate REAL,
  gst_amount REAL
);

CREATE TABLE IF NOT EXISTS ra_credit_notes (
  cn_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  merchant_id TEXT,
  amount REAL,
  reason TEXT,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_cash_receipts (
  receipt_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  receipt_date TEXT,
  amount REAL,
  method TEXT,
  source TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_cash_applications (
  app_id TEXT PRIMARY KEY,
  receipt_id TEXT,
  invoice_id TEXT,
  applied_amount REAL
);

CREATE TABLE IF NOT EXISTS ra_writeoffs (
  wo_id TEXT PRIMARY KEY,
  invoice_id TEXT,
  merchant_id TEXT,
  amount REAL,
  reason TEXT,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_vendor_invoices (
  vinvoice_id TEXT PRIMARY KEY,
  vendor_type TEXT,
  vendor_id TEXT,
  vendor_name TEXT,
  period TEXT,
  invoice_date TEXT,
  due_date TEXT,
  expected REAL,
  invoiced REAL,
  gst_amount REAL,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_vendor_payments (
  payment_id TEXT PRIMARY KEY,
  vinvoice_id TEXT,
  amount REAL,
  payment_date TEXT,
  is_duplicate INTEGER DEFAULT 0,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gl_journals (
  journal_id TEXT PRIMARY KEY,
  je_date TEXT,
  source_system TEXT,
  source_ref TEXT,
  posted INTEGER,
  memo TEXT,
  is_synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ra_gl_lines (
  line_id TEXT PRIMARY KEY,
  journal_id TEXT,
  account TEXT,
  debit REAL,
  credit REAL
);

CREATE TABLE IF NOT EXISTS ra_disputes (
  dispute_id TEXT PRIMARY KEY,
  cb_id TEXT,
  stage TEXT,
  amount REAL,
  status TEXT,
  ts TEXT,
  merchant_id TEXT,
  is_synthetic INTEGER DEFAULT 1
);

-- Hop copies from the existing book
INSERT INTO ra_tms_terminals (tms_id, terminal_id, merchant_id, status, monthly_rental, last_seen, source, is_synthetic)
SELECT 'TMS-' || terminal_id, terminal_id, merchant_id, status, monthly_rental, installed_on, 'tms', 1
FROM ra_terminals;

INSERT INTO ra_gateway_logs (log_id, auth_id, merchant_id, ts, amount, status, gateway_ref, is_synthetic)
SELECT 'GW-' || auth_id, auth_id, merchant_id, ts, amount, status, recon_ref, 1
FROM ra_authorizations;

INSERT INTO ra_switch_logs (switch_id, auth_id, ts, response_code, amount, rrn, is_synthetic)
SELECT 'SW-' || auth_id, auth_id, ts,
       CASE WHEN status IN ('approved','captured') THEN '00' WHEN status = 'declined' THEN '05' ELSE '96' END,
       amount, recon_ref, 1
FROM ra_authorizations;

INSERT INTO ra_clearing_records (rec_id, file_id, scheme, clearing_date, capture_id, gross, interchange, scheme_fee, net, direction, recon_ref, is_synthetic)
SELECT 'CLR-' || s.scheme_id,
       'IPM-' || s.scheme || '-' || REPLACE(s.settlement_date, '-', ''),
       s.scheme, s.settlement_date, s.capture_id, s.gross, s.interchange, s.scheme_fee, s.net,
       'incoming', s.recon_ref, 1
FROM ra_scheme_settlements s;

INSERT INTO ra_bank_statements (statement_id, account_no, statement_date, opening, closing, format, is_synthetic)
VALUES ('STMT-2026-10-MT940', '000123456789', '2026-10-31', 2500000.00, 0, 'MT940', 1),
       ('STMT-2026-11-CAMT', '000123456789', '2026-11-15', 0, 0, 'CAMT.053', 1);

INSERT INTO ra_bank_statement_lines (line_id, statement_id, bank_txn_id, value_date, amount, narrative, recon_ref, is_synthetic)
SELECT 'SL-' || bank_txn_id,
       CASE WHEN value_date < '2026-11-01' THEN 'STMT-2026-10-MT940' ELSE 'STMT-2026-11-CAMT' END,
       bank_txn_id, value_date, amount, narrative, recon_ref, 1
FROM ra_bank_transactions;

INSERT INTO ra_trs_entries (trs_id, value_date, amount, entry_type, recon_ref, bank_txn_id, is_synthetic)
SELECT 'TRS-' || bank_txn_id, value_date, amount,
       CASE WHEN amount >= 0 THEN 'credit' ELSE 'debit' END,
       recon_ref, bank_txn_id, 1
FROM ra_bank_transactions;

INSERT INTO ra_fx_rates (rate_id, ts, pair, mid_rate, provider, is_synthetic)
SELECT 'FXR-' || from_ccy || to_ccy || '-' || SUBSTR(ts, 1, 10),
       SUBSTR(ts, 1, 10), from_ccy || '/' || to_ccy, AVG(reference_rate), 'FXPRO', 1
FROM ra_fx_conversions
GROUP BY 1, 2, 3;

INSERT INTO ra_disputes (dispute_id, cb_id, stage, amount, status, ts, merchant_id, is_synthetic)
SELECT 'DSP-' || cb.cb_id, cb.cb_id,
       CASE WHEN cb.recovered >= cb.amount THEN 'closed' ELSE 'chargeback' END,
       cb.amount,
       CASE WHEN cb.recovered >= cb.amount THEN 'closed' ELSE 'open' END,
       cb.ts, a.merchant_id, 1
FROM ra_chargebacks cb
JOIN ra_captures c ON c.capture_id = cb.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id;

-- Inject hop breaks (deterministic)
DELETE FROM ra_switch_logs WHERE auth_id IN (
  SELECT auth_id FROM ra_authorizations WHERE status = 'approved' ORDER BY auth_id LIMIT 4
);
DELETE FROM ra_clearing_records WHERE rec_id IN (
  SELECT rec_id FROM ra_clearing_records ORDER BY rec_id LIMIT 3
);
DELETE FROM ra_trs_entries WHERE trs_id IN (
  SELECT trs_id FROM ra_trs_entries ORDER BY trs_id LIMIT 3
);

-- Phantom switch log with no gateway (unidentified switch)
INSERT INTO ra_switch_logs (switch_id, auth_id, ts, response_code, amount, rrn, is_synthetic)
VALUES ('SW-ORPHAN-001', 'AUTH-ORPHAN-001', '2026-10-18T09:15:00', '00', 18750.00, 'RRN-ORPHAN', 1);

INSERT INTO ra_billing_runs (run_id, period, run_ts, status, is_synthetic)
VALUES ('BR-2026-10', '2026-10', '2026-11-01T02:00:00', 'posted', 1);
'''

    seed = [
        "-- 0034 Finance seed: contracts, billing, invoices, cash, vendor, GL (SYNTHETIC)\n",
        "INSERT INTO ra_contracts (contract_id, merchant_id, plan_name, mdr_bps, per_txn_fee, monthly_min, terminal_rental, vas_bps, gst_pct, start_date, status, is_synthetic) VALUES\n",
    ]
    contracts = []
    for m in MERCHANTS:
        mid, name, mdr, txns, vol, rental, monthly_min, vas = m
        plan = "Enterprise" if monthly_min >= 8000 else "Standard"
        contracts.append((f"CTR-{mid}", mid, f"{plan} {mdr}bps", mdr, PER_TXN, monthly_min, rental, vas, 18.0, "2026-04-01", "active", 1))
    seed.append(values(contracts) + "\n\n")

    seed.append("INSERT INTO ra_billing_lines (line_id, run_id, merchant_id, period, charge_type, usage_qty, rate, amount, expected_amount, gst_amount, is_synthetic) VALUES\n")
    seed.append(values(billing_lines) + "\n\n")

    seed.append("INSERT INTO ra_fin_invoices (invoice_id, merchant_id, invoice_date, due_date, subtotal, gst_amount, total, status, billing_run_id, is_synthetic) VALUES\n")
    seed.append(values(invoices) + "\n\n")

    seed.append("INSERT INTO ra_fin_invoice_lines (line_id, invoice_id, billing_line_id, description, amount, gst_rate, gst_amount) VALUES\n")
    seed.append(values(invoice_lines) + "\n\n")

    seed.append("INSERT INTO ra_credit_notes (cn_id, invoice_id, merchant_id, amount, reason, ts, is_synthetic) VALUES\n")
    seed.append(values(credit_notes) + "\n\n")

    seed.append("INSERT INTO ra_cash_receipts (receipt_id, merchant_id, receipt_date, amount, method, source, is_synthetic) VALUES\n")
    seed.append(values(receipts) + "\n\n")

    seed.append("INSERT INTO ra_cash_applications (app_id, receipt_id, invoice_id, applied_amount) VALUES\n")
    seed.append(values(applications) + "\n\n")

    seed.append("INSERT INTO ra_writeoffs (wo_id, invoice_id, merchant_id, amount, reason, ts, is_synthetic) VALUES\n")
    seed.append(values(writeoffs) + "\n\n")

    # Vendor invoices from existing fee tables + explicit extras
    seed.append("""
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
""")
    seed.append(values([(*row, 1) for row in vendor_invoices]) + "\n\n")

    seed.append("""
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-GW-2026-10', 'VIN-GW-2026-10', invoiced, '2026-11-09', 0, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-GW-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-NET-2026-10-A', 'VIN-NET-2026-10', invoiced, '2026-11-10', 0, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-NET-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
SELECT 'VPAY-NET-2026-10-B', 'VIN-NET-2026-10', invoiced, '2026-11-11', 1, 1 FROM ra_vendor_invoices WHERE vinvoice_id='VIN-NET-2026-10';
INSERT INTO ra_vendor_payments (payment_id, vinvoice_id, amount, payment_date, is_duplicate, is_synthetic)
VALUES ('VPAY-FX-2026-10', 'VIN-FX-2026-10', 2850.00, '2026-11-12', 0, 1);
-- VIN-SCH, VIN-SCH-ADJ, VIN-PAR left unpaid
""")

    seed.append("\nINSERT INTO ra_gl_journals (journal_id, je_date, source_system, source_ref, posted, memo, is_synthetic) VALUES\n")
    seed.append(values(journals) + "\n\n")
    seed.append("INSERT INTO ra_gl_lines (line_id, journal_id, account, debit, credit) VALUES\n")
    seed.append(values(gl_lines) + "\n\n")

    seed.append("INSERT INTO ra_disputes (dispute_id, cb_id, stage, amount, status, ts, merchant_id, is_synthetic) VALUES\n")
    seed.append(values(disputes_extra) + "\n\n")

    seed.append("INSERT INTO ra_fee_policies (id, topic, text) VALUES\n")
    seed.append(values(policies) + "\n")

    views = r'''-- 0035 Finance and hop reconciliation views (deterministic SQL)
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
'''

    mat = r'''-- 0036 Materialize new finance/hop exceptions into ra_exception_rows (cheap dashboard reads)

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
'''

    (OUT / "0033_finance_schema.sql").write_text(schema)
    (OUT / "0034_finance_seed.sql").write_text("".join(seed))
    (OUT / "0035_finance_views.sql").write_text(views)
    (OUT / "0036_finance_exceptions.sql").write_text(mat)
    for p in sorted(OUT.glob("003*.sql")):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
