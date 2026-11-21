import type { AppDb } from "./pg";
import { BASEII_B64, CAMT053_XML, CP500_TABLE, IPM_B64, NPCI_NTSL } from "./ingestSamples";

export type CanonicalRow = {
  canonical_id: string;
  source_file: string;
  source_kind: string;
  txn_id: string | null;
  end_to_end_id: string | null;
  msg_id: string | null;
  rrn: string | null;
  upi_txn_id: string | null;
  payment_rail: string | null;
  card_segment: string | null;
  scheme: string | null;
  method: string | null;
  mcc: string | null;
  merchant_id: string | null;
  currency: string;
  txn_amount: number;
  recon_amount: number | null;
  settlement_amount: number | null;
  actual_fee: number | null;
  interchange_fee: number | null;
  irf: number | null;
  ird: string | null;
  pds0146_fee: number | null;
  intermediary_charge: number | null;
  charge_agent: string | null;
  response_code: string | null;
  txn_status: string | null;
  p2m_flag: string | null;
  is_rupay_credit: boolean;
  is_ppi: boolean;
  tcr5_expected: string | null;
  tcr5_actual: string | null;
  tcr5_qualification: string | null;
  ledger_status: string | null;
  ledger_fee: number | null;
  ts: string;
};

export type IngestFile = {
  file_id: string;
  kind: string;
  filename: string;
  status: string;
  record_count: number;
  error_count: number;
  notes: string;
};

export type ClearingException = {
  ref_id: string;
  category: string;
  merchant_id: string | null;
  expected_amount: number;
  actual_amount: number;
  leakage: number;
  recon_ref: string;
  note: string;
};

const ILLUSTRATIVE = {
  rupay_credit_mdr_bps: 80, // illustrative MDR on RuPay Credit UPI above ₹2,000
  rupay_credit_threshold: 2000,
  ppi_interchange_pct: 1.1, // illustrative PPI interchange on eligible MCCs
  ppi_eligible_mccs: new Set(["5411", "5812", "5912"]),
  fx_markup_cap_bps: 150, // illustrative cap on DE5 vs DE4 markup
};

function decodeCp500(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += CP500_TABLE[b] ?? "";
  return out;
}

function b64(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const a = alphabet.indexOf(clean[i]);
    const b = alphabet.indexOf(clean[i + 1]);
    const c = clean[i + 2] === "=" ? 0 : alphabet.indexOf(clean[i + 2]);
    const d = clean[i + 3] === "=" ? 0 : alphabet.indexOf(clean[i + 3]);
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    out[j++] = (triple >> 16) & 255;
    if (clean[i + 2] !== "=") out[j++] = (triple >> 8) & 255;
    if (clean[i + 3] !== "=") out[j++] = triple & 255;
  }
  return out.slice(0, j);
}

function num(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function implied(digits: string, scale = 2): number {
  const d = digits.replace(/\D/g, "") || "0";
  return Number(d) / 10 ** scale;
}

function tags(xml: string, name: string): { attrs: string; body: string }[] {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  const out: { attrs: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: m[1] ?? "", body: m[2] });
  return out;
}

function firstText(xml: string, name: string): string {
  const t = tags(xml, name);
  return t[0] ? t[0].body.replace(/<[^>]+>/g, "").trim() : "";
}

function attr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

