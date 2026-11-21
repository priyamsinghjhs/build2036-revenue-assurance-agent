import type { AppDb } from "./pg";

export type TraceStep = {
  hop: string;
  ts: string | null;
  ref: string;
  status: string;
  amount: number | null;
  detail: string;
};

export type TraceResult = {
  query: string;
  resolved: { kind: string; id: string; merchant_id: string | null } | null;
  steps: TraceStep[];
};

async function first(db: AppDb, sql: string, ...bind: unknown[]) {
  return db.prepare(sql).bind(...bind).first<Record<string, unknown>>();
}
export async function traceJourney(db: AppDb, raw: string): Promise<TraceResult> {
  const q = raw.trim();
  if (!q) return { query: q, resolved: null, steps: [] };

  let authId: string | null = null;
  let captureId: string | null = null;
  let merchantId: string | null = null;
  let kind = "unknown";
  let id = q;

  const auth = await first(db, "SELECT auth_id, merchant_id, ts, amount, status, method, scheme FROM ra_authorizations WHERE auth_id = ? OR recon_ref = ? LIMIT 1", q, q);
  if (auth) {
    authId = String(auth.auth_id);
    merchantId = auth.merchant_id ? String(auth.merchant_id) : null;
    kind = "authorization";
    id = authId;
  }
  if (!authId) {
    const cap = await first(db, "SELECT capture_id, auth_id, ts, amount FROM ra_captures WHERE capture_id = ? LIMIT 1", q);
    if (cap) {
      captureId = String(cap.capture_id);
      authId = cap.auth_id ? String(cap.auth_id) : null;
      kind = "capture";
      id = captureId;
      if (authId) {
        const a = await first(db, "SELECT merchant_id FROM ra_authorizations WHERE auth_id = ?", authId);
        merchantId = a?.merchant_id ? String(a.merchant_id) : null;
      }
    }
  }
  if (!authId) {
    const gw = await first(db, "SELECT auth_id, log_id FROM ra_gateway_logs WHERE log_id = ? OR gateway_ref = ? LIMIT 1", q, q);
    if (gw?.auth_id) { authId = String(gw.auth_id); kind = "gateway"; id = String(gw.log_id); }
  }
  if (!authId) {
    const sw = await first(db, "SELECT auth_id, switch_id FROM ra_switch_logs WHERE switch_id = ? OR rrn = ? LIMIT 1", q, q);
    if (sw?.auth_id) { authId = String(sw.auth_id); kind = "switch"; id = String(sw.switch_id); }
  }
  if (!authId && q.startsWith("SET-")) {
    const b = await first(db, "SELECT batch_id, merchant_id, cut_off, net_stated, status FROM ra_settlement_batches WHERE batch_id = ?", q);
    if (b) {
      merchantId = String(b.merchant_id);
      kind = "settlement";
      id = String(b.batch_id);
    }
  }
  if (!authId && q.startsWith("FND-")) {
    const f = await first(db, "SELECT funding_id, batch_id, merchant_id FROM ra_funding_transfers WHERE funding_id = ?", q);
    if (f) {
      merchantId = String(f.merchant_id);
      kind = "funding";
      id = String(f.funding_id);
    }
  }
  if (!authId && q.startsWith("INV-")) {
    const inv = await first(db, "SELECT invoice_id, merchant_id FROM ra_fin_invoices WHERE invoice_id = ?", q);
    if (inv) {
      merchantId = String(inv.merchant_id);
      kind = "invoice";
      id = String(inv.invoice_id);
    }
  }
  if (authId && !merchantId) {
    const a = await first(db, "SELECT merchant_id FROM ra_authorizations WHERE auth_id = ?", authId);
    merchantId = a?.merchant_id ? String(a.merchant_id) : null;
  }

  const steps: TraceStep[] = [];
  function add(hop: string, ts: unknown, ref: unknown, status: unknown, amount: unknown, detail: string) {
    steps.push({
      hop,
      ts: ts ? String(ts) : null,
      ref: ref ? String(ref) : "—",
      status: status ? String(status) : "missing",
      amount: amount == null ? null : Number(amount),
      detail,
    });
  }

  if (authId) {
    const a = await first(db, "SELECT * FROM ra_authorizations WHERE auth_id = ?", authId);
    if (a) add("authorization", a.ts, a.auth_id, a.status, a.amount, `${a.method ?? ""} ${a.scheme ?? ""}`.trim());
    const gw = await first(db, "SELECT * FROM ra_gateway_logs WHERE auth_id = ? LIMIT 1", authId);
    if (gw) add("gateway", gw.ts, gw.log_id, gw.status, gw.amount, String(gw.gateway_ref ?? ""));
    else add("gateway", null, "—", "missing", null, "No gateway log for this auth");
    const sw = await first(db, "SELECT * FROM ra_switch_logs WHERE auth_id = ? LIMIT 1", authId);
    if (sw) add("switch", sw.ts, sw.switch_id, sw.response_code, sw.amount, `RRN ${sw.rrn ?? ""}`);
    else add("switch", null, "—", "missing", null, "No switch log for this auth");
    const cap = await first(db, "SELECT * FROM ra_captures WHERE auth_id = ? LIMIT 1", authId);
    if (cap) {
      captureId = String(cap.capture_id);
      add("capture", cap.ts, cap.capture_id, "captured", cap.amount, "");
    } else add("capture", null, "—", "missing", null, "Not captured");
    if (captureId) {
      const cl = await first(db, "SELECT * FROM ra_clearing_records WHERE capture_id = ? LIMIT 1", captureId);
      if (cl) add("clearing", cl.clearing_date, cl.rec_id, cl.direction, cl.net, cl.file_id ? String(cl.file_id) : "");
      else add("clearing", null, "—", "missing", null, "Not in clearing");
      const sch = await first(db, "SELECT * FROM ra_scheme_settlements WHERE capture_id = ? LIMIT 1", captureId);
      if (sch) add("scheme", sch.settlement_date, sch.scheme_id, "settled", sch.net, String(sch.scheme ?? ""));
      else add("scheme", null, "—", "missing", null, "No scheme settlement");
    }
  }

  if (merchantId) {
    if (authId) {
      const a = await first(db, "SELECT ts FROM ra_authorizations WHERE auth_id = ?", authId);
      const day = a?.ts ? String(a.ts).slice(0, 10) : null;
      if (day) {
        const b = await first(
          db,
          "SELECT * FROM ra_settlement_batches WHERE merchant_id = ? AND period_start <= ? AND cut_off >= ? LIMIT 1",
          merchantId, day, day,
        );
        if (b) {
          add("settlement", b.cut_off, b.batch_id, b.status, b.net_stated, `txns ${b.txn_count}`);
          const f = await first(db, "SELECT * FROM ra_funding_transfers WHERE batch_id = ? LIMIT 1", b.batch_id);
          if (f) add("funding", f.value_date ?? f.instructed_at, f.funding_id, f.status, f.amount, String(f.rail ?? ""));
          else add("funding", null, "—", "pending", null, "No funding instruction for this batch");
        } else add("settlement", day, "—", "missing", null, "No settlement batch covering this date");
      }
    } else {
      const b = await first(db, "SELECT * FROM ra_settlement_batches WHERE merchant_id = ? ORDER BY cut_off DESC LIMIT 1", merchantId);
      if (b) add("settlement", b.cut_off, b.batch_id, b.status, b.net_stated, "Latest batch for merchant");
    }
    const inv = await first(db, "SELECT * FROM ra_fin_invoices WHERE merchant_id = ? ORDER BY invoice_date DESC LIMIT 1", merchantId);
    if (inv) add("invoice", inv.invoice_date, inv.invoice_id, inv.status, inv.total, `GST ${inv.gst_amount}`);
    const cash = await first(
      db,
      "SELECT * FROM ra_cash_receipts WHERE merchant_id = ? ORDER BY receipt_date DESC LIMIT 1",
      merchantId,
    ).catch(() => null);
    if (cash) add("cash", cash.receipt_date ?? cash.ts, cash.receipt_id, "received", cash.amount, "");
    const gl = await first(
      db,
      "SELECT * FROM ra_gl_journals WHERE source_ref = ? OR source_ref = ? OR source_ref LIKE ? LIMIT 1",
      id, authId ?? "", (merchantId ? `%${merchantId}%` : id),
    ).catch(() => null);
    if (gl) add("gl", gl.je_date, gl.journal_id, Number(gl.posted) === 1 ? "posted" : "unposted", null, String(gl.memo ?? gl.source_system ?? ""));
    else add("gl", null, "—", "not_found", null, "No journal found for this reference");
  }

  if (!steps.length) return { query: q, resolved: null, steps: [] };
  return { query: q, resolved: { kind, id, merchant_id: merchantId }, steps };
}
