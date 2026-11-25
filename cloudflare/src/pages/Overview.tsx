import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LabelList,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, IndianRupee, ShieldCheck, Store } from "lucide-react";
import { api, type Overview as OverviewData } from "../api";
import { CategoryTick, chartMargin, TruncTick, dayTickInterval } from "../components/ChartKit";
import { KpiCard } from "../components/KpiCard";
import { MoneyFlow } from "../components/MoneyFlow";
import { inr, pct, prettyCat } from "../lib/format";

const COLORS = ["#22d3ee", "#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#38bdf8", "#f472b6"];

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.overview().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-rose-300">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading overview…</p>;

  const cat = data.by_category.map((r) => ({
    name: prettyCat(r.category),
    leakage: r.leakage,
    n: r.n,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kosha Kshema Revenue Assurance</h1>
          <p className="text-sm text-slate-400">Payment lifecycle recon · synthetic October 2026 book</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/lifecycle"
            className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/30 hover:bg-cyan-500/25"
          >
            System map
          </Link>
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/30">
            Synthetic data
          </span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total leakage"
          value={inr(data.kpis.total_leakage, true)}
          hint={`${data.kpis.exception_count} exceptions`}
          tone="leak"
          icon={<AlertTriangle className="h-4 w-4 text-rose-300" />}
        />
        <KpiCard
          label="Recovery potential"
          value={inr(data.kpis.recovery_potential, true)}
          tone="leak"
          icon={<IndianRupee className="h-4 w-4 text-rose-200" />}
        />
        <KpiCard
          label="Match rate"
          value={pct(data.kpis.match_rate)}
          tone="ok"
          icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}
        />
        <KpiCard
          label="Book"
          value={`${data.kpis.auth_count.toLocaleString()} auths`}
          hint={`${data.kpis.merchant_count} merchants`}
          icon={<Store className="h-4 w-4 text-cyan-300" />}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Money flow</h2>
        <MoneyFlow flow={data.flow} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-[#101827] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Leakage trend</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ ...chartMargin, left: 16, bottom: 44 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" interval={dayTickInterval(data.trend.length)} minTickGap={12} height={48} tick={<TruncTick angle={-35} textAnchor="end" maxChars={8} formatter={(d) => String(d ?? "").slice(5)} />} />
                <YAxis width={56} tick={<TruncTick textAnchor="end" maxChars={8} formatter={(v) => inr(Number(v), true)} />} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(v) => inr(Number(v), true)}
                />
                <Area type="monotone" dataKey="leakage" stroke="#fb7185" fill="#fb718533" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#101827] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">By gap type</h2>
          <div style={{ height: Math.max(288, cat.length * 52) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cat} layout="vertical" margin={{ ...chartMargin, left: 4, right: 64 }}>
                <CartesianGrid stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={<TruncTick maxChars={8} formatter={(v) => inr(Number(v), true)} />} />
                <YAxis type="category" dataKey="name" width={136} interval={0} tick={<CategoryTick textAnchor="end" maxCharsPerLine={16} />} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                  formatter={(v) => inr(Number(v), true)}
                  labelFormatter={(label) => String(label)}
                />
                <Bar dataKey="leakage" radius={[0, 6, 6, 0]}>
                  {cat.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                  <LabelList dataKey="leakage" position="right" formatter={(v) => inr(Number(v), true)} style={{ fontSize: 10, fill: "#e2e8f0" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Recon by domain</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.areas.map((a) => (
            <Link
              key={a.area}
              to={areaPath(a.area)}
              className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101827] p-4 transition hover:border-cyan-400/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate pr-2 font-medium" title={a.label}>{a.label}</div>
                <div className="text-right text-rose-300 tabular-nums">{inr(a.leakage, true)}</div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round(a.match_rate * 100)}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                <span>{pct(a.match_rate)} match</span>
                <span>{a.exception_count} gaps</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}


function areaPath(area: string): string {
  const map: Record<string, string> = {
    authorization: "/authorization",
    scheme: "/scheme",
    bank_trs: "/bank",
    gateway: "/fees",
    network: "/fees",
    partner: "/fees",
    terminal: "/terminals",
    apm: "/apm",
    fx: "/fx",
    pricing: "/pricing",
    payouts: "/payouts",
    chargebacks: "/chargebacks",
    billing: "/billing",
    invoicing: "/invoicing",
    cash_ar: "/cash",
    vendor: "/vendors",
    gl: "/gl",
    hops: "/hops",
  };
  return map[area] || "/";
}