export function parseCamt053(xml: string, filename = "camt053_sample.xml"): CanonicalRow[] {
  const msgId = firstText(xml, "MsgId") || "CAMT053";
  const entries = tags(xml, "Ntry");
  const rows: CanonicalRow[] = [];
  let i = 0;
  for (const e of entries) {
    i += 1;
    const body = e.body;
    const endToEnd = firstText(body, "EndToEndId");
    const txnId = firstText(body, "TxId") || endToEnd || `${msgId}-${i}`;
    const instd = tags(body, "InstdAmt")[0];
    const instdAmt = instd ? num(instd.body.replace(/<[^>]+>/g, "")) : num(firstText(body, "Amt"));
    const instdCcy = instd ? attr(instd.attrs, "Ccy") : attr(tags(body, "Amt")[0]?.attrs ?? "", "Ccy") || "INR";
    const sttl = firstText(body, "IntrBkSttlmAmt") || firstText(body, "Amt");
    const sttlAmt = num(sttl);
    const chg = tags(body, "ChrgsInf")[0];
    const chgAmt = chg ? num(firstText(chg.body, "Amt")) : 0;
    const agent = chg ? firstText(chg.body, "Nm") || firstText(chg.body, "BICFI") : "";
    rows.push({
      canonical_id: `CAN-CAMT-${String(i).padStart(3, "0")}`,
      source_file: filename,
      source_kind: "camt053",
      txn_id: txnId,
      end_to_end_id: endToEnd || null,
      msg_id: msgId,
      rrn: null,
      upi_txn_id: null,
      payment_rail: "NEFT",
      card_segment: "NA",
      scheme: null,
      method: "credit",
      mcc: /MCC\s+(\d+)/i.test(body) ? body.match(/MCC\s+(\d+)/i)![1] : null,
      merchant_id: (endToEnd.match(/MER\d+/) || [null])[0],
      currency: instdCcy || "INR",
      txn_amount: instdAmt || sttlAmt,
      recon_amount: sttlAmt || instdAmt,
      settlement_amount: sttlAmt || instdAmt,
      actual_fee: chgAmt,
      interchange_fee: null,
      irf: null,
      ird: null,
      pds0146_fee: null,
      intermediary_charge: chgAmt,
      charge_agent: agent || null,
      response_code: "00",
      txn_status: "approved",
      p2m_flag: null,
      is_rupay_credit: false,
      is_ppi: false,
      tcr5_expected: null,
      tcr5_actual: null,
      tcr5_qualification: null,
      ledger_status: "settled",
      ledger_fee: chgAmt,
      ts: "2026-10-22T18:30:00+05:30",
    });
  }
  return rows;
}

export function parseNpciUpi(text: string, filename = "npci_upi_ntsc_sample.txt"): CanonicalRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("|").map((h) => h.trim());
  const rows: CanonicalRow[] = [];
  let i = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    i += 1;
    const cols = line.split("|");
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      rec[h] = (cols[idx] ?? "").trim();
    });
    const rupay = rec.RUPAY_CREDIT === "Y";
    const ppi = rec.PPI === "Y";
    const rc = rec.RC || "00";
    const timeout = rc !== "00" && rc !== "0";
    rows.push({
      canonical_id: `CAN-UPI-${String(i).padStart(3, "0")}`,
      source_file: filename,
      source_kind: "npci_upi",
      txn_id: rec.UPI_TXN_ID || rec.RRN,
      end_to_end_id: rec.UPI_TXN_ID || null,
      msg_id: null,
      rrn: rec.RRN,
      upi_txn_id: rec.UPI_TXN_ID,
      payment_rail: "UPI",
      card_segment: rupay ? "COMMERCIAL_CREDIT" : "NA",
      scheme: rupay ? "RUPAY" : ppi ? "PPI" : "UPI",
      method: "upi",
      mcc: rec.MCC || null,
      merchant_id: rec.MERCHANT_ID || null,
      currency: "INR",
      txn_amount: num(rec.TXN_AMOUNT),
      recon_amount: num(rec.TXN_AMOUNT),
      settlement_amount: rec.LEDGER_STATUS === "settled" || rec.LEDGER_STATUS === "approved" ? num(rec.TXN_AMOUNT) : 0,
      actual_fee: num(rec.ACTUAL_FEE),
      interchange_fee: ppi ? num(rec.ACTUAL_FEE) : null,
      irf: null,
      ird: null,
      pds0146_fee: null,
      intermediary_charge: 0,
      charge_agent: null,
      response_code: rc,
      txn_status: timeout ? (rc === "91" ? "timeout" : "deemed_approved") : "approved",
      p2m_flag: rec.TXN_TYPE,
      is_rupay_credit: rupay,
      is_ppi: ppi,
      tcr5_expected: null,
      tcr5_actual: null,
      tcr5_qualification: null,
      ledger_status: rec.LEDGER_STATUS,
      ledger_fee: num(rec.LEDGER_FEE),
      ts: "2026-10-22T12:00:00+05:30",
    });
  }
  return rows;
}

