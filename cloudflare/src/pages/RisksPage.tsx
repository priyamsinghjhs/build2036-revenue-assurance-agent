import { useEffect, useState } from "react";
import { api } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

type Payload = {
  risks: { risk_id: string; title: string; category: string; inherent: number | string; residual: number | string; owner: string; controls: number; findings: number; exposure: number }[];
  gaps: { risk_id: string; title: string; inherent: number | string; residual: number | string; owner: string }[];
};

export default function RisksPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.risks().then(setData).catch((e)=>setError(e instanceof Error?e.message:String(e))); }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading risk library…</p>;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Risk library</h1>
        <p className="text-sm text-muted">Risks mapped to controls and findings. Coverage gaps are risks without a passing control or with open findings.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Risks" value={String(data.risks.length)} />
        <KpiCard label="Coverage gaps" value={String(data.gaps.length)} tone={data.gaps.length?"warn":"ok"} />
        <KpiCard label="Linked exposure" value={inr(data.risks.reduce((s,r)=>s+Number(r.exposure||0),0), true)} tone="leak" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Inherent vs residual score (1–5) after mapped controls.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="pb-2 pr-3">Risk</th><th className="pb-2 pr-3">Category</th><th className="pb-2 pr-3">Owner</th><th className="pb-2 pr-3 text-right">Inherent</th><th className="pb-2 pr-3 text-right">Residual</th><th className="pb-2 pr-3 text-right">Controls</th><th className="pb-2 text-right">Exposure</th>
            </tr></thead>
            <tbody>
              {data.risks.map((r)=>(
                <tr key={r.risk_id} className="border-t border-line">
                  <td className="max-w-[260px] truncate py-2 pr-3" title={r.title}>{r.title}</td>
                  <td className="py-2 pr-3 capitalize">{r.category}</td>
                  <td className="py-2 pr-3">{r.owner}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.inherent}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.residual}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.controls} · {r.findings} findings</td>
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
