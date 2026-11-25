import { useEffect, useState } from "react";
import { api, type RoutingPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, pct } from "@/lib/format";

export default function RoutingPage() {
  const [data, setData] = useState<RoutingPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.routing().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  async function run() {
    setBusy(true);
    try { setData(await api.simulateRouting()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading routing simulation…</p>;
  const th = data.policies.find((p) => p.policy==="thompson") ?? data.policies[0];
  const segs = data.segments.filter((s) => s.segment_kind==="scheme");
  const max = Math.max(...segs.map((s) => Math.abs(Number(s.approval_uplift))), 0.01);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Routing optimisation</h1>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">Simulation · synthetic data</span>
      </header>
      {th && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Current approval" value={pct(Number(th.approval_current))} />
          <KpiCard label="Simulated approval" value={pct(Number(th.approval_sim))} tone="ok" hint="Thompson sampling" />
          <KpiCard label="Uplift (95% CI)" value={pct(Number(th.approval_uplift))} hint={`${pct(Number(th.uplift_lo))} – ${pct(Number(th.uplift_hi))}`} tone="ok" />
          <KpiCard label="Fee delta" value={inr(Number(th.fee_savings), true)} hint="Negative = slightly higher acquirer fees" tone={Number(th.fee_savings)>=0?"ok":"warn"} />
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run()}>{busy ? "Re-running…" : "Run simulation"}</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Approval uplift by scheme</CardTitle>
          <CardDescription>Thompson policy versus current merchant-acquirer routing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {segs.map((s) => (
            <div key={String(s.segment)} className="min-w-0">
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate font-medium">{s.segment} · {s.n} auths</span>
                <span className="tabular-nums">{pct(Number(s.approval_uplift))} · {inr(Number(s.fee_savings), true)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((Math.abs(Number(s.approval_uplift))/max)*100))}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {data.retry && (
        <Card>
          <CardHeader>
            <CardTitle>Dynamic retry (fee-aware Thompson replay)</CardTitle>
            <CardDescription>{data.retry.note || "Deterministic replay on soft declines. Not live traffic."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Candidates" value={String(data.retry.n_candidates)} hint="Soft declines only" />
              <KpiCard label="Simulated approval" value={pct(Number(data.retry.approval_sim))} tone="ok" />
              <KpiCard label="Recovered" value={inr(Number(data.retry.recovered), true)} hint={`Net ${inr(Number(data.retry.net_reward), true)} after fees`} tone="ok" />
              <KpiCard label="Approval uplift" value={pct(Number(data.retry.approval_uplift))} tone="ok" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="pb-2 pr-3">Arm</th>
                    <th className="pb-2 pr-3 text-right">N</th>
                    <th className="pb-2 pr-3 text-right">Share of recovered</th>
                    <th className="pb-2 pr-3 text-right">Recovered</th>
                    <th className="pb-2 text-right">Fee cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.retry_arms ?? []).map((a) => (
                    <tr key={a.arm} className="border-t border-line">
                      <td className="py-2 pr-3">{a.arm.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.n}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(Number(a.p_approve))}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(a.recovered), true)}</td>
                      <td className="py-2 text-right tabular-nums">{inr(Number(a.fee_cost), true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
