import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type AreaDetail, type ExceptionRow } from "@/api";
import { chartMargin, TruncTick, WrappedLegend } from "@/components/ChartKit";
import { ExceptionTable } from "@/components/ExceptionTable";
import { KpiCard } from "@/components/KpiCard";
import { StatusBar } from "@/components/StatusBar";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tooltipStyle } from "@/lib/chartTheme";
import { inr, pct, prettyCat } from "@/lib/format";
import { useFilters } from "@/filters";

const ROUTE_TO_AREA: Record<string, string> = {
  authorization: "authorization",
  scheme: "scheme",
  bank: "bank_trs",
  fees: "gateway",
  terminals: "terminal",
  apm: "apm",
  fx: "fx",
  pricing: "pricing",
  payouts: "payouts",
  chargebacks: "chargebacks",
  billing: "billing",
  invoicing: "invoicing",
  cash: "cash_ar",
  vendors: "vendor",
  gl: "gl",
  hops: "hops",
};

const FEE_AREAS = ["gateway", "network", "partner"] as const;

export default function AreaPage() {
  const { slug } = useParams();
  const primary = ROUTE_TO_AREA[slug || ""] || "authorization";
  const ids = slug === "fees" ? [...FEE_AREAS] : [primary];
  const [pages, setPages] = useState<AreaDetail[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ExceptionRow | null>(null);
  const { filters, isFiltered } = useFilters();

  useEffect(() => {
    setPages([]);
    setError("");
    Promise.all(ids.map((id) => api.area(id)))
      .then(setPages)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [slug]);

  const exceptions = useMemo(() => {
    const rows = pages.flatMap((p) => p.exceptions);
    return rows.filter((r) => {
      if (filters.merchant !== "all" && r.merchant_id !== filters.merchant) return false;
      if (filters.scheme !== "all" && r.scheme !== filters.scheme) return false;
      return true;
    });
  }, [pages, filters]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!pages.length) return <p className="text-muted">Loading recon…</p>;

  const leakage = pages.reduce((s, p) => s + p.summary.leakage, 0);
  const matched = pages.reduce((s, p) => s + p.summary.matched, 0);
  const unmatched = pages.reduce((s, p) => s + p.summary.unmatched, 0);
  const variance = pages.reduce((s, p) => s + p.summary.variance, 0);
  const total = matched + unmatched + variance;
  const title = slug === "fees" ? "Fees — gateway, network, partner" : pages[0].meta.label;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="text-sm text-muted">{pages.map((p) => p.meta.blurb).join(" · ")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Leakage" value={inr(leakage, true)} tone="leak" />
        <KpiCard label="Match rate" value={pct(total ? matched / total : 1)} tone="ok" />
        <KpiCard label="Exceptions" value={String(isFiltered ? exceptions.length : pages.reduce((s, p) => s + p.summary.exception_count, 0))} hint={isFiltered ? "Filtered list" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation status</CardTitle>
          <CardDescription>Matched, unmatched and variance counts for this domain</CardDescription>
        </CardHeader>
        <CardContent>
          <StatusBar matched={matched} unmatched={unmatched} variance={variance} />
        </CardContent>
      </Card>

      {pages.map((p) => (
        <Card key={p.summary.area}>
          <CardHeader>
            <CardTitle>{p.meta.label}</CardTitle>
            <CardDescription>Primary recon series</CardDescription>
          </CardHeader>
          <CardContent>
            <AreaChartBlock series={p.series} />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Exceptions</CardTitle>
          <CardDescription>Click a row for detail. Sort any column. Investigate opens the agent pipeline.</CardDescription>
        </CardHeader>
        <CardContent>
          <ExceptionTable rows={exceptions.slice(0, 40)} onSelect={setSelected} />
        </CardContent>
      </Card>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        title={selected ? prettyCat(selected.category) : "Exception"}
        description={selected ? `${selected.recon_ref || selected.ref_id} · ${selected.area}` : undefined}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-[11px] uppercase text-muted">Merchant</dt><dd>{selected.merchant_id ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-muted">Scheme</dt><dd>{selected.scheme ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-muted">Expected</dt><dd className="tabular-nums">{inr(selected.expected_amount, true)}</dd></div>
              <div><dt className="text-[11px] uppercase text-muted">Actual</dt><dd className="tabular-nums">{inr(selected.actual_amount, true)}</dd></div>
              <div><dt className="text-[11px] uppercase text-muted">Leakage</dt><dd className="tabular-nums text-danger">{inr(selected.leakage, true)}</dd></div>
              <div><dt className="text-[11px] uppercase text-muted">When</dt><dd>{selected.ts ?? "—"}</dd></div>
            </dl>
            <Button asChild>
              <a href={`/investigate/${encodeURIComponent(selected.exception_id)}`}>Run investigation</a>
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function AreaChartBlock({ series }: { series: { type: string; points: Record<string, unknown>[] } }) {
  const raw = series.points ?? [];
  if (!raw.length) return <p className="text-sm text-slate-500">No series</p>;
  const type = series.type;
  const cssPoints =
    type === "fees"
      ? raw.flatMap((row) => [
          { name: `${row.name ? String(row.name) + " · " : ""}Expected`, value: Number(row.expected ?? 0) },
          { name: `${row.name ? String(row.name) + " · " : ""}Invoiced`, value: Number(row.invoiced ?? row.billed ?? 0) },
        ])
      : type === "terminals"
        ? raw.map((row) => ({ name: String(row.status ?? "status"), value: Number(row.rental ?? row.n ?? 0) }))
        : type === "apm"
          ? raw.map((row) => ({
              name: `${row.method ?? ""} ${row.provider ?? ""}`.trim(),
              value: Number(row.amount ?? 0),
            }))
          : null;
  if (cssPoints) {
    const max = Math.max(...cssPoints.map((r) => r.value), 1);
    return (
      <div className="flex flex-col gap-3 px-1 py-1">
        {cssPoints.map((row, i) => (
          <div key={`${row.name}-${i}`} className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-slate-400">
              <span className="min-w-0 truncate" title={row.name}>{row.name}</span>
              <span className="shrink-0 tabular-nums text-slate-200">{inr(row.value, true)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(4, Math.round((row.value / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const xKey = "day" in (raw[0] ?? {}) ? "day" : "scheme" in (raw[0] ?? {}) ? "scheme" : "name";
  const yKeys =
    type === "fx"
      ? ["applied", "reference"]
      : type === "scheme"
        ? ("invoiced" in (raw[0] || {}) ? ["invoiced", "gst", "total"] : ["gross", "fees", "net"])
        : type === "trend"
          ? ["leakage"]
          : Object.keys(raw[0] || {}).filter((k) => k !== "day" && k !== "scheme" && k !== "method" && k !== "name" && k !== "n");
  const isBar = type !== "fx" && type !== "trend";
  const longCats = isBar && (xKey === "scheme" || xKey === "name" || raw.length > 8);
  const Chart = isBar ? BarChart : LineChart;
  const colors = ["#1d4ed8", "#0f172a", "#64748b", "#b91c1c"];
  const height = longCats ? Math.max(280, raw.length * 36) : 320;
  const xInterval = raw.length <= 8 ? 0 : Math.max(1, Math.ceil(raw.length / 5) - 1);
  return (
    <div style={{ height }} className="min-h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Chart
          data={raw}
          layout={longCats ? "vertical" : "horizontal"}
          margin={{ ...chartMargin, left: longCats ? 12 : 8, bottom: longCats ? 8 : 48 }}
        >
          <CartesianGrid stroke="#1e293b" vertical={!longCats} horizontal={longCats ? false : true} />
          {longCats ? (
            <>
              <XAxis type="number" tick={<TruncTick maxChars={8} formatter={(v: unknown) => (type === "fx" ? String(v) : inr(Number(v), true))} />} />
              <YAxis type="category" dataKey={xKey} width={88} interval={0} tick={<TruncTick textAnchor="end" maxChars={11} />} />
            </>
          ) : (
            <>
              <XAxis
                dataKey={xKey}
                interval={xInterval}
                height={48}
                tick={<TruncTick angle={-35} textAnchor="end" maxChars={8} />}
              />
              <YAxis width={56} tick={<TruncTick textAnchor="end" maxChars={8} formatter={(v: unknown) => (type === "fx" ? String(v) : inr(Number(v), true))} />} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} />
          {yKeys.length > 1 ? <WrappedLegend /> : null}
          {yKeys.map((k, i) =>
            isBar ? (
              <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={longCats ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
            ) : (
              <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} dot={false} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
