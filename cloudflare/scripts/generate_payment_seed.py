#!/usr/bin/env python3
"""Deterministic synthetic payment-acquiring dataset + recon views for D1.

All rows are labelled synthetic. Seed is fixed (2036) so regeneration is stable.
"""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "migrations" / "0002_payment_lifecycle.sql"
RNG = random.Random(2036)
START = date(2026, 10, 1)
DAYS = 30  # through 2026-10-30


def sql_str(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def money(n: float) -> str:
    return f"{n:.2f}"


def insert(table: str, cols: list[str], rows: list[tuple]) -> str:
    if not rows:
        return f"-- no rows for {table}\n"
    lines = [f"INSERT INTO {table} ({', '.join(cols)}) VALUES"]
    chunks = []
    for row in rows:
        parts = []
        for v in row:
            if v is None:
                parts.append("NULL")
            elif isinstance(v, bool):
                parts.append("1" if v else "0")
            elif isinstance(v, int) and not isinstance(v, bool):
                parts.append(str(v))
            elif isinstance(v, float):
                parts.append(money(v))
            else:
                parts.append(sql_str(v))
        chunks.append("  (" + ", ".join(parts) + ")")
    # SQLite/D1 can take large inserts; batch to keep statements reasonable
    out = []
    for i in range(0, len(chunks), 80):
        out.append(lines[0] + "\n" + ",\n".join(chunks[i:i + 80]) + ";")
    return "\n".join(out) + "\n"


MERCHANTS = [
    ("MER001", "PayStreet Retail", "5411", "IN", "INR", 180, 2, "retail"),
    ("MER002", "QuickMart Grocery", "5411", "IN", "INR", 160, 2, "grocery"),
    ("MER003", "TravelNow", "4722", "IN", "INR", 220, 3, "travel"),
    ("MER004", "CafeCloud", "5812", "IN", "INR", 190, 2, "hospitality"),
    ("MER005", "ElectroHub", "5732", "IN", "INR", 170, 2, "electronics"),
    ("MER006", "RideGo", "4121", "IN", "INR", 200, 1, "mobility"),
    ("MER007", "BookHive", "5942", "IN", "INR", 175, 2, "retail"),
    ("MER008", "MediCare Plus", "8011", "IN", "INR", 150, 2, "healthcare"),
    ("MER009", "HotelAzure", "7011", "AE", "USD", 240, 3, "hospitality"),
    ("MER010", "EduPay", "8220", "IN", "INR", 165, 2, "education"),
]

PARTNERS = [
    ("PAR001", "ISO Alpha", "iso", 25),
    ("PAR002", "Referral Beta", "referral", 12),
    ("PAR003", "ISO Gamma", "iso", 20),
    ("PAR004", "Platform Delta", "platform", 15),
    ("PAR005", "Agent Epsilon", "referral", 8),
]

SCHEMES_CARD = ["VISA", "MASTERCARD", "RUPAY", "AMEX"]
APM_METHODS = [
    ("upi", "UPI", "NPCI"),
    ("wallet", "PAYTM", "Paytm"),
    ("wallet", "PHONEPE", "PhonePe"),
    ("bnpl", "LAZYPAY", "LazyPay"),
    ("netbanking", "NETBANKING", "BankNet"),
    ("a2a", "IMPS", "NPCI"),
]

# Interchange + scheme fee bps approximations (synthetic)
SCHEME_COST_BPS = {
    "VISA": (80, 12),
    "MASTERCARD": (85, 12),
    "RUPAY": (40, 8),
    "AMEX": (140, 18),
    "UPI": (0, 0),
    "PAYTM": (0, 0),
    "PHONEPE": (0, 0),
    "LAZYPAY": (0, 0),
    "NETBANKING": (0, 0),
    "IMPS": (0, 0),
}

GATEWAY_BPS = 8
NETWORK_BPS = 6  # additional network/switch fee for cards
FX_REF = {("USD", "INR"): 83.40, ("EUR", "INR"): 90.10, ("AED", "INR"): 22.70}
AGREED_FX_MARKUP_BPS = 40


def main() -> None:
    merchants = []
    partners = []
    terminals = []
    auths = []
    captures = []
    schemes = []
    network_fees = []
    gateway_fees = []
    partner_fee_rows = []
    terminal_bills = []
    bank_txns = []
    apm_reports = []
    fx_rows = []
    invoices = []
    chargebacks = []
    refunds = []
    payouts = []
    reserves = []
    policies = []

    for m in MERCHANTS:
        merchants.append(m + (1,))  # is_synthetic
    for p in PARTNERS:
        partners.append(p + (1,))

    # 36 terminals: 3-4 per merchant; some idle/retired for billing leakage
    tid = 0
    terminal_status_plan = {}
    for i, mer in enumerate(MERCHANTS):
        mid = mer[0]
        n = 4 if i < 6 else 3
        for j in range(n):
            tid += 1
            term_id = f"POS{tid:04d}"
            if j == 0 and mid in {"MER005", "MER008"}:
                status = "retired"
            elif j == 3 and mid in {"MER001", "MER002"}:
                status = "idle"
            else:
                status = "active"
            rental = 1200.0 if mer[3] == "IN" else 35.0
            installed = (START - timedelta(days=90 + j * 10)).isoformat()
            terminals.append((term_id, mid, status, rental, installed, 1))
            terminal_status_plan[term_id] = (mid, status, rental)

    # Volume per merchant per day
    def volume_for(mid: str, day: date) -> int:
        base = {"MER001": 8, "MER002": 9, "MER003": 5, "MER004": 6, "MER005": 7,
                "MER006": 8, "MER007": 4, "MER008": 4, "MER009": 3, "MER010": 5}[mid]
        weekend = 1 if day.weekday() >= 5 else 0
        return max(1, base - weekend + RNG.randint(-1, 1))

    merchant_terms = {mid: [t[0] for t in terminals if t[1] == mid] for mid, *_ in [(m[0],) for m in MERCHANTS]}
    for m in MERCHANTS:
        merchant_terms[m[0]] = [t[0] for t in terminals if t[1] == m[0]]

    auth_n = 0
    cap_n = 0
    sch_n = 0
    bank_n = 0
    fee_n = 0
    fx_n = 0
    apm_n = 0
    cb_n = 0
    rf_n = 0

    # Track refs for recon and injected breaks
    approved_auth_ids: list[str] = []
    captured: dict[str, str] = {}  # auth_id -> capture_id
    scheme_by_capture: dict[str, str] = {}
    bank_refs = set()
    merchant_volume: dict[str, float] = {m[0]: 0.0 for m in MERCHANTS}
    merchant_expected_mdr: dict[str, float] = {m[0]: 0.0 for m in MERCHANTS}
    merchant_net: dict[str, float] = {m[0]: 0.0 for m in MERCHANTS}
    partner_expected: dict[str, float] = {p[0]: 0.0 for p in PARTNERS}
    daily_scheme_net: dict[str, float] = {}  # date -> net
    apm_actual: dict[tuple, float] = {}  # (date, provider, method) -> amount

    # Pre-pick leakage indices after we know counts — inject while generating with counters
    inject = {
        "expired_auth": 8,
        "auth_cap_mismatch": 6,
        "missing_scheme": 7,
        "scheme_fee_wrong": 6,
        "missing_bank": 5,
        "unidentified_bank": 4,
        "fx_bad": 6,
        "apm_mismatch": 6,
        "chargeback_open": 4,
        "refund_double": 3,
    }
    leftover = {k: v for k, v in inject.items()}

    def maybe(kind: str) -> bool:
        if leftover.get(kind, 0) <= 0:
            return False
        # sprinkle through the month; later days more likely if still remaining
        leftover[kind] -= 1
        return True

    all_days = [START + timedelta(days=i) for i in range(DAYS)]

    # First pass counts roughly 600 auths; we inject first N of each type when conditions match
    for day in all_days:
        for mer in MERCHANTS:
            mid, name, mcc, country, ccy, mdr_bps, delay, segment = mer
            n = volume_for(mid, day)
            terms = merchant_terms[mid]
            for _k in range(n):
                auth_n += 1
                auth_id = f"AUTH{auth_n:05d}"
                hour = RNG.randint(8, 22)
                minute = RNG.randint(0, 59)
                ts = datetime(day.year, day.month, day.day, hour, minute, RNG.randint(0, 59))
                # method mix
                roll = RNG.random()
                if mid == "MER006" and roll < 0.45:
                    method, scheme, provider = "upi", "UPI", "NPCI"
                elif mid == "MER003" and roll < 0.2:
                    method, scheme, provider = "card", RNG.choice(SCHEMES_CARD), None
                elif roll < 0.55:
                    method, scheme, provider = "card", RNG.choice(SCHEMES_CARD), None
                else:
                    method, scheme, provider = RNG.choice(APM_METHODS)
                amount = round(RNG.choice([199, 249, 399, 499, 799, 999, 1499, 2499, 4999, 7999, 12999]) * RNG.uniform(0.6, 1.4), 2)
                if ccy == "USD":
                    amount = round(RNG.uniform(40, 380), 2)
                status = "declined" if RNG.random() < 0.08 else "approved"
                partner_id = RNG.choice(PARTNERS)[0]
                term = RNG.choice(terms)
                recon_ref = f"REF{day.strftime('%Y%m%d')}-{auth_n:05d}"
                auths.append((auth_id, mid, term, partner_id, ts.strftime("%Y-%m-%d %H:%M:%S"),
                              amount, ccy, method, scheme, status, recon_ref, 1))
                if status != "approved":
                    continue
                approved_auth_ids.append(auth_id)
                merchant_volume[mid] += amount
                merchant_expected_mdr[mid] += round(amount * mdr_bps / 10000.0, 2)

                # expired / never captured
                if leftover["expired_auth"] and RNG.random() < 0.04:
                    leftover["expired_auth"] -= 1
                    continue

                cap_n += 1
                cap_id = f"CAP{cap_n:05d}"
                cap_amount = amount
                if leftover["auth_cap_mismatch"] and RNG.random() < 0.03:
                    leftover["auth_cap_mismatch"] -= 1
                    cap_amount = round(amount * RNG.choice([0.92, 1.08, 0.85, 1.12]), 2)
                cap_ts = ts + timedelta(hours=RNG.randint(0, 36))
                captures.append((cap_id, auth_id, cap_ts.strftime("%Y-%m-%d %H:%M:%S"), cap_amount, recon_ref, 1))
                captured[auth_id] = cap_id

                # missing scheme settlement
                if leftover["missing_scheme"] and method == "card" and RNG.random() < 0.04:
                    leftover["missing_scheme"] -= 1
                    continue

                sch_n += 1
                sch_id = f"SCH{sch_n:05d}"
                ix_bps, sf_bps = SCHEME_COST_BPS.get(scheme, (50, 10))
                interchange = round(cap_amount * ix_bps / 10000.0, 2)
                scheme_fee = round(cap_amount * sf_bps / 10000.0, 2)
                if leftover["scheme_fee_wrong"] and method == "card" and RNG.random() < 0.04:
                    leftover["scheme_fee_wrong"] -= 1
                    # apply wrong (too-high) scheme cost — leakage vs expected
                    interchange = round(interchange * 1.35, 2)
                    scheme_fee = round(scheme_fee * 1.5, 2)
                net = round(cap_amount - interchange - scheme_fee, 2)
                settle_day = (cap_ts.date() + timedelta(days=delay)).isoformat()
                schemes.append((sch_id, cap_id, scheme, settle_day, cap_amount, interchange, scheme_fee, net, recon_ref, 1))
                scheme_by_capture[cap_id] = sch_id
                daily_scheme_net[settle_day] = daily_scheme_net.get(settle_day, 0.0) + net
                merchant_net[mid] += net

                # fees expected vs invoiced
                if method == "card":
                    fee_n += 1
                    exp_net = round(cap_amount * NETWORK_BPS / 10000.0, 2)
                    inv_net = exp_net
                    if RNG.random() < 0.04:
                        inv_net = round(exp_net * RNG.choice([1.25, 1.4, 0.0]), 2)
                    network_fees.append((f"NWF{fee_n:05d}", recon_ref, "switch", exp_net, inv_net, 1))
                    exp_gw = round(cap_amount * GATEWAY_BPS / 10000.0, 2)
                    inv_gw = exp_gw
                    if RNG.random() < 0.04:
                        inv_gw = round(exp_gw * RNG.choice([1.3, 1.5, 0.0]), 2)
                    gateway_fees.append((f"GWF{fee_n:05d}", recon_ref, exp_gw, inv_gw, 1))
                    partner_expected[partner_id] += round(cap_amount * dict(p[:2] + (p[2],) for p in [(x[0], x[2], x[3]) for x in PARTNERS])[partner_id] / 10000.0 if False else 0, 2)

                # partner expected accrual
                share_bps = next(p[3] for p in PARTNERS if p[0] == partner_id)
                partner_expected[partner_id] += round(cap_amount * share_bps / 10000.0, 2)

                # APM actuals
                if method != "card":
                    key = (settle_day, provider or scheme, method)
                    apm_actual[key] = apm_actual.get(key, 0.0) + cap_amount

                # Bank / TRS — most scheme nets appear as credits
                skip_bank = leftover["missing_bank"] and RNG.random() < 0.03
                if skip_bank:
                    leftover["missing_bank"] -= 1
                else:
                    bank_n += 1
                    bank_id = f"TRS{bank_n:05d}"
                    bank_txns.append((bank_id, f"TRS-{settle_day}-{bank_n:05d}", settle_day, net, ccy,
                                      f"SCHEME {scheme} {recon_ref} SYNTHETIC", recon_ref, 1))
                    bank_refs.add(recon_ref)

                # FX conversions for foreign currency or travel merchant
                if ccy != "INR" or (mid == "MER003" and RNG.random() < 0.15):
                    fx_n += 1
                    pair = ("USD", "INR") if ccy == "USD" else (("EUR", "INR") if RNG.random() < 0.3 else ("USD", "INR"))
                    ref_rate = FX_REF[pair]
                    markup = AGREED_FX_MARKUP_BPS
                    applied = ref_rate * (1 + markup / 10000.0)
                    if leftover["fx_bad"] and RNG.random() < 0.25:
                        leftover["fx_bad"] -= 1
                        applied = ref_rate * (1 + RNG.choice([80, 120, 180]) / 10000.0)
                    fx_amt = cap_amount if ccy != "INR" else round(cap_amount / ref_rate, 2)
                    fx_rows.append((f"FX{fx_n:04d}", cap_ts.strftime("%Y-%m-%d %H:%M:%S"),
                                    pair[0], pair[1], fx_amt, round(applied, 4), ref_rate, AGREED_FX_MARKUP_BPS,
                                    recon_ref, 1))

                # Chargebacks / refunds (sparse)
                if method == "card" and RNG.random() < 0.015:
                    cb_n += 1
                    recovered = 0.0 if leftover["chargeback_open"] and leftover["chargeback_open"] > 0 else cap_amount
                    if recovered == 0.0 and leftover["chargeback_open"]:
                        leftover["chargeback_open"] -= 1
                    chargebacks.append((f"CB{cb_n:04d}", cap_id, cap_amount, RNG.choice(["fraud", "not_received", "duplicate", "quality"]),
                                        recovered, (cap_ts.date() + timedelta(days=RNG.randint(8, 20))).isoformat(), 1))
                if RNG.random() < 0.02:
                    rf_n += 1
                    double = 1 if leftover["refund_double"] and leftover["refund_double"] > 0 else 0
                    if double and leftover["refund_double"]:
                        leftover["refund_double"] -= 1
                    refunds.append((f"RFD{rf_n:04d}", cap_id, cap_amount if double else round(cap_amount * RNG.uniform(0.3, 1.0), 2),
                                    (cap_ts.date() + timedelta(days=RNG.randint(1, 6))).isoformat(), double, 1))

    # Unidentified bank credits (no recon_ref match)
    for i in range(inject["unidentified_bank"]):
        leftover["unidentified_bank"] = max(0, leftover.get("unidentified_bank", 0) - 1)
        bank_n += 1
        d = (START + timedelta(days=5 + i * 6)).isoformat()
        bank_txns.append((f"TRS{bank_n:05d}", f"TRS-UNID-{i+1:02d}", d, round(RNG.uniform(2500, 18000), 2), "INR",
                          f"UNIDENTIFIED CREDIT SYNTHETIC {i+1}", None, 1))

    # APM provider reports — match most days, inject mismatches
    mismatch_budget = leftover["apm_mismatch"]
    for (d, provider, method), amt in sorted(apm_actual.items()):
        apm_n += 1
        reported = amt
        if mismatch_budget and RNG.random() < 0.08:
            mismatch_budget -= 1
            leftover["apm_mismatch"] = mismatch_budget
            reported = round(amt * RNG.choice([0.0, 0.85, 1.12]), 2)
        apm_reports.append((f"APM{apm_n:04d}", provider, method, d, reported, f"APM-{d}-{provider}", 1))

    # Partner fee invoices by partner (period = 2026-10)
    for p in PARTNERS:
        pid, name, typ, bps = p
        expected = round(partner_expected[pid], 2)
        invoiced = expected
        if pid in {"PAR001", "PAR003"}:
            invoiced = round(expected * 0.82, 2)  # under-remitted / under-invoiced leakage
        if pid == "PAR002":
            invoiced = round(expected * 1.0, 2)
        partner_fee_rows.append((f"PFE-{pid}-2026-10", pid, "2026-10", expected, invoiced, 1))

    # Terminal billing for October: bill actives correctly; inject retired billed + active unbilled
    retired_billed = 0
    active_unbilled = 0
    for term_id, (mid, status, rental) in terminal_status_plan.items():
        if status == "retired" and retired_billed < 4:
            terminal_bills.append((f"TB-{term_id}-2026-10", term_id, "2026-10", rental, 1))
            retired_billed += 1
            continue
        if status == "active" and active_unbilled < 4 and mid in {"MER006", "MER010", "MER004", "MER007"}:
            active_unbilled += 1
            continue  # should have been billed
        if status == "active":
            terminal_bills.append((f"TB-{term_id}-2026-10", term_id, "2026-10", rental, 1))
        # idle: correctly not billed

    # Merchant invoices — most correct, 5 with MDR variance
    variance_merchants = {"MER001", "MER003", "MER005", "MER009", "MER006"}
    for mer in MERCHANTS:
        mid, *_, mdr_bps, delay, segment = mer
        vol = merchant_volume[mid]
        expected = round(merchant_expected_mdr[mid], 2)
        billed = expected
        if mid in variance_merchants:
            billed = round(expected * RNG.choice([0.88, 0.91, 1.14, 0.8, 1.2]), 2)
        invoices.append((f"INV-{mid}-2026-10", mid, "2026-10", round(vol, 2), billed, expected, 1))

    # Payouts vs net settlement (minus open chargebacks/reserves)
    # Reserves first
    for mid, amt in [("MER003", 25000.0), ("MER009", 800.0), ("MER005", 12000.0), ("MER001", 8000.0)]:
        status = "overdue" if mid in {"MER003", "MER005"} else "held"
        held = (START + timedelta(days=3)).isoformat()
        release = (START + timedelta(days=5 if status == "overdue" else 40)).isoformat()
        reserves.append((f"RSV-{mid}", mid, amt, held, release, status, 1))

    reserve_amt = {r[1]: r[2] for r in reserves}
    for mer in MERCHANTS:
        mid = mer[0]
        expected_net = round(merchant_net[mid] - reserve_amt.get(mid, 0.0), 2)
        paid = expected_net
        if mid in {"MER002", "MER004", "MER007", "MER010"}:
            paid = round(expected_net * 0.97, 2)  # under-payout
        if mid in {"MER008"}:
            paid = round(expected_net * 1.03, 2)  # over-payout
        payouts.append((f"PAY-{mid}-2026-10", mid, "2026-10-31", paid, expected_net, 1))

    policies = [
        ("POL01", "authorization", "Approved authorizations must be captured within 7 days or they expire. Capture amount must equal the approved auth amount. Declined auths never capture."),
        ("POL02", "scheme", "Card captures settle with Visa/Mastercard/RuPay/Amex on T+1 to T+3. Net = gross - interchange - scheme fees per published (synthetic) tables."),
        ("POL03", "bank_trs", "Treasury TRS bank credits must match scheme net by recon_ref and value date. Unidentified credits require manual allocation."),
        ("POL04", "fees", "Gateway charge is 8 bps of captured volume. Network/switch fee is 6 bps for cards. Invoices must match expected bps."),
        ("POL05", "partner", "ISO/referral partners earn a contracted share (8–25 bps). Under-invoiced share is revenue leakage to the acquirer partnership."),
        ("POL06", "terminal", "POS rental is billed monthly only for active terminals. Billing a retired device or missing an active device is leakage."),
        ("POL07", "fx", "Agreed FX markup is 40 bps over the mid/reference rate. Applied rates above the cap are leakage. USD/INR, EUR/INR, AED/INR in this synthetic set."),
        ("POL08", "apm", "UPI, wallets, BNPL, net banking and A2A/IMPS settle T+1 vs provider reports. Provider amount must match captured APM volume."),
        ("POL09", "pricing", "Merchant MDR is billed at contracted bps on captured volume. Variances vs contract must be re-billed or refunded."),
        ("POL10", "payouts", "Merchant payout = scheme/APM net - reserves - unrecovered chargebacks. Under- or over-payout is a recon break."),
        ("POL11", "chargebacks", "Chargebacks should be recovered from the merchant. Unrecovered chargebacks and double-counted refunds are leakage."),
        ("POL12", "synthetic", "ALL DATA IN THIS DATABASE IS SYNTHETIC AND FOR DEMO ONLY. It is labelled is_synthetic=1."),
    ]

    # Schema + views
    ddl = r'''
-- 0002 Payment-acquiring revenue assurance (SYNTHETIC, seed=2036)
-- Deterministic data + SQL recon views. Agents reason over summaries, not raw matching.

DROP VIEW IF EXISTS v_ra_exceptions;
DROP VIEW IF EXISTS v_ra_flow;
DROP VIEW IF EXISTS v_ra_auth_capture;
DROP VIEW IF EXISTS v_ra_capture_scheme;
DROP VIEW IF EXISTS v_ra_scheme_bank;
DROP VIEW IF EXISTS v_ra_fee_gateway;
DROP VIEW IF EXISTS v_ra_fee_network;
DROP VIEW IF EXISTS v_ra_fee_partner;
DROP VIEW IF EXISTS v_ra_terminal_recon;
DROP VIEW IF EXISTS v_ra_fx;
DROP VIEW IF EXISTS v_ra_apm;
DROP VIEW IF EXISTS v_ra_pricing;
DROP VIEW IF EXISTS v_ra_payouts;
DROP VIEW IF EXISTS v_ra_chargebacks;

DROP TABLE IF EXISTS ra_agent_outputs;
DROP TABLE IF EXISTS ra_action_queue;
DROP TABLE IF EXISTS ra_agent_runs;
DROP TABLE IF EXISTS ra_fee_policies;
DROP TABLE IF EXISTS ra_reserves;
DROP TABLE IF EXISTS ra_payouts;
DROP TABLE IF EXISTS ra_refunds;
DROP TABLE IF EXISTS ra_chargebacks;
DROP TABLE IF EXISTS ra_merchant_invoices;
DROP TABLE IF EXISTS ra_fx_conversions;
DROP TABLE IF EXISTS ra_apm_reports;
DROP TABLE IF EXISTS ra_bank_transactions;
DROP TABLE IF EXISTS ra_terminal_billing;
DROP TABLE IF EXISTS ra_partner_fees;
DROP TABLE IF EXISTS ra_gateway_charges;
DROP TABLE IF EXISTS ra_network_fees;
DROP TABLE IF EXISTS ra_scheme_settlements;
DROP TABLE IF EXISTS ra_captures;
DROP TABLE IF EXISTS ra_authorizations;
DROP TABLE IF EXISTS ra_terminals;
DROP TABLE IF EXISTS ra_partners;
DROP TABLE IF EXISTS ra_merchants;

CREATE TABLE ra_merchants (
  merchant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mcc TEXT,
  country TEXT,
  currency TEXT,
  mdr_bps INTEGER,
  settlement_delay_days INTEGER,
  segment TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_partners (
  partner_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  share_bps INTEGER,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_terminals (
  terminal_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  status TEXT,
  monthly_rental REAL,
  installed_on TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_authorizations (
  auth_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  terminal_id TEXT,
  partner_id TEXT,
  ts TEXT,
  amount REAL,
  currency TEXT,
  method TEXT,
  scheme TEXT,
  status TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_captures (
  capture_id TEXT PRIMARY KEY,
  auth_id TEXT,
  ts TEXT,
  amount REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_scheme_settlements (
  scheme_id TEXT PRIMARY KEY,
  capture_id TEXT,
  scheme TEXT,
  settlement_date TEXT,
  gross REAL,
  interchange REAL,
  scheme_fee REAL,
  net REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_network_fees (
  fee_id TEXT PRIMARY KEY,
  recon_ref TEXT,
  fee_type TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_gateway_charges (
  fee_id TEXT PRIMARY KEY,
  recon_ref TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_partner_fees (
  fee_id TEXT PRIMARY KEY,
  partner_id TEXT,
  period TEXT,
  expected REAL,
  invoiced REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_terminal_billing (
  bill_id TEXT PRIMARY KEY,
  terminal_id TEXT,
  period TEXT,
  billed REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_bank_transactions (
  bank_txn_id TEXT PRIMARY KEY,
  trs_ref TEXT,
  value_date TEXT,
  amount REAL,
  currency TEXT,
  narrative TEXT,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_apm_reports (
  report_id TEXT PRIMARY KEY,
  provider TEXT,
  method TEXT,
  report_date TEXT,
  amount REAL,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_fx_conversions (
  fx_id TEXT PRIMARY KEY,
  ts TEXT,
  from_ccy TEXT,
  to_ccy TEXT,
  amount REAL,
  applied_rate REAL,
  reference_rate REAL,
  agreed_markup_bps INTEGER,
  recon_ref TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_merchant_invoices (
  invoice_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  period TEXT,
  volume REAL,
  mdr_billed REAL,
  mdr_expected REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_chargebacks (
  cb_id TEXT PRIMARY KEY,
  capture_id TEXT,
  amount REAL,
  reason TEXT,
  recovered REAL,
  ts TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_refunds (
  refund_id TEXT PRIMARY KEY,
  capture_id TEXT,
  amount REAL,
  ts TEXT,
  double_counted INTEGER,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_payouts (
  payout_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  payout_date TEXT,
  amount REAL,
  expected_net REAL,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_reserves (
  reserve_id TEXT PRIMARY KEY,
  merchant_id TEXT,
  amount REAL,
  held_since TEXT,
  expected_release TEXT,
  status TEXT,
  is_synthetic INTEGER DEFAULT 1
);
CREATE TABLE ra_fee_policies (
  id TEXT PRIMARY KEY,
  topic TEXT,
  text TEXT
);
CREATE TABLE ra_agent_runs (
  run_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
);
CREATE TABLE ra_agent_outputs (
  output_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  domain TEXT,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE ra_action_queue (
  action_id TEXT PRIMARY KEY,
  run_id TEXT,
  exception_id TEXT,
  action TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  confidence INTEGER,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ra_auth_ref ON ra_authorizations(recon_ref);
CREATE INDEX idx_ra_cap_auth ON ra_captures(auth_id);
CREATE INDEX idx_ra_sch_cap ON ra_scheme_settlements(capture_id);
CREATE INDEX idx_ra_bank_ref ON ra_bank_transactions(recon_ref);
'''

    views = r'''
-- Reconciliation views (deterministic math). status: matched | unmatched | variance

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

CREATE VIEW v_ra_capture_scheme AS
SELECT
  c.capture_id AS ref_id,
  'scheme' AS area,
  CASE
    WHEN s.scheme_id IS NULL THEN 'unmatched'
    WHEN a.method != 'card' THEN 'matched'
    ELSE 'matched'
  END AS status,
  CASE WHEN s.scheme_id IS NULL AND a.method = 'card' THEN 'missing_scheme_settlement' ELSE 'scheme_settled' END AS category,
  a.merchant_id,
  c.ts,
  c.amount AS expected_amount,
  COALESCE(s.gross, 0) AS actual_amount,
  CASE WHEN s.scheme_id IS NULL AND a.method = 'card' THEN c.amount ELSE 0 END AS leakage,
  c.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_captures c
JOIN ra_authorizations a ON a.auth_id = c.auth_id
LEFT JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id;

-- Extra scheme fee leakage (invoiced/applied vs expected table)
CREATE VIEW v_ra_scheme_fee_var AS
SELECT
  s.scheme_id AS ref_id,
  'scheme' AS area,
  'variance' AS status,
  'scheme_fee_variance' AS category,
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

CREATE VIEW v_ra_scheme_bank AS
SELECT
  s.scheme_id AS ref_id,
  'bank_trs' AS area,
  CASE WHEN b.bank_txn_id IS NULL THEN 'unmatched' ELSE 'matched' END AS status,
  CASE WHEN b.bank_txn_id IS NULL THEN 'scheme_missing_in_bank' ELSE 'bank_matched' END AS category,
  a.merchant_id,
  s.settlement_date AS ts,
  s.net AS expected_amount,
  COALESCE(b.amount, 0) AS actual_amount,
  CASE WHEN b.bank_txn_id IS NULL THEN s.net ELSE 0 END AS leakage,
  s.recon_ref,
  a.method,
  s.scheme,
  a.currency
FROM ra_scheme_settlements s
JOIN ra_captures c ON c.capture_id = s.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
LEFT JOIN ra_bank_transactions b ON b.recon_ref = s.recon_ref;

CREATE VIEW v_ra_bank_unidentified AS
SELECT
  b.bank_txn_id AS ref_id,
  'bank_trs' AS area,
  'unmatched' AS status,
  'unidentified_bank_credit' AS category,
  NULL AS merchant_id,
  b.value_date AS ts,
  0 AS expected_amount,
  b.amount AS actual_amount,
  b.amount AS leakage,
  b.recon_ref,
  NULL AS method,
  NULL AS scheme,
  b.currency
FROM ra_bank_transactions b
WHERE b.recon_ref IS NULL
   OR NOT EXISTS (SELECT 1 FROM ra_scheme_settlements s WHERE s.recon_ref = b.recon_ref);

CREATE VIEW v_ra_fee_gateway AS
SELECT
  g.fee_id AS ref_id,
  'gateway' AS area,
  CASE WHEN ROUND(g.expected, 2) = ROUND(g.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'gateway_fee_variance' AS category,
  a.merchant_id,
  a.ts,
  g.expected AS expected_amount,
  g.invoiced AS actual_amount,
  ROUND(ABS(g.invoiced - g.expected), 2) AS leakage,
  g.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_gateway_charges g
LEFT JOIN ra_authorizations a ON a.recon_ref = g.recon_ref;

CREATE VIEW v_ra_fee_network AS
SELECT
  n.fee_id AS ref_id,
  'network' AS area,
  CASE WHEN ROUND(n.expected, 2) = ROUND(n.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'network_fee_variance' AS category,
  a.merchant_id,
  a.ts,
  n.expected AS expected_amount,
  n.invoiced AS actual_amount,
  ROUND(ABS(n.invoiced - n.expected), 2) AS leakage,
  n.recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_network_fees n
LEFT JOIN ra_authorizations a ON a.recon_ref = n.recon_ref;

CREATE VIEW v_ra_fee_partner AS
SELECT
  p.fee_id AS ref_id,
  'partner' AS area,
  CASE WHEN ROUND(p.expected, 2) = ROUND(p.invoiced, 2) THEN 'matched' ELSE 'variance' END AS status,
  'partner_fee_variance' AS category,
  NULL AS merchant_id,
  p.period AS ts,
  p.expected AS expected_amount,
  p.invoiced AS actual_amount,
  ROUND(ABS(p.expected - p.invoiced), 2) AS leakage,
  p.partner_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_partner_fees p;

CREATE VIEW v_ra_terminal_recon AS
SELECT
  t.terminal_id AS ref_id,
  'terminal' AS area,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN 'unmatched'
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN 'variance'
    WHEN t.status = 'active' AND b.bill_id IS NOT NULL THEN 'matched'
    ELSE 'matched'
  END AS status,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN 'active_terminal_unbilled'
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN 'retired_terminal_billed'
    ELSE 'terminal_ok'
  END AS category,
  t.merchant_id,
  '2026-10' AS ts,
  CASE WHEN t.status = 'active' THEN t.monthly_rental ELSE 0 END AS expected_amount,
  COALESCE(b.billed, 0) AS actual_amount,
  CASE
    WHEN t.status = 'active' AND b.bill_id IS NULL THEN t.monthly_rental
    WHEN t.status = 'retired' AND b.bill_id IS NOT NULL THEN b.billed
    ELSE 0
  END AS leakage,
  t.terminal_id AS recon_ref,
  'pos' AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_terminals t
LEFT JOIN ra_terminal_billing b ON b.terminal_id = t.terminal_id AND b.period = '2026-10';

CREATE VIEW v_ra_fx AS
SELECT
  f.fx_id AS ref_id,
  'fx' AS area,
  CASE WHEN f.applied_rate > f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0) + 0.00005
       THEN 'variance' ELSE 'matched' END AS status,
  CASE WHEN f.applied_rate > f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0) + 0.00005
       THEN 'fx_markup_excess' ELSE 'fx_ok' END AS category,
  a.merchant_id,
  f.ts,
  ROUND(f.amount * f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0), 2) AS expected_amount,
  ROUND(f.amount * f.applied_rate, 2) AS actual_amount,
  ROUND(MAX(0, f.amount * f.applied_rate - f.amount * f.reference_rate * (1.0 + f.agreed_markup_bps / 10000.0)), 2) AS leakage,
  f.recon_ref,
  a.method,
  a.scheme,
  f.to_ccy AS currency
FROM ra_fx_conversions f
LEFT JOIN ra_authorizations a ON a.recon_ref = f.recon_ref;

CREATE VIEW v_ra_apm AS
SELECT
  r.report_id AS ref_id,
  'apm' AS area,
  CASE WHEN ROUND(r.amount, 2) = ROUND(COALESCE(x.actual, 0), 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(r.amount, 2) = ROUND(COALESCE(x.actual, 0), 2) THEN 'apm_ok' ELSE 'apm_report_mismatch' END AS category,
  NULL AS merchant_id,
  r.report_date AS ts,
  COALESCE(x.actual, 0) AS expected_amount,
  r.amount AS actual_amount,
  ROUND(ABS(r.amount - COALESCE(x.actual, 0)), 2) AS leakage,
  r.recon_ref,
  r.method,
  r.provider AS scheme,
  'INR' AS currency
FROM ra_apm_reports r
LEFT JOIN (
  SELECT DATE(s.settlement_date) AS d,
         CASE a.scheme
           WHEN 'UPI' THEN 'NPCI'
           WHEN 'PAYTM' THEN 'Paytm'
           WHEN 'PHONEPE' THEN 'PhonePe'
           WHEN 'LAZYPAY' THEN 'LazyPay'
           WHEN 'NETBANKING' THEN 'BankNet'
           WHEN 'IMPS' THEN 'NPCI'
           ELSE a.scheme
         END AS provider,
         a.method,
         ROUND(SUM(c.amount), 2) AS actual
  FROM ra_captures c
  JOIN ra_authorizations a ON a.auth_id = c.auth_id
  JOIN ra_scheme_settlements s ON s.capture_id = c.capture_id
  WHERE a.method != 'card'
  GROUP BY 1, 2, 3
) x ON x.d = r.report_date AND x.provider = r.provider AND x.method = r.method;

CREATE VIEW v_ra_pricing AS
SELECT
  i.invoice_id AS ref_id,
  'pricing' AS area,
  CASE WHEN ROUND(i.mdr_billed, 2) = ROUND(i.mdr_expected, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE WHEN ROUND(i.mdr_billed, 2) = ROUND(i.mdr_expected, 2) THEN 'mdr_ok' ELSE 'mdr_contract_variance' END AS category,
  i.merchant_id,
  i.period AS ts,
  i.mdr_expected AS expected_amount,
  i.mdr_billed AS actual_amount,
  ROUND(ABS(i.mdr_billed - i.mdr_expected), 2) AS leakage,
  i.invoice_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_merchant_invoices i;

CREATE VIEW v_ra_payouts AS
SELECT
  p.payout_id AS ref_id,
  'payouts' AS area,
  CASE WHEN ROUND(p.amount, 2) = ROUND(p.expected_net, 2) THEN 'matched' ELSE 'variance' END AS status,
  CASE
    WHEN p.amount < p.expected_net - 0.5 THEN 'under_payout'
    WHEN p.amount > p.expected_net + 0.5 THEN 'over_payout'
    ELSE 'payout_ok'
  END AS category,
  p.merchant_id,
  p.payout_date AS ts,
  p.expected_net AS expected_amount,
  p.amount AS actual_amount,
  ROUND(ABS(p.expected_net - p.amount), 2) AS leakage,
  p.payout_id AS recon_ref,
  NULL AS method,
  NULL AS scheme,
  'INR' AS currency
FROM ra_payouts p
UNION ALL
SELECT
  r.reserve_id,
  'payouts',
  CASE WHEN r.status = 'overdue' THEN 'unmatched' ELSE 'matched' END,
  CASE WHEN r.status = 'overdue' THEN 'reserve_overdue' ELSE 'reserve_held' END,
  r.merchant_id,
  r.held_since,
  0,
  r.amount,
  CASE WHEN r.status = 'overdue' THEN r.amount ELSE 0 END,
  r.reserve_id,
  NULL, NULL, 'INR'
FROM ra_reserves r;

CREATE VIEW v_ra_chargebacks AS
SELECT
  cb.cb_id AS ref_id,
  'chargebacks' AS area,
  CASE WHEN ROUND(cb.recovered, 2) >= ROUND(cb.amount, 2) THEN 'matched' ELSE 'unmatched' END AS status,
  CASE WHEN ROUND(cb.recovered, 2) >= ROUND(cb.amount, 2) THEN 'chargeback_recovered' ELSE 'chargeback_unrecovered' END AS category,
  a.merchant_id,
  cb.ts,
  cb.amount AS expected_amount,
  cb.recovered AS actual_amount,
  ROUND(cb.amount - cb.recovered, 2) AS leakage,
  cb.cb_id AS recon_ref,
  a.method,
  a.scheme,
  a.currency
FROM ra_chargebacks cb
JOIN ra_captures c ON c.capture_id = cb.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id
UNION ALL
SELECT
  rf.refund_id,
  'chargebacks',
  CASE WHEN rf.double_counted = 1 THEN 'variance' ELSE 'matched' END,
  CASE WHEN rf.double_counted = 1 THEN 'refund_double_counted' ELSE 'refund_ok' END,
  a.merchant_id,
  rf.ts,
  rf.amount,
  CASE WHEN rf.double_counted = 1 THEN rf.amount * 2 ELSE rf.amount END,
  CASE WHEN rf.double_counted = 1 THEN rf.amount ELSE 0 END,
  rf.refund_id,
  a.method, a.scheme, a.currency
FROM ra_refunds rf
JOIN ra_captures c ON c.capture_id = rf.capture_id
JOIN ra_authorizations a ON a.auth_id = c.auth_id;

CREATE VIEW v_ra_exceptions AS
SELECT * FROM (
  SELECT * FROM v_ra_auth_capture WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_capture_scheme WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_scheme_fee_var WHERE leakage > 0.5
  UNION ALL SELECT * FROM v_ra_scheme_bank WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_bank_unidentified
  UNION ALL SELECT * FROM v_ra_fee_gateway WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fee_network WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fee_partner WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_terminal_recon WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_fx WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_apm WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_pricing WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_payouts WHERE status != 'matched' AND leakage > 0
  UNION ALL SELECT * FROM v_ra_chargebacks WHERE status != 'matched' AND leakage > 0
);
'''

    parts = [
        ddl,
        insert("ra_merchants", ["merchant_id", "name", "mcc", "country", "currency", "mdr_bps", "settlement_delay_days", "segment", "is_synthetic"], merchants),
        insert("ra_partners", ["partner_id", "name", "type", "share_bps", "is_synthetic"], partners),
        insert("ra_terminals", ["terminal_id", "merchant_id", "status", "monthly_rental", "installed_on", "is_synthetic"], terminals),
        insert("ra_authorizations", ["auth_id", "merchant_id", "terminal_id", "partner_id", "ts", "amount", "currency", "method", "scheme", "status", "recon_ref", "is_synthetic"], auths),
        insert("ra_captures", ["capture_id", "auth_id", "ts", "amount", "recon_ref", "is_synthetic"], captures),
        insert("ra_scheme_settlements", ["scheme_id", "capture_id", "scheme", "settlement_date", "gross", "interchange", "scheme_fee", "net", "recon_ref", "is_synthetic"], schemes),
        insert("ra_network_fees", ["fee_id", "recon_ref", "fee_type", "expected", "invoiced", "is_synthetic"], network_fees),
        insert("ra_gateway_charges", ["fee_id", "recon_ref", "expected", "invoiced", "is_synthetic"], gateway_fees),
        insert("ra_partner_fees", ["fee_id", "partner_id", "period", "expected", "invoiced", "is_synthetic"], partner_fee_rows),
        insert("ra_terminal_billing", ["bill_id", "terminal_id", "period", "billed", "is_synthetic"], terminal_bills),
        insert("ra_bank_transactions", ["bank_txn_id", "trs_ref", "value_date", "amount", "currency", "narrative", "recon_ref", "is_synthetic"], bank_txns),
        insert("ra_apm_reports", ["report_id", "provider", "method", "report_date", "amount", "recon_ref", "is_synthetic"], apm_reports),
        insert("ra_fx_conversions", ["fx_id", "ts", "from_ccy", "to_ccy", "amount", "applied_rate", "reference_rate", "agreed_markup_bps", "recon_ref", "is_synthetic"], fx_rows),
        insert("ra_merchant_invoices", ["invoice_id", "merchant_id", "period", "volume", "mdr_billed", "mdr_expected", "is_synthetic"], invoices),
        insert("ra_chargebacks", ["cb_id", "capture_id", "amount", "reason", "recovered", "ts", "is_synthetic"], chargebacks),
        insert("ra_refunds", ["refund_id", "capture_id", "amount", "ts", "double_counted", "is_synthetic"], refunds),
        insert("ra_payouts", ["payout_id", "merchant_id", "payout_date", "amount", "expected_net", "is_synthetic"], payouts),
        insert("ra_reserves", ["reserve_id", "merchant_id", "amount", "held_since", "expected_release", "status", "is_synthetic"], reserves),
        insert("ra_fee_policies", ["id", "topic", "text"], policies),
        views,
        f"""
-- counts for sanity (comments)
-- merchants={len(merchants)} partners={len(partners)} terminals={len(terminals)}
-- auths={len(auths)} captures={len(captures)} scheme={len(schemes)} bank={len(bank_txns)}
-- leftover_inject={json.dumps(leftover)}
""",
    ]
    OUT.write_text("\n".join(parts))
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
    print("auths", len(auths), "captures", len(captures), "scheme", len(schemes), "bank", len(bank_txns))
    print("fx", len(fx_rows), "apm reports", len(apm_reports), "cb", len(chargebacks), "refunds", len(refunds))
    print("leftover inject (0 means all placed, >0 means budget unused):", leftover)


if __name__ == "__main__":
    main()
