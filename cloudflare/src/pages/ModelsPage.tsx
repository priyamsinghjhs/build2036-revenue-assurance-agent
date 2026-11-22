import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ModelsOverview } from "@/api";
import { ShapBars } from "@/components/ShapBars";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, pct } from "@/lib/format";

function fmtAuc(v: number | null | undefined) {
  return v == null ? "—" : Number(v).toFixed(3);
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelsOverview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.models().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading model intelligence…</p>;
  const k = data.kpis;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Model intelligence</h1>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
          {data.version} · synthetic metrics
        </span>
      </header>

      {k && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="False-decline recovery"
            value={inr(k.false_decline_recovery, true)}
            hint={`${k.false_decline_n} soft declines · book leakage`}
            tone="leak"
          />
          <KpiCard
            label="Chargeback high-risk exposure"
            value={inr(k.chargeback_exposure, true)}
            hint="p ≥ 0.55 · not book leakage"
            tone="warn"
          />
          <KpiCard
            label="Isolation-forest open"
            value={String(k.iforest_open)}
            hint="Settlement / FX flags, deduped"
            tone="warn"
          />
          <KpiCard
            label="Retry recovered (sim)"
            value={inr(k.retry_recovered, true)}
            hint={`Approval uplift ${pct(k.retry_uplift)} · not live traffic`}
            tone="ok"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <Link to="/false-declines" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">False declines</Link>
        <Link to="/chargebacks" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Chargebacks</Link>
        <Link to="/anomalies" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Anomalies</Link>
        <Link to="/routing" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Routing &amp; retry</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.cards.map((c) => (
          <Card key={c.model_id}>
            <CardHeader>
              <CardTitle className="capitalize">{c.model_id.replace(/_/g, " ")}</CardTitle>
              <CardDescription>
                {c.algorithm} · {c.version}
                {c.n_train != null ? ` · train ${c.n_train}` : ""}
                {c.n_test != null ? ` / test ${c.n_test}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">AUC</div>
                  <div className="tabular-nums font-medium">{fmtAuc(c.auc)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">PR-AUC</div>
                  <div className="tabular-nums font-medium">{fmtAuc(c.pr_auc)}</div>
                </div>
              </div>
              {c.notes ? <p className="text-xs leading-relaxed text-muted">{c.notes}</p> : null}
              {c.global_shap?.length ? (
                <ShapBars rows={c.global_shap} title="Global mean |SHAP| (path attribution)" mode="abs" />
              ) : (
                <p className="text-xs text-muted">No global SHAP (unsupervised or offline enrichment).</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {data.drift.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>In-sample stability</CardTitle>
            <CardDescription>
              First vs second half of the October book. This is not a production drift monitor — the book is a single synthetic period.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 pr-3">Model</th>
                  <th className="pb-2 pr-3">Half</th>
                  <th className="pb-2 pr-3 text-right">N</th>
                  <th className="pb-2 pr-3 text-right">Mean score</th>
                  <th className="pb-2 text-right">Std</th>
                </tr>
              </thead>
              <tbody>
                {data.drift.map((d) => (
                  <tr key={`${d.model_id}-${d.half}`} className="border-t border-line">
                    <td className="py-2 pr-3 capitalize">{String(d.model_id).replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3">{String(d.half).replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.n}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{Number(d.mean_score).toFixed(3)}</td>
                    <td className="py-2 text-right tabular-nums">{Number(d.std_score).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
