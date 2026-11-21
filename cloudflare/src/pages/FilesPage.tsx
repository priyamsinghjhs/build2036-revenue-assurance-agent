import { useEffect, useState } from "react";
import { api } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

type Row = { source: string; expected_day: string; exception_kind: string; exposure: number; filename: string };
type Payload = { files: Row[]; missing: number; oos: number; exposure: number };

export default function FilesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.files().then(setData).catch((e)=>setError(e instanceof Error?e.message:String(e))); }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading file completeness…</p>;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">File completeness</h1>
        <p className="text-sm text-muted">Missing and out-of-sequence scheme, bank and APM daily files. Exposure is operational and is excluded from the book leakage KPI.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Missing files" value={String(data.missing)} tone="warn" />
        <KpiCard label="Out of sequence" value={String(data.oos)} />
        <KpiCard label="Operational exposure" value={inr(Number(data.exposure||0), true)} hint="Not in book KPI" />
      </div>
      <Card>
        <CardHeader><CardTitle>Exceptions</CardTitle><CardDescription>Expected daily arrivals versus received files.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="pb-2 pr-3">Source</th><th className="pb-2 pr-3">Day</th><th className="pb-2 pr-3">Kind</th><th className="pb-2 pr-3">File</th><th className="pb-2 text-right">Exposure</th>
            </tr></thead>
            <tbody>
              {data.files.map((r,i)=>(
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-3">{r.source}</td>
                  <td className="py-2 pr-3">{String(r.expected_day).slice(0,10)}</td>
                  <td className="py-2 pr-3">{r.exception_kind.replace(/_/g," ")}</td>
                  <td className="max-w-[240px] truncate py-2 pr-3">{r.filename ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums">{inr(Number(r.exposure||0), true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
