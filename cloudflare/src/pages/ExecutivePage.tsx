import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Printer } from "lucide-react";
import { api, type Executive } from "@/api";
import { chartMargin, TruncTick } from "@/components/ChartKit";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART, tooltipStyle } from "@/lib/chartTheme";
import { inr, pct, prettyCat } from "@/lib/format";
import { areaPath } from "@/lib/routes";
import { useFilters } from "@/filters";
import { cn } from "@/lib/utils";

function heatColor(match: number): string {
  if (match >= 0.95) return "bg-emerald-50 text-success border-emerald-100";
  if (match >= 0.8) return "bg-amber-50 text-warning border-amber-100";
  return "bg-red-50 text-danger border-red-100";
}

export default function ExecutivePage() {
  const [data, setData] = useState<Executive | null>(null);
  const [error, setError] = useState("");
  const { isFiltered } = useFilters();

  useEffect(() => {
    api.executive().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading executive summary…</p>;

  const k = data.kpis;
  const comparePct = data.period_compare.prior ? data.period_compare.delta / data.period_compare.prior : 0;
  const maxWater = Math.max(...data.waterfall.map((s) => Math.abs(s.value)), 1);
  const maxFunnel = Math.max(...data.funnel.map((s) => s.amount), 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Executive summary</h1>
          <p className="text-sm text-muted">
            Complete revenue assurance · {data.period.label} book · as of {data.period.as_of}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
            Synthetic data
          </span>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </header>

      {isFiltered && (
        <p className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-muted">
          Headline figures are book-level for {data.period.label}. Merchant and scheme filters apply on domain exception lists.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Revenue processed" value={inr(k.revenue, true)} hint={`${k.auth_count.toLocaleString("en-IN")} authorizations`} />
        <KpiCard label="Total leakage" value={inr(k.leakage, true)} hint={`${pct(k.leakage_pct)} of revenue`} tone="leak" />
        <KpiCard label="Match rate" value={pct(k.match_rate)} hint={`${k.exception_count} open exceptions`} tone="ok" />
        <KpiCard
          label="Recoverable"
          value={inr(k.recoverable, true)}
          hint={`Recovered ${inr(k.recovered, true)} · written off ${inr(k.written_off, true)}`}
          tone="warn"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Recovered" value={inr(k.recovered, true)} tone="ok" />
        <KpiCard label="Written off" value={inr(k.written_off, true)} />
        <KpiCard
          label="SLA ageing"
          value={data.ageing[0] ? `${data.ageing[0].n}` : "0"}
          hint={data.ageing.map((a) => `${a.bucket}: ${a.n}`).join(" · ") || "No aged exceptions"}
        />
      </div>

      {data.governance && (
        <Card>
          <CardHeader>
            <CardTitle>Governance and risk rollup</CardTitle>
            <CardDescription>
              Control library health, unapproved config impact and tax leakage count in the book leakage figure.
              KYC, AML and network-risk amounts are exposure, not booked leakage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Controls passing"
                value={`${data.governance.controls_pass}/${data.governance.controls_total}`}
                hint={`${pct(data.governance.coverage_pct)} coverage · ${data.governance.controls_fail} failing`}
                tone={data.governance.controls_fail ? "warn" : "ok"}
              />
              <KpiCard
                label="Unapproved config impact"
                value={inr(data.governance.unapproved_impact, true)}
                hint={`${data.governance.unapproved_changes} unapproved changes`}
                tone="leak"
              />
              <KpiCard
                label="Tax & regulatory leakage"
                value={inr(data.governance.tax_leakage, true)}
                hint="GST 18%, illustrative TDS / zero-MDR"
                tone="leak"
              />
              <KpiCard
                label="Payment success rate"
                value={pct(data.governance.success_rate)}
                hint={`Interface drop ${pct(data.governance.interface_drop_pct)}`}
                tone="ok"
              />
              <KpiCard
                label="KYC at-risk volume"
                value={inr(data.governance.kyc_at_risk, true)}
                hint={`${data.governance.kyc_open} open KYC exceptions · exposure`}
                tone="warn"
              />
              <KpiCard
                label="AML exposure"
                value={inr(data.governance.aml_exposure, true)}
                hint={`${data.governance.aml_flags} rule-based flags · not book leakage`}
                tone="warn"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to="/controls" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Control library</Link>
              <Link to="/config" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Config changes</Link>
              <Link to="/tax" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Tax &amp; regulatory</Link>
              <Link to="/kyc" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">KYC</Link>
              <Link to="/aml" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">AML</Link>
              <Link to="/network-risk" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Network risk</Link>
              <Link to="/success" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Success rate</Link>
            </div>
          </CardContent>
        </Card>
      )}

      {data.intelligence && (
        <Card>
          <CardHeader>
            <CardTitle>Intelligence and review</CardTitle>
            <CardDescription>
              Contract leakage is included in the book figure. File exposure and open anomalies are operational, not booked leakage.
              Routing figures are a simulation on synthetic data. Auditor needs_review items wait in the review queue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Pending reviews"
                value={String(data.intelligence.reviews_pending)}
                hint="Auditor needs_review items"
                tone={data.intelligence.reviews_pending ? "warn" : "ok"}
              />
              <KpiCard
                label="Contract leakage"
                value={inr(data.intelligence.contract_leakage, true)}
                hint={`${data.intelligence.contracts_pending} rules pending · ${data.intelligence.contracts_approved} approved`}
                tone="leak"
              />
              <KpiCard
                label="Open anomalies"
                value={String(data.intelligence.anomaly_open)}
                hint={`${data.intelligence.files_missing} missing files · operational`}
                tone="warn"
              />
              <KpiCard
                label="Routing uplift"
                value={pct(data.intelligence.routing_uplift)}
                hint={`Fee delta ${inr(data.intelligence.routing_savings, true)} · simulation`}
                tone="ok"
              />
              <KpiCard
                label="Open cases"
                value={String(data.intelligence.cases_open)}
                hint={`${data.intelligence.cases_overdue} overdue SLA`}
                tone={data.intelligence.cases_overdue ? "warn" : "ok"}
              />
              <KpiCard
                label="Risk coverage gaps"
                value={`${data.intelligence.risks_gap}/${data.intelligence.risks_total}`}
                hint="Risks without a passing mapped control"
                tone={data.intelligence.risks_gap ? "warn" : "ok"}
              />
              <KpiCard
                label="AI faithfulness"
                value={pct(data.intelligence.ai_faithfulness || 0)}
                hint={`${data.intelligence.ai_unverified} unverified outputs · review queue`}
                tone={data.intelligence.ai_unverified ? "warn" : "ok"}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to="/review" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Review queue{data.intelligence.reviews_pending ? ` (${data.intelligence.reviews_pending})` : ""}</Link>
              <Link to="/contracts" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Contracts &amp; rules</Link>
              <Link to="/anomalies" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Anomalies</Link>
              <Link to="/routing" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Routing</Link>
              <Link to="/ask" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Ask your data</Link>
              <Link to="/cases" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Cases</Link>
              <Link to="/risks" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">Risk library</Link>
              <Link to="/files" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">File completeness</Link>
              <Link to="/ingestion" className="rounded-full border border-line px-2 py-1 hover:bg-slate-50">File ingestion</Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Leadership brief</CardTitle>
          <CardDescription>
            {data.narrative?.source === "llm" ? "Auto-generated by the RA agent" : "Rules-based brief (AI narrative runs on the daily schedule)"}
            {data.narrative?.generated_at ? ` · ${new Date(data.narrative.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Calcutta" })} IST` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.narrative?.bullets?.length ? (
            <ul className="space-y-2 text-sm leading-relaxed text-ink">
              {data.narrative.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">The daily agent run will publish a 3–5 bullet leadership brief here.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leakage waterfall</CardTitle>
            <CardDescription>Gross volume through leakage by domain to net after leakage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.waterfall.map((s) => (
                <div key={s.name} className="min-w-0">
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-medium text-ink" title={s.name}>{s.name}</span>
                    <span className={cn("shrink-0 tabular-nums", s.kind === "leak" ? "text-danger" : "text-ink")}>
                      {s.kind === "leak" ? "−" : ""}
                      {inr(Math.abs(s.value), true)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        s.kind === "leak" ? "bg-danger" : s.kind === "net" ? "bg-success" : "bg-accent",
                      )}
                      style={{ width: `${Math.max(4, Math.round((Math.abs(s.value) / maxWater) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leakage trend</CardTitle>
            <CardDescription>
              First vs second half of October: {inr(data.period_compare.prior, true)} → {inr(data.period_compare.current, true)}
              {" "}({comparePct >= 0 ? "+" : ""}{pct(comparePct)})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ ...chartMargin, bottom: 36 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="day" interval={Math.max(1, Math.ceil(data.trend.length / 5) - 1)} height={48} tick={<TruncTick angle={-35} textAnchor="end" maxChars={8} formatter={(d) => String(d ?? "").slice(5)} />} />
                  <YAxis width={56} tick={<TruncTick textAnchor="end" maxChars={8} formatter={(v) => inr(Number(v), true)} />} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => inr(Number(v), true)} />
                  <Area type="monotone" dataKey="leakage" stroke={CHART.leak} fill="#b91c1c22" name="Leakage" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top leakage drivers</CardTitle>
            <CardDescription>Five largest gap types in the book</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: Math.max(240, data.top_drivers.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.top_drivers.map((d) => ({ ...d, name: prettyCat(d.category) }))} layout="vertical" margin={{ ...chartMargin, left: 8 }}>
                  <CartesianGrid stroke={CHART.grid} horizontal={false} />
                  <XAxis type="number" tick={<TruncTick maxChars={8} formatter={(v) => inr(Number(v), true)} />} />
                  <YAxis type="category" dataKey="name" width={110} interval={0} tick={<TruncTick textAnchor="end" maxChars={16} />} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => inr(Number(v), true)} />
                  <Bar dataKey="leakage" fill={CHART.leak} radius={[0, 4, 4, 0]} name="Leakage" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovery pipeline</CardTitle>
            <CardDescription>From recoverable leakage through proposed, approved, recovered and write-off</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.funnel.map((s) => (
                <div key={s.stage}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-ink">{s.stage}</span>
                    <span className="tabular-nums text-muted">
                      {inr(s.amount, true)}
                      {s.n ? ` · ${s.n}` : ""}
                    </span>
                  </div>
                  <div className="h-8 overflow-hidden rounded-md bg-slate-100">
                    <div
                      className={s.stage === "Written off" ? "h-full bg-slate-400" : s.stage === "Recovered" ? "h-full bg-success" : "h-full bg-accent"}
                      style={{ width: `${Math.max(6, Math.round((s.amount / maxFunnel) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk heatmap by domain</CardTitle>
          <CardDescription>Colour follows match rate — green ≥ 95%, amber ≥ 80%, red below</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.heatmap.map((h) => (
              <Link
                key={h.area}
                to={areaPath(h.area)}
                className={cn("rounded-lg border p-3 transition hover:shadow-sm", heatColor(h.match_rate))}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-semibold" title={h.label}>{h.label}</div>
                  <div className="shrink-0 text-sm tabular-nums">{pct(h.match_rate, 0)}</div>
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-slate-700">
                  <span>{inr(h.leakage, true)}</span>
                  <span>{h.exceptions} gaps</span>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
