import { parseCamt053, parseMastercardIpm, parseNpciUpi, parseVisaBaseII } from "../ingest";

export type ParseOutcome = { ok: boolean; message: string; rows: number; columns: string[]; sample: Record<string, string>[] };

function csvParse(text: string, delimiter = ","): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { columns: [], rows: [] };
  const delim = delimiter === "\\t" ? "\t" : delimiter;
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === delim && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const columns = split(lines[0]).map((c, i) => c || `col_${i + 1}`);
  const rows = lines.slice(1, 51).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row;
  });
  return { columns, rows };
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 200);
  let odd = 0;
  for (let i = 0; i < n; i++) if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) odd++;
  return odd > n * 0.3;
}

export function parseMt940(text: string): ParseOutcome {
  const lines = text.split(/\r?\n/);
  const hasTag = lines.some((l) => /^:(20|25|28C|60F|60M|61|62F|86):/.test(l));
  const stmt = lines.filter((l) => l.startsWith(":61:"));
  if (!hasTag) return { ok: false, message: "The file does not look like MT940/MT942 (no :20:/:25:/:61: tags).", rows: 0, columns: [], sample: [] };
  const sample = stmt.slice(0, 5).map((l, i) => ({ line: String(i + 1), raw: l.slice(0, 120) }));
  return { ok: stmt.length > 0 || hasTag, message: stmt.length ? `Parsed ${stmt.length} :61: statement line(s).` : "MT940 tags found but no :61: statement lines.", rows: stmt.length, columns: ["line", "raw"], sample };
}

export function parseSample(kind: string, filename: string, text: string, bytes: Uint8Array, delimiter = ","): ParseOutcome {
  try {
    if (kind === "planned" || kind === "iso8583_binary") {
      return { ok: false, message: "A production parser for this format is planned. The file was not treated as a successful import.", rows: 0, columns: [], sample: [] };
    }
    if (kind === "mt940" || kind === "mt942") return parseMt940(text);
    if (kind === "camt053" || kind === "camt054") {
      const rows = parseCamt053(text, filename);
      return { ok: rows.length > 0, message: rows.length ? `Parsed ${rows.length} camt entr(y/ies).` : "camt XML was read but no entries were found.", rows: rows.length, columns: ["txn_id", "txn_amount"], sample: rows.slice(0, 5).map((r) => ({ txn_id: String(r.txn_id ?? ""), amount: String(r.txn_amount ?? "") })) };
    }
    if (kind === "npci_upi") {
      const rows = parseNpciUpi(text, filename);
      return { ok: rows.length > 0, message: rows.length ? `Parsed ${rows.length} NPCI-style row(s).` : "No NPCI-style rows were parsed.", rows: rows.length, columns: ["txn_id", "txn_amount"], sample: rows.slice(0, 5).map((r) => ({ txn_id: String(r.txn_id ?? ""), amount: String(r.txn_amount ?? "") })) };
    }
    if (kind === "ipm_sample") {
      if (!bytes.length) return { ok: false, message: "Empty IPM sample.", rows: 0, columns: [], sample: [] };
      const rows = parseMastercardIpm(bytes, filename);
      return { ok: rows.length > 0, message: rows.length ? `Simplified IPM sample parser read ${rows.length} row(s). A complete production IPM parser is planned.` : "The simplified IPM sample parser returned no rows (a complete IPM parser is planned).", rows: rows.length, columns: ["txn_id"], sample: rows.slice(0, 3).map((r) => ({ txn_id: String(r.txn_id ?? "") })) };
    }
    if (kind === "visa_baseii_sample") {
      const rows = parseVisaBaseII(bytes, filename);
      return { ok: rows.length > 0, message: rows.length ? `Simplified Visa Base II sample parser read ${rows.length} row(s).` : "No Base II rows were parsed.", rows: rows.length, columns: ["txn_id"], sample: rows.slice(0, 3).map((r) => ({ txn_id: String(r.txn_id ?? "") })) };
    }
    if (/\.xlsx$/i.test(filename) || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      return { ok: false, message: "Native .xlsx parsing is planned. Export the workbook to CSV and retry.", rows: 0, columns: [], sample: [] };
    }
    if (looksBinary(bytes) && kind === "csv") {
      return { ok: false, message: "The sample looks binary. CSV text is supported; this binary format is not treated as a success.", rows: 0, columns: [], sample: [] };
    }
    const { columns, rows } = csvParse(text, delimiter);
    if (!columns.length) return { ok: false, message: "No delimited rows were found in the sample.", rows: 0, columns: [], sample: [] };
    return { ok: true, message: `Parsed ${rows.length} data row(s) and ${columns.length} column(s) from a delimited text sample.`, rows: rows.length, columns, sample: rows.slice(0, 5) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), rows: 0, columns: [], sample: [] };
  }
}