export function parseMastercardIpm(bytes: Uint8Array, filename = "mastercard_ipm_sample.bin"): CanonicalRow[] {
  const rows: CanonicalRow[] = [];
  let offset = 0;
  let i = 0;
  while (offset + 2 <= bytes.length) {
    const len = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    if (len <= 0 || offset + len > bytes.length) break;
    const body = decodeCp500(bytes.slice(offset, offset + len));
    offset += len;
    i += 1;
    const field = (name: string) => {
      const m = body.match(new RegExp(`${name}=([^\\s]+)`));
      return m ? m[1] : "";
    };
    const de4 = implied(field("DE4"), 2);
    const de5 = implied(field("DE5"), 2);
    const pds = implied(field("PDS0146"), 2);
    rows.push({
      canonical_id: `CAN-IPM-${String(i).padStart(3, "0")}`,
      source_file: filename,
      source_kind: "mastercard_ipm",
      txn_id: field("TXN") || `IPM${i}`,
      end_to_end_id: field("TXN") || null,
      msg_id: null,
      rrn: null,
      upi_txn_id: null,
      payment_rail: "CARD",
      card_segment: "CONSUMER_DEBIT",
      scheme: "MASTERCARD",
      method: "card",
      mcc: null,
      merchant_id: field("MID") || null,
      currency: field("CCY") || "INR",
      txn_amount: de4,
      recon_amount: de5,
      settlement_amount: de5,
      actual_fee: pds,
      interchange_fee: pds,
      irf: pds,
      ird: field("PDS0158") || null,
      pds0146_fee: pds,
      intermediary_charge: 0,
      charge_agent: null,
      response_code: "00",
      txn_status: "approved",
      p2m_flag: "P2M",
      is_rupay_credit: false,
      is_ppi: false,
      tcr5_expected: null,
      tcr5_actual: null,
      tcr5_qualification: field("PDS0158") || null,
      ledger_status: "settled",
      ledger_fee: pds,
      ts: "2026-10-22T14:00:00+05:30",
    });
  }
  return rows;
}

export function parseVisaBaseII(bytes: Uint8Array, filename = "visa_baseii_sample.bin"): CanonicalRow[] {
  // 80-byte EBCDIC TCR records. See samples/ingestion/README.md for the layout.
  const grouped = new Map<string, { t0?: string; t1?: string; t5?: string }>();
  for (let off = 0; off + 80 <= bytes.length; off += 80) {
    const rec = decodeCp500(bytes.slice(off, off + 80));
    const kind = rec[0];
    const txn = rec.slice(1, 13).trim();
    const g = grouped.get(txn) ?? {};
    if (kind === "0") g.t0 = rec;
    else if (kind === "1") g.t1 = rec;
    else if (kind === "5") g.t5 = rec;
    grouped.set(txn, g);
  }
  const rows: CanonicalRow[] = [];
  let i = 0;
  for (const [txn, g] of grouped) {
    i += 1;
    const t0 = g.t0 ?? "".padEnd(80);
    const t1 = g.t1 ?? "".padEnd(80);
    const t5 = g.t5 ?? "".padEnd(80);
    const amount = implied(t0.slice(13, 25), 2);
    const irf = implied((t1.slice(13, 25) || "0"), 2);
    const ccy = t0.slice(25, 28).trim() || "INR";
    const mcc = t0.slice(28, 34).trim();
    const mid = t0.slice(34, 40).trim();
    const expected = t5.slice(40, 48).trim();
    const actual = t5.slice(48, 56).trim();
    rows.push({
      canonical_id: `CAN-VISA-${String(i).padStart(3, "0")}`,
      source_file: filename,
      source_kind: "visa_baseii",
      txn_id: txn,
      end_to_end_id: txn,
      msg_id: null,
      rrn: null,
      upi_txn_id: null,
      payment_rail: "CARD",
      card_segment: "CONSUMER_DEBIT",
      scheme: "VISA",
      method: "card",
      mcc: mcc || null,
      merchant_id: mid || null,
      currency: ccy,
      txn_amount: amount,
      recon_amount: amount,
      settlement_amount: amount,
      actual_fee: irf,
      interchange_fee: irf,
      irf,
      ird: t1.slice(40, 48).trim() || null,
      pds0146_fee: null,
      intermediary_charge: 0,
      charge_agent: null,
      response_code: "00",
      txn_status: "approved",
      p2m_flag: "P2M",
      is_rupay_credit: false,
      is_ppi: false,
      tcr5_expected: expected || null,
      tcr5_actual: actual || null,
      tcr5_qualification: actual || expected || null,
      ledger_status: "settled",
      ledger_fee: irf,
      ts: "2026-10-22T15:00:00+05:30",
    });
  }
  return rows;
}

