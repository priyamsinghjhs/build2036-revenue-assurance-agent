import { useEffect, useState } from "react";
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
import { api, type AreaDetail } from "../api";
import { ExceptionTable } from "../components/ExceptionTable";
import { KpiCard } from "../components/KpiCard";
import { inr, pct } from "../lib/format";

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
};

const FEE_AREAS = ["gateway", "network", "partner"] as const;

export default function AreaPage() {
  const { slug } = useParams();
  const primary = ROUTE_TO_AREA[slug || ""] || "authorization";
  const ids = slug === "fees" ? [...FEE_AREAS] : [primary];
  const [pages, setPages] = useState<AreaDetail[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setPages([]);
    setError("");
    Promise.all(ids.map((id) => api.area(id)))
      .then(setPages)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [slug]);

  if (error) return <p className="text-rose-300">{error}</p>;
  if (!pages.length) return <p className="text-slate-400">Loading recon…</p>;

  const leakage = pages.reduce((s, p) => s + p.summary.leakage, 0);
  const exceptions = pages.flatMap((p) => p.exceptions);
  const matched = pages.reduce((s, p) => s + p.summary.matched, 0);
  const total = pages.reduce((s, p) => s + p.summary.matched + p.summary.unmatched + p.summary.variance, 0);
  const title = slug === "fees" ? "Fees — gateway, network, partner" : pages[0].meta.label;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-slate-400">{pages.map((p) => p.meta.blurb).join(" · ")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Leakage" value={inr(leakage, true)} tone="leak" />
        <KpiCard label="Match rate" value={pct(total ? matched / total : 1)} tone="ok" />
        <KpiCard label="Exceptions" value={String(exceptions.length)} />
      </div>

      {pages.map((p) => (
        <section key={p.summary.area} className="rounded-2xl border border-white/10 bg-[#101827] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{p.meta.label}</h2>
          <div className="h-52">
            <AreaChartBlock series={p.series} />
          </div>
        </section>
      ))}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Exceptions</h2>
        <ExceptionTable rows={exceptions.slice(0, 40)} />
      </section>
    </div>
  );
}

function AreaChartBlock({ series }: { series: { type: string; points: Record<string, unknown>[] } }) {
  const raw = series.points ?? [];
  if (!raw.length) return <p className="text-sm text-slate-500">No series</p>;
  const type = series.type;
  const points =
    type === "fees"
      ? raw.flatMap((row) => [
          { name: "Expected", value: Number(row.expected ?? 0) },
          { name: "Invoiced", value: Number(row.invoiced ?? 0) },
        ])
      : type === "terminals"
        ? raw.map((row) => ({ name: String(row.status ?? "status"), value: Number(row.rental ?? row.n ?? 0) }))
        : type === "apm"
          ? raw.map((row) => ({
              name: `${row.method ?? ""} ${row.provider ?? ""}`.trim(),
              value: Number(row.amount ?? 0),
            }))
          : raw;
  if (type === "fees" || type === "terminals" || type === "apm") {
    const max = Math.max(...points.map((r) => Number((r as { value?: number }).value ?? 0)), 1);
    return (
      <div className="flex h-full flex-col justify-center gap-3 px-2 py-2">
        {points.map((row) => {
          const value = Number((row as { value?: number; name?: string }).value ?? 0);
          const name = String((row as { name?: string }).name ?? "");
          return (
            <div key={name}>
              <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>{name}</span>
                <span className="tabular-nums text-slate-200">{inr(value, true)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
    const xKey = type === "fees" || type === "terminals" || type === "apm" ? "name" : "day" in (raw[0] ?? {}) ? "day" : "scheme" in (raw[0] ?? {}) ? "scheme" : "name";
  const yKeys =
    type === "fx"
      ? ["applied", "reference"]
      : type === "scheme"
        ? ["gross", "fees", "net"]
        : type === "trend"
          ? ["leakage"]
          : type === "fees" || type === "terminals" || type === "apm"
            ? ["value"]
            : Object.keys(points[0] || {}).filter((k) => k !== "day" && k !== "scheme" && k !== "method" && k !== "name" && k !== "n");
  const isBar = type !== "fx" && type !== "trend";
  const Chart = isBar ? BarChart : LineChart;
  const colors = ["#22d3ee", "#fb7185", "#34d399", "#fbbf24"];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={points}>
        <CartesianGrid stroke="#1e293b" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => (type === "fx" ? String(v) : inr(Number(v), true))} />
        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
        {yKeys.map((k, i) =>
          isBar ? (
            <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />
          ) : (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} dot={false} />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}
