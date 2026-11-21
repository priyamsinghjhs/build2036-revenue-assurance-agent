import { useState } from "react";
import { api, type AskResult } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const EXAMPLES = [
  "Which domains have the most leakage?",
  "Show unapplied contract rebate exceptions",
  "List open cases with leakage over 10000",
];

export default function AskPage() {
  const [q, setQ] = useState(EXAMPLES[0]);
  const [data, setData] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(question = q) {
    setBusy(true); setError("");
    try { setData(await api.ask(question)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const rows = data?.rows ?? [];
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const numeric = keys.filter((k) => rows.every((r) => r[k]==null || typeof r[k]==="number" || (typeof r[k]==="string" && r[k]!=="" && !Number.isNaN(Number(r[k])))));
  const labelKey = keys.find((k) => !numeric.includes(k)) ?? keys[0];
  const valueKey = numeric.find((k) => k!==labelKey) ?? numeric[0];
  const max = valueKey ? Math.max(...rows.map((r) => Number(r[valueKey]||0)), 1) : 1;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ask your data</h1>
        <p className="text-sm text-muted">Natural-language questions become a validated, SELECT-only query against allow-listed views, with a 200-row cap, 3s timeout and a Neon read-only role. Generated SQL is always shown.</p>
      </header>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label className="min-w-[16rem] flex-1 text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Question</span>
          <input value={q} onChange={(e)=>setQ(e.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm" />
        </label>
        <Button type="submit" disabled={busy || !q.trim()}>{busy ? "Asking…" : "Ask"}</Button>
      </form>
      <div className="flex flex-wrap gap-2 text-xs">
        {EXAMPLES.map((ex) => <button key={ex} type="button" className="rounded-full border border-line px-2 py-1 text-muted hover:text-ink" onClick={() => { setQ(ex); void run(ex); }}>{ex}</button>)}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {data && (
        <>
          <Card>
            <CardHeader><CardTitle>Generated SQL</CardTitle><CardDescription>Status: {data.status}{data.error ? ` · ${data.error}` : ""}</CardDescription></CardHeader>
            <CardContent><pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-ink">{data.sql}</pre></CardContent>
          </Card>
          {!!rows.length && valueKey && labelKey && (
            <Card>
              <CardHeader><CardTitle>Chart</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {rows.slice(0, 12).map((r, i) => (
                  <div key={i} className="min-w-0">
                    <div className="mb-1 flex justify-between gap-3 text-xs">
                      <span className="truncate" title={String(r[labelKey])}>{String(r[labelKey])}</span>
                      <span className="tabular-nums">{String(r[valueKey])}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((Math.abs(Number(r[valueKey]||0))/max)*100))}%` }} /></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {!!rows.length && (
            <Card>
              <CardHeader><CardTitle>Table</CardTitle><CardDescription>{rows.length} rows</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>{keys.map((k)=><th key={k} className="pb-2 pr-3">{k}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 50).map((r,i)=>(
                      <tr key={i} className="border-t border-line">{keys.map((k)=><td key={k} className="max-w-[220px] truncate py-2 pr-3" title={String(r[k]??"")}>{String(r[k]??"—")}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
