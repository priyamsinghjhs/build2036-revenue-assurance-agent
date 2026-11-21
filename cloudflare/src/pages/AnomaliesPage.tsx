import { useEffect, useMemo, useState } from "react";
import { api, type AnomalyPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

export default function AnomaliesPage() {
  const [data, setData] = useState<AnomalyPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  useEffect(() => { api.anomalies().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const keys = Array.from(new Set(data.series.map((s) => `${s.metric}::${s.segment}`)));
    return keys.map((k) => {
      const [metric, segment] = k.split("::");
      const rows = data.series.filter((s) => s.metric===metric && s.segment===segment);
      return { metric, segment, rows };
    }).filter((g) => g.rows.some((r) => Number(r.is_anomaly)===1) || ["approval_rate","fee_ratio","settlement_latency","refund_cb_ratio"].includes(g.metric));
  }, [data]);

  async function investigate(id: string) {
    setBusy(true); setError("");
    try {
      const r = await api.investigateAnomaly(id);
      setResult(r.exception_id ? `Investigated ${r.event_id} → ${r.exception_id}` : "Skipped");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading anomaly sensors…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Anomalies</h1>
        <p className="text-sm text-muted">{data.note}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Open events" value={String(data.events.length)} tone="warn" />
        <KpiCard label="Featured sensors" value="4" hint="Approval, fee ratio, latency, refund/CB" />
        <KpiCard label="Cron behaviour" value="Top-1" hint="An open event triggers one investigation, inside the neuron budget" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Detected events</CardTitle>
          <CardDescription>Statistical flags. Investigate runs the on-demand investigator pipeline.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="pb-2 pr-3">Event</th><th className="pb-2 pr-3">Day</th><th className="pb-2 pr-3 text-right">Value</th><th className="pb-2 pr-3 text-right">z</th><th className="pb-2 pr-3 text-right">Impact</th><th className="pb-2">Action</th>
            </tr></thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.event_id} className="border-t border-line">
                  <td className="py-2 pr-3">{e.metric.replace(/_/g," ")} · {e.segment}</td>
                  <td className="py-2 pr-3">{String(e.day).slice(0,10)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(e.value).toFixed(3)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(e.zscore||0).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(e.impact||0), true)}</td>
                  <td className="py-2"><Button size="sm" disabled={busy} onClick={() => void investigate(String(e.event_id))}>Investigate</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && <p className="mt-3 text-xs text-muted">{result}</p>}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.slice(0, 8).map((g) => (
          <Card key={g.metric+"-"+g.segment}>
            <CardHeader>
              <CardTitle className="truncate text-sm">{g.metric.replace(/_/g," ")} · {g.segment}</CardTitle>
              <CardDescription>Sparkline with EWMA band</CardDescription>
            </CardHeader>
            <CardContent>
              <Spark rows={g.rows} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Spark({ rows }: { rows: AnomalyPayload["series"] }) {
  const w=520, h=96, pad=6;
  const ys = rows.map((r) => [Number(r.band_lo??r.value), Number(r.value), Number(r.band_hi??r.value)]).flat();
  const min=Math.min(...ys), max=Math.max(...ys);
  const sx=(i:number)=> pad + (i/(Math.max(rows.length-1,1)))*(w-pad*2);
  const sy=(v:number)=> h-pad - ((v-min)/Math.max(max-min,1e-9))*(h-pad*2);
  const line=rows.map((r,i)=>`${i?"L":"M"}${sx(i).toFixed(1)} ${sy(Number(r.value)).toFixed(1)}`).join(" ");
  const band=rows.map((r,i)=>`${i?"L":"M"}${sx(i).toFixed(1)} ${sy(Number(r.band_hi??r.value)).toFixed(1)}`).join(" ")
    +" "+[...rows].reverse().map((r,i)=>`${i?"L":"L"}${sx(rows.length-1-i).toFixed(1)} ${sy(Number(r.band_lo??r.value)).toFixed(1)}`).join(" ")+" Z";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible text-accent" role="img">
      <path d={band} fill="#93c5fd55" stroke="none" />
      <path d={line} fill="none" stroke="#1d4ed8" strokeWidth="1.6" />
      {rows.map((r,i) => Number(r.is_anomaly)===1 ? <circle key={i} cx={sx(i)} cy={sy(Number(r.value))} r="3" fill="#b91c1c" /> : null)}
    </svg>
  );
}
