import { useEffect, useState } from "react";
import { api, type IngestionPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

export default function IngestionPage() {
  const [data, setData] = useState<IngestionPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try { setData(await api.ingestion()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, []);
  async function parse() {
    setBusy(true);
    try { setData(await api.parseIngestion()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (error && !data) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading file ingestion…</p>;
  const keys = ["canonical_id","source_kind","txn_id","payment_rail","scheme","merchant_id","txn_amount","recon_amount","actual_fee","response_code","txn_status"];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">File ingestion</h1>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
        <Button disabled={busy} onClick={() => void parse()}>{busy ? "Re-parsing…" : "Re-parse samples"}</Button>
      </header>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Files parsed" value={String(data.files.filter((f) => f.status==="parsed").length)} hint={`${data.files.length} adapters`} tone="ok" />
        <KpiCard label="Canonical rows" value={String(data.rows.length)} />
        <KpiCard label="Clearing exceptions" value={String(data.exceptions.length)} tone={data.exceptions.length ? "warn" : "ok"} />
        <KpiCard label="Booked leakage" value={inr(Number(data.leakage||0), true)} tone="leak" hint="Counts in the book KPI" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sample files</CardTitle>
          <CardDescription>Deterministic adapters only. camt.053 XML, NPCI UPI / NTSL text, Mastercard IPM (RDW + cp500), Visa BASE II TCR0/1/5 (cp500).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="pb-2 pr-3">File</th><th className="pb-2 pr-3">Kind</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3 text-right">Records</th><th className="pb-2">Notes</th></tr>
            </thead>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.file_id} className="border-t border-line">
                  <td className="max-w-[220px] truncate py-2 pr-3 font-mono text-xs">{f.filename}</td>
                  <td className="py-2 pr-3">{f.kind}</td>
                  <td className="py-2 pr-3 capitalize">{f.status}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{f.record_count}</td>
                  <td className="max-w-[360px] truncate py-2 text-xs text-muted" title={f.notes}>{f.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Canonical settlement rows</CardTitle>
          <CardDescription>Normalised fields used by fee expressions and clearing checks.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>{keys.map((k) => <th key={k} className="pb-2 pr-3">{k}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={String(r.canonical_id ?? i)} className="border-t border-line">
                  {keys.map((k) => <td key={k} className="max-w-[160px] truncate py-2 pr-3" title={String(r[k] ?? "")}>{String(r[k] ?? "—")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Clearing checks</CardTitle>
          <CardDescription>
            Deemed-approved / timeout MDR, interchange downgrade (TCR5), FX markup (DE4 vs DE5), intermediary charges (ChrgsInf),
            RuPay Credit on UPI above ₹{data.rates.rupay_credit_threshold.toLocaleString("en-IN")} at {data.rates.rupay_credit_mdr_bps} bps,
            and PPI interchange {data.rates.ppi_interchange_pct}% on eligible MCCs. These rates are illustrative.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="pb-2 pr-3">Exception</th><th className="pb-2 pr-3">Category</th><th className="pb-2 pr-3">Merchant</th><th className="pb-2 pr-3 text-right">Expected</th><th className="pb-2 pr-3 text-right">Actual</th><th className="pb-2 text-right">Leakage</th></tr>
            </thead>
            <tbody>
              {data.exceptions.map((e, i) => (
                <tr key={String(e.ref_id ?? i)} className="border-t border-line">
                  <td className="max-w-[200px] truncate py-2 pr-3 font-mono text-xs">{String(e.ref_id ?? e.recon_ref ?? "")}</td>
                  <td className="py-2 pr-3">{String(e.category ?? "").replace(/_/g," ")}</td>
                  <td className="py-2 pr-3">{String(e.merchant_id ?? "—")}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(e.expected_amount||0), true)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(e.actual_amount||0), true)}</td>
                  <td className="py-2 text-right tabular-nums text-danger">{inr(Number(e.leakage||0), true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