export function parseBundledSamples(): { files: IngestFile[]; rows: CanonicalRow[] } {
  const files: IngestFile[] = [];
  const rows: CanonicalRow[] = [];
  const run = (id: string, kind: string, filename: string, notes: string, fn: () => CanonicalRow[]) => {
    try {
      const parsed = fn();
      rows.push(...parsed);
      files.push({ file_id: id, kind, filename, status: "parsed", record_count: parsed.length, error_count: 0, notes });
    } catch (err) {
      files.push({
        file_id: id,
        kind,
        filename,
        status: "error",
        record_count: 0,
        error_count: 1,
        notes: `${notes} Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
  run("ING-CAMT053-20261022", "camt053", "camt053_sample.xml", "ISO 20022 camt.053 synthetic statement. Raw XML is not sent to the LLM.", () => parseCamt053(CAMT053_XML));
  run("ING-NPCI-UPI-20261022", "npci_upi", "npci_upi_ntsc_sample.txt", "NPCI UPI / NTSL-style pipe file. 12-digit RRN and UPI txn id used for matching.", () => parseNpciUpi(NPCI_NTSL));
  run("ING-IPM-20261022", "mastercard_ipm", "mastercard_ipm_sample.bin", "Simplified Mastercard IPM: RDW + EBCDIC (cp500) body with DE4/DE5, PDS 0158, PDS 0146.", () => parseMastercardIpm(b64(IPM_B64)));
  run("ING-BASEII-20261022", "visa_baseii", "visa_baseii_sample.bin", "Simplified Visa BASE II: 80-byte EBCDIC (cp500) TCR0/TCR1/TCR5 records.", () => parseVisaBaseII(b64(BASEII_B64)));
  return { files, rows };
}

/** Deterministic leakage checks on canonical rows. Rates are illustrative. */
export function clearingChecks(rows: CanonicalRow[]): ClearingException[] {
  const out: ClearingException[] = [];
  for (const r of rows) {
    // Deemed-approved / timeout settled or charged MDR
    if ((r.txn_status === "timeout" || r.txn_status === "deemed_approved") && (num(r.ledger_status === "settled" || r.settlement_amount ? r.settlement_amount : 0) > 0 || num(r.actual_fee) > 0 || num(r.ledger_fee) > 0)) {
      out.push({
        ref_id: r.canonical_id,
        category: "clearing_deemed_approved_mdr",
        merchant_id: r.merchant_id,
        expected_amount: 0,
        actual_amount: num(r.actual_fee ?? r.ledger_fee),
        leakage: num(r.actual_fee ?? r.ledger_fee) + (r.ledger_status === "settled" ? 0 : 0),
        recon_ref: r.rrn || r.txn_id || r.canonical_id,
        note: `Response code ${r.response_code} (${r.txn_status}) but the ledger ${r.ledger_status} and a fee of ${num(r.actual_fee)} was taken. Timeout / deemed-approved transactions should not settle or carry MDR.`,
      });
    }
    // RuPay Credit on UPI > ₹2,000 — illustrative MDR
    if (r.payment_rail === "UPI" && r.is_rupay_credit && num(r.txn_amount) > ILLUSTRATIVE.rupay_credit_threshold) {
      const expected = money(num(r.txn_amount) * (ILLUSTRATIVE.rupay_credit_mdr_bps / 10000));
      const actual = num(r.actual_fee);
      if (Math.abs(actual - expected) > 0.005) {
        out.push({
          ref_id: r.canonical_id + "-RUPAY",
          category: "clearing_rupay_credit_mdr",
          merchant_id: r.merchant_id,
          expected_amount: expected,
          actual_amount: actual,
          leakage: money(Math.abs(actual - expected)),
          recon_ref: r.upi_txn_id || r.canonical_id,
          note: `Illustrative RuPay Credit on UPI MDR: ${ILLUSTRATIVE.rupay_credit_mdr_bps} bps on amounts strictly above ₹${ILLUSTRATIVE.rupay_credit_threshold.toLocaleString("en-IN")}.`,
        });
      }
    }
    // PPI interchange 1.1% on eligible MCCs (illustrative)
    if (r.is_ppi && r.mcc && ILLUSTRATIVE.ppi_eligible_mccs.has(r.mcc)) {
      const expected = money(num(r.txn_amount) * (ILLUSTRATIVE.ppi_interchange_pct / 100));
      const actual = num(r.actual_fee);
      if (actual - expected > 0.005) {
        out.push({
          ref_id: r.canonical_id + "-PPI",
          category: "clearing_ppi_interchange",
          merchant_id: r.merchant_id,
          expected_amount: expected,
          actual_amount: actual,
          leakage: money(actual - expected),
          recon_ref: r.upi_txn_id || r.canonical_id,
          note: `Illustrative PPI interchange ${ILLUSTRATIVE.ppi_interchange_pct}% on eligible MCC ${r.mcc}.`,
        });
      }
    }
    // FX markup DE4 vs DE5
    if (r.source_kind === "mastercard_ipm" && r.recon_amount != null && num(r.txn_amount) > 0) {
      const markup = (num(r.recon_amount) - num(r.txn_amount)) / num(r.txn_amount);
      const cap = ILLUSTRATIVE.fx_markup_cap_bps / 10000;
      if (markup > cap + 1e-9) {
        const excess = money((markup - cap) * num(r.txn_amount));
        out.push({
          ref_id: r.canonical_id + "-FX",
          category: "clearing_fx_markup",
          merchant_id: r.merchant_id,
          expected_amount: money(num(r.txn_amount) * (1 + cap)),
          actual_amount: num(r.recon_amount),
          leakage: excess,
          recon_ref: r.txn_id || r.canonical_id,
          note: `FX markup from DE4 vs DE5 is ${(markup * 10000).toFixed(0)} bps, above the illustrative cap of ${ILLUSTRATIVE.fx_markup_cap_bps} bps.`,
        });
      }
    }
    // Interchange downgrade (Visa TCR5 expected vs actual)
    if (r.source_kind === "visa_baseii" && r.tcr5_expected && r.tcr5_actual && r.tcr5_expected !== r.tcr5_actual) {
      out.push({
        ref_id: r.canonical_id + "-DG",
        category: "clearing_interchange_downgrade",
        merchant_id: r.merchant_id,
        expected_amount: 0,
        actual_amount: num(r.irf),
        leakage: num(r.irf),
        recon_ref: r.txn_id || r.canonical_id,
        note: `TCR5 qualification downgrade: expected ${r.tcr5_expected}, actual ${r.tcr5_actual}. IRF ${num(r.irf)} flagged for review.`,
      });
    }
    // Intermediary bank charges on camt.053
    if (r.source_kind === "camt053" && num(r.intermediary_charge) > 0) {
      out.push({
        ref_id: r.canonical_id + "-CHG",
        category: "clearing_intermediary_charges",
        merchant_id: r.merchant_id,
        expected_amount: 0,
        actual_amount: num(r.intermediary_charge),
        leakage: num(r.intermediary_charge),
        recon_ref: r.end_to_end_id || r.canonical_id,
        note: `Intermediary charge ${num(r.intermediary_charge)} ${r.currency} by ${r.charge_agent ?? "unknown agent"} (ChrgsInf).`,
      });
    }
  }
  return out;
}

function money(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function persistIngestion(db: AppDb): Promise<{ files: IngestFile[]; rows: CanonicalRow[]; exceptions: ClearingException[] }> {
  const { files, rows } = parseBundledSamples();
  const exceptions = clearingChecks(rows);
  for (const f of files) {
    await db
      .prepare(
        `INSERT INTO ra_ingest_files (file_id, kind, filename, status, record_count, error_count, notes, parsed_at, is_synthetic)
         VALUES (?, ?, ?, ?, ?, ?, ?, now(), 1)
         ON CONFLICT (file_id) DO UPDATE SET
           status=EXCLUDED.status, record_count=EXCLUDED.record_count, error_count=EXCLUDED.error_count,
           notes=EXCLUDED.notes, parsed_at=now()`,
      )
      .bind(f.file_id, f.kind, f.filename, f.status, f.record_count, f.error_count, f.notes)
      .run();
  }
  await db.prepare("DELETE FROM ra_canonical_settlement").run();
  for (const r of rows) {
    await db
      .prepare(
        `INSERT INTO ra_canonical_settlement (
           canonical_id, source_file, source_kind, txn_id, end_to_end_id, msg_id, rrn, upi_txn_id,
           payment_rail, card_segment, scheme, method, mcc, merchant_id, currency,
           txn_amount, recon_amount, settlement_amount, actual_fee, interchange_fee, irf, ird, pds0146_fee,
           intermediary_charge, charge_agent, response_code, txn_status, p2m_flag,
           is_rupay_credit, is_ppi, tcr5_expected, tcr5_actual, tcr5_qualification,
           ledger_status, ledger_fee, ts, is_synthetic
         ) VALUES (${Array(37).fill("?").join(",")})`,
      )
      .bind(
        r.canonical_id, r.source_file, r.source_kind, r.txn_id, r.end_to_end_id, r.msg_id, r.rrn, r.upi_txn_id,
        r.payment_rail, r.card_segment, r.scheme, r.method, r.mcc, r.merchant_id, r.currency,
        r.txn_amount, r.recon_amount, r.settlement_amount, r.actual_fee, r.interchange_fee, r.irf, r.ird, r.pds0146_fee,
        r.intermediary_charge, r.charge_agent, r.response_code, r.txn_status, r.p2m_flag,
        r.is_rupay_credit ? 1 : 0, r.is_ppi ? 1 : 0, r.tcr5_expected, r.tcr5_actual, r.tcr5_qualification,
        r.ledger_status, r.ledger_fee, r.ts, 1,
      )
      .run();
  }
  try {
    await db.prepare("SELECT refresh_ra_v7b()").run();
  } catch {
    // refresh may lag until 007 is applied
  }
  return { files, rows, exceptions };
}

export async function listIngestion(db: AppDb) {
  const { results: files } = await db.prepare("SELECT * FROM ra_ingest_files ORDER BY kind").all<Record<string, unknown>>();
  const { results: rows } = await db
    .prepare("SELECT * FROM ra_canonical_settlement ORDER BY source_kind, canonical_id")
    .all<Record<string, unknown>>();
  const { results: exceptions } = await db
    .prepare("SELECT * FROM ra_exception_rows WHERE area='clearing' ORDER BY leakage DESC")
    .all<Record<string, unknown>>();
  const leakage = (exceptions ?? []).reduce((s, r) => s + Number(r.leakage ?? 0), 0);
  return {
    files: files ?? [],
    rows: rows ?? [],
    exceptions: exceptions ?? [],
    leakage,
    note: "Raw clearing files are parsed deterministically and never sent to the LLM. RuPay Credit MDR above ₹2,000 (80 bps), PPI interchange 1.1% on eligible MCCs, and the 150 bps FX markup cap are illustrative rates, not official scheme tariffs.",
    rates: {
      rupay_credit_mdr_bps: ILLUSTRATIVE.rupay_credit_mdr_bps,
      rupay_credit_threshold: ILLUSTRATIVE.rupay_credit_threshold,
      ppi_interchange_pct: ILLUSTRATIVE.ppi_interchange_pct,
      fx_markup_cap_bps: ILLUSTRATIVE.fx_markup_cap_bps,
      illustrative: true,
    },
  };
}
