/**
 * Load open reference / TabFormer / IBM AML tables into Neon.
 * Reads prepared files from DATA_DIR (default /tmp/ra-open-data).
 * Never prints the database URL or other secrets.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getSql, applySqlFile, dbSize, upsertDataset, chunk } from "./db.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DATA = process.env.DATA_DIR || "/tmp/ra-open-data";

const ISO4217 = [
  ["INR","Indian Rupee","356",2],["USD","US Dollar","840",2],["EUR","Euro","978",2],
  ["GBP","Pound Sterling","826",2],["JPY","Yen","392",0],["AED","UAE Dirham","784",2],
  ["SGD","Singapore Dollar","702",2],["AUD","Australian Dollar","036",2],["CAD","Canadian Dollar","124",2],
  ["CHF","Swiss Franc","756",2],["CNY","Yuan Renminbi","156",2],["HKD","Hong Kong Dollar","344",2],
  ["THB","Baht","764",2],["MYR","Malaysian Ringgit","458",2],["NPR","Nepalese Rupee","524",2],
  ["BDT","Taka","050",2],["LKR","Sri Lanka Rupee","144",2],["SAR","Saudi Riyal","682",2],
  ["QAR","Qatari Rial","634",2],["KWD","Kuwaiti Dinar","414",3],["OMR","Rial Omani","512",3],
  ["BHD","Bahraini Dinar","048",3],["ZAR","Rand","710",2],["KRW","Won","410",0],
  ["NZD","New Zealand Dollar","554",2],["SEK","Swedish Krona","752",2],["NOK","Norwegian Krone","578",2],
  ["DKK","Danish Krone","208",2],["PLN","Zloty","985",2],["TRY","Turkish Lira","949",2],
  ["RUB","Russian Ruble","643",2],["BRL","Brazilian Real","986",2],["MXN","Mexican Peso","484",2],
  ["IDR","Rupiah","360",2],["PHP","Philippine Peso","608",2],["VND","Dong","704",0],
  ["PKR","Pakistan Rupee","586",2],["EGP","Egyptian Pound","818",2],["NGN","Naira","566",2],
  ["KES","Kenyan Shilling","404",2],
];

function csvParse(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function money(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

async function insertChunked(sql, table, columns, rows, chunkSize = 150) {
  if (!rows.length) return 0;
  let n = 0;
  const colList = columns.join(", ");
  for (const part of chunk(rows, chunkSize)) {
    const params = [];
    const values = part.map((row, i) => {
      const off = i * columns.length;
      for (const v of row) params.push(v);
      return `(${columns.map((_, j) => `$${off + j + 1}`).join(",")})`;
    });
    await sql.query(
      `INSERT INTO ${table} (${colList}) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
      params,
    );
    n += part.length;
  }
  return n;
}

async function main() {
  const sql = getSql();
  const schema = readFileSync(resolve(ROOT, "postgres/012_open_data.sql"), "utf8");
  await applySqlFile(sql, schema);
  console.log("schema applied");

  // ISO 4217 short list
  await insertChunked(
    sql,
    "ra_open_iso4217",
    ["code", "name", "numeric_code", "minor_units"],
    ISO4217,
  );
  const isoN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_iso4217"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "iso4217",
    title: "ISO 4217 currency codes (short list)",
    source_name: "ISO 4217",
    source_url: "https://www.iso.org/iso-4217-currency-codes.html",
    license: "ISO standard short list for operational use",
    attribution: "Currency codes from ISO 4217.",
    notes: "A short operational list of widely used currencies, not the complete official table.",
    row_count: isoN,
  });
  console.log("iso4217", isoN);

  // MCC
  const mccPath = resolve(DATA, "mcc_codes.csv");
  if (existsSync(mccPath)) {
    const rows = csvParse(readFileSync(mccPath, "utf8"));
    const header = rows[0].map((h) => h.trim());
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const body = rows.slice(1).map((r) => [
      String(r[idx.mcc] ?? "").padStart(4, "0"),
      r[idx.edited_description] ?? null,
      r[idx.combined_description] ?? null,
      r[idx.usda_description] ?? null,
      r[idx.irs_description] ?? null,
      r[idx.irs_reportable] ?? null,
    ]).filter((r) => r[0] && r[0] !== "0000");
    await insertChunked(sql, "ra_open_mcc",
      ["mcc","edited_description","combined_description","usda_description","irs_description","irs_reportable"],
      body);
  }
  const mccN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_mcc"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "mcc",
    title: "Merchant Category Codes",
    source_name: "greggles/mcc-codes",
    source_url: "https://github.com/greggles/mcc-codes",
    license: "Unlicense",
    license_url: "https://github.com/greggles/mcc-codes/blob/master/LICENSE",
    attribution: "MCC descriptions from the greggles/mcc-codes project (Unlicense).",
    notes: "Used to label merchant category codes. Not a source of rupee book leakage.",
    row_count: mccN,
  });
  console.log("mcc", mccN);

  // ECB FX
  const ecbPath = resolve(DATA, "ecb_exr.csv");
  if (existsSync(ecbPath)) {
    const rows = csvParse(readFileSync(ecbPath, "utf8"));
    const header = rows[0];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const raw = [];
    const byDay = new Map();
    for (const r of rows.slice(1)) {
      if ((r[idx.EXR_TYPE] || "") !== "SP00") continue;
      const day = r[idx.TIME_PERIOD];
      const ccy = r[idx.CURRENCY];
      const rate = Number(r[idx.OBS_VALUE]);
      if (!day || !ccy || !Number.isFinite(rate)) continue;
      raw.push([day, `EUR${ccy}`, ccy, rate, `EUR${ccy}`, 0, "ECB", "Source: ECB statistics"]);
      const rec = byDay.get(day) ?? {};
      rec[ccy] = rate;
      byDay.set(day, rec);
    }
    const computed = [];
    for (const [day, rec] of byDay) {
      const usd = rec.USD, inr = rec.INR, gbp = rec.GBP;
      if (usd && inr) computed.push([day, "USDINR", "INR", inr / usd, "USDINR", 1, "ECB", "Source: ECB statistics; USD/INR computed from USD and INR vs EUR"]);
      if (usd && gbp) computed.push([day, "GBPUSD", "USD", usd / gbp, "GBPUSD", 1, "ECB", "Source: ECB statistics; GBP/USD computed from GBP and USD vs EUR"]);
      if (usd) computed.push([day, "EURUSD", "USD", usd, "EURUSD", 0, "ECB", "Source: ECB statistics"]);
      if (inr) computed.push([day, "EURINR", "INR", inr, "EURINR", 0, "ECB", "Source: ECB statistics"]);
    }
    await insertChunked(sql, "ra_open_fx_ecb",
      ["day","series_id","currency","rate","quote","computed","source","attribution"],
      raw.concat(computed), 120);
  }
  const fxN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_fx_ecb"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "ecb_fx",
    title: "ECB euro foreign-exchange reference rates",
    source_name: "European Central Bank",
    source_url: "https://data.ecb.europa.eu/data/data-set/EXR",
    license: "ECB copyright; free reuse with attribution",
    license_url: "https://www.ecb.europa.eu/copyright/html/index.en.html",
    attribution: "Source: ECB statistics.",
    notes: "Official ECB reference rates vs EUR, plus computed USD/INR and GBP/USD crosses. Used only to label open USD amounts; never booked as INR leakage.",
    row_count: fxN,
  });
  console.log("ecb_fx", fxN);

  // Razorpay IFSC
  const banksPath = resolve(DATA, "banks.json");
  const namesPath = resolve(DATA, "banknames.json");
  if (existsSync(banksPath)) {
    const banks = JSON.parse(readFileSync(banksPath, "utf8"));
    const names = existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, "utf8")) : {};
    const rows = Object.entries(banks).map(([code, rec]) => [
      code,
      names[code] ?? rec.name ?? null,
      rec.type ?? null,
      rec.ifsc ?? null,
      rec.micr ?? null,
      rec.iin ?? null,
      JSON.stringify(rec),
    ]);
    await insertChunked(sql, "ra_open_ifsc_banks",
      ["bank_code","name","type","ifsc","micr","iin","details_json"], rows, 80);
    const sample = rows.filter((r) => r[3]).map((r) => [r[3], r[0], r[1], null]);
    await insertChunked(sql, "ra_open_ifsc_sample",
      ["ifsc","bank_code","bank_name","branch_code"], sample, 150);
  }
  const ifscN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_ifsc_banks"))[0].n;
  const ifscS = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_ifsc_sample"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "razorpay_ifsc",
    title: "Indian Financial System Codes (bank directory)",
    source_name: "razorpay/ifsc",
    source_url: "https://github.com/razorpay/ifsc",
    license: "public-domain-data; MIT-code",
    license_url: "https://github.com/razorpay/ifsc",
    attribution: "Bank and IFSC directory from razorpay/ifsc (data treated as public-domain; code is MIT).",
    notes: `Bank-level directory (${ifscN} banks) plus one sample IFSC per bank (${ifscS} rows). Not a complete live branch master.`,
    row_count: ifscN + ifscS,
  });
  console.log("ifsc_banks", ifscN, "sample", ifscS);

  // RBI PSI if parsed CSV exists
  const psiPath = resolve(DATA, "rbi_psi_rows.csv");
  if (existsSync(psiPath)) {
    const rows = csvParse(readFileSync(psiPath, "utf8"));
    const body = rows.slice(1).map((r) => [r[0], r[1], money(r[2]), money(r[3]), r[4] || null, r[5] || null]);
    await insertChunked(sql, "ra_open_rbi_psi",
      ["period","instrument","volume","value_inr_crore","unit_note","source_file"], body);
    const upi = body.filter((r) => /upi/i.test(String(r[1] || ""))).map((r) => [
      r[0], r[2], r[3], "RBI Payment System Indicators",
      "Source: Reserve Bank of India, Payment System Indicators", null,
    ]);
    if (upi.length) {
      await insertChunked(sql, "ra_open_npci_upi",
        ["period","volume","value_inr_crore","source","attribution","notes"], upi);
    }
  }
  const psiN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_rbi_psi"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "rbi_psi",
    title: "RBI Payment System Indicators",
    source_name: "Reserve Bank of India",
    source_url: "https://www.rbi.org.in/Scripts/PSIUserView.aspx",
    license: "RBI copyright; official statistics, attribution required",
    attribution: "Source: Reserve Bank of India, Payment System Indicators.",
    notes: psiN
      ? "Monthly payment-system volumes and values. UPI rows are also copied to ra_open_npci_upi."
      : "Official XLSX/PDF on rbidocs.rbi.org.in were blocked by a bot challenge from this environment, so the table is empty pending a successful fetch.",
    row_count: psiN,
  });
  console.log("rbi_psi", psiN);

  // FX lookup for TabFormer INR labels
  const fxRows = await sql.query(`SELECT day::text AS day, rate FROM ra_open_fx_ecb WHERE series_id='USDINR' ORDER BY day`);
  const fxByDay = new Map(fxRows.map((r) => [String(r.day).slice(0, 10), Number(r.rate)]));
  const fxDays = [...fxByDay.keys()].sort();
  function usdInrOn(iso) {
    if (!iso || !fxDays.length) return { day: null, rate: null };
    if (fxByDay.has(iso)) return { day: iso, rate: fxByDay.get(iso) };
    let lo = 0, hi = fxDays.length - 1, ans = fxDays[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fxDays[mid] <= iso) { ans = fxDays[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return { day: ans, rate: fxByDay.get(ans) };
  }

  // TabFormer 100k slice
  const tfPath = resolve(DATA, "tabformer_100k.csv");
  if (existsSync(tfPath)) {
    const rows = csvParse(readFileSync(tfPath, "utf8"));
    const header = rows[0];
    const i = Object.fromEntries(header.map((h, k) => [h, k]));
    const auths = [];
    const merchants = new Map();
    for (const r of rows.slice(1)) {
      const merchantName = String(r[i["Merchant Name"]] ?? "unknown");
      const mid = `TFM-${merchantName.slice(0, 40)}`;
      const mcc = String(r[i.MCC] ?? "").replace(/\.0$/, "");
      if (!merchants.has(mid)) {
        merchants.set(mid, [mid, merchantName, mcc || null, r[i["Merchant City"]] || null, r[i["Merchant State"]] || null, r[i.Zip] || null]);
      }
      const year = r[i.Year], month = r[i.Month], day = r[i.Day], time = r[i.Time] || "00:00";
      const ts = year && month && day
        ? `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${time}`
        : null;
      const iso = ts ? ts.slice(0, 10) : null;
      const fx = usdInrOn(iso);
      const amount = money(r[i.Amount]);
      const fraud = String(r[i["Is Fraud?"]] || "").toLowerCase().startsWith("y") ? 1 : 0;
      const errors = String(r[i["Errors?"]] || "").trim();
      const authId = `TF-${r[i.User] ?? "u"}-${r[i.Card] ?? "c"}-${iso || "d"}-${time}-${auths.length}`;
      auths.push([
        authId, mid, r[i.User] != null ? String(r[i.User]) : null, r[i.Card] != null ? String(r[i.Card]) : null,
        ts, amount, "USD",
        amount != null && fx.rate ? Number((amount * fx.rate).toFixed(2)) : null,
        fx.day, fx.rate,
        fx.rate ? "INR label only; USD original; rate from ECB USD/INR (computed). Not booked as INR leakage." : "No ECB USD/INR for this date.",
        r[i["Use Chip"]] || null, mcc || null,
        errors ? "declined" : "approved",
        errors || null,
        fraud,
        errors && !fraud ? 1 : 0,
        r[i["Use Chip"]] || null,
        r[i["Merchant City"]] || null,
        r[i["Merchant State"]] || null,
      ]);
    }
    await insertChunked(sql, "ra_open_tabformer_merchants",
      ["merchant_id","name","mcc","city","state","zip"], [...merchants.values()], 100);
    await insertChunked(sql, "ra_open_tabformer_auth",
      ["auth_id","merchant_id","user_id","card_id","ts","amount","currency","amount_inr_labelled","inr_fx_day","inr_fx_rate","inr_fx_note","method","mcc","status","decline_reason","is_fraud","is_false_decline_weak","use_chip","merchant_city","merchant_state"],
      auths, 100);
  }
  const tfN = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_tabformer_auth"))[0].n;
  const tfM = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_tabformer_merchants"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "tabformer",
    title: "TabFormer synthetic card transactions (USD slice)",
    source_name: "IBM TabFormer",
    source_url: "https://github.com/IBM/TabFormer",
    license: "Apache-2.0",
    license_url: "https://github.com/IBM/TabFormer/blob/main/LICENSE",
    attribution: "Padhi et al., Tabular Transformers for Modeling Multivariate Time Series (ICASSP 2021). Data: IBM TabFormer credit-card transactions (Apache-2.0).",
    notes: `A ${tfN}-row USD slice with ${tfM} merchants, kept in ra_open_tabformer_* and excluded from the INR book and leakage KPIs. INR amounts are ECB-labelled only.`,
    row_count: tfN,
    bytes_estimate: existsSync(tfPath) ? statSync(tfPath).size : null,
  });
  console.log("tabformer_auth", tfN, "merchants", tfM);

  // IBM AML slice
  const amlPath = resolve(DATA, "aml_30k.csv");
  if (existsSync(amlPath)) {
    const rows = csvParse(readFileSync(amlPath, "utf8"));
    const header = rows[0];
    const i = Object.fromEntries(header.map((h, k) => [h, k]));
    const edges = [];
    const accounts = new Map();
    let n = 0;
    for (const r of rows.slice(1)) {
      n += 1;
      const fromA = String(r[i.from_account] ?? "");
      const toA = String(r[i.to_account] ?? "");
      const fromB = r[i.from_bank] ?? null;
      const toB = r[i.to_bank] ?? null;
      if (fromA && !accounts.has(fromA)) accounts.set(fromA, [fromA, fromB]);
      if (toA && !accounts.has(toA)) accounts.set(toA, [toA, toB]);
      edges.push([
        `AML-E-${n}`,
        r[i.ts] ?? null, fromA, fromB, toA, toB,
        money(r[i.amount_received]), r[i.receiving_currency] || null,
        money(r[i.amount_paid]), r[i.payment_currency] || null,
        r[i.payment_format] || null,
        String(r[i.is_laundering] || "0").trim() === "1" ? 1 : 0,
        1,
      ]);
    }
    await insertChunked(sql, "ra_open_aml_accounts", ["account_id","bank"], [...accounts.values()], 200);
    await insertChunked(sql, "ra_open_aml_edges",
      ["edge_id","ts","from_account","from_bank","to_account","to_bank","amount_received","receiving_currency","amount_paid","payment_currency","payment_format","is_laundering","in_seed"],
      edges, 120);
  }
  const amlE = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_aml_edges"))[0].n;
  const amlA = (await sql.query("SELECT COUNT(*)::int n FROM ra_open_aml_accounts"))[0].n;
  await upsertDataset(sql, {
    dataset_id: "ibm_aml",
    title: "IBM AML transaction edges (CDLA-Sharing slice)",
    source_name: "IBM Transactions for Anti-Money Laundering",
    source_url: "https://github.com/IBM/AML-Data",
    license: "CDLA-Sharing-1.0",
    license_url: "https://cdla.dev/sharing-1-0/",
    attribution: "IBM Transactions for Anti Money Laundering (AML) dataset, Community Data License Agreement – Sharing, Version 1.0 (CDLA-Sharing-1.0). Synthetic transaction graph; exposure only, never booked as INR leakage.",
    notes: `A ${amlE}-edge connected slice (${amlA} accounts) including all HI-Small laundering edges plus 1-hop context. Scores live in ra_open_aml_scores.`,
    row_count: amlE,
    bytes_estimate: existsSync(amlPath) ? statSync(amlPath).size : null,
  });
  console.log("aml_edges", amlE, "accounts", amlA);

  const size = await dbSize(sql);
  const tables = await sql.query(`
    SELECT c.relname AS table, pg_total_relation_size(c.oid)::bigint AS bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'ra_open%'
    ORDER BY 2 DESC
  `);
  console.log("db_size", size.pretty, "mb", (Number(size.bytes) / 1048576).toFixed(1));
  for (const t of tables) console.log("size", t.table, t.pretty);
}

main().catch((err) => {
  console.error("LOAD_FAILED", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
