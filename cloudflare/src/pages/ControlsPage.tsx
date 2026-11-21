import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ControlRow, type ControlsPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr, pct } from "@/lib/format";
import { areaPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

function heat(status: string, passPct: number) {
  if (status === "pass" || passPct >= 0.9) return "bg-emerald-50 text-success border-emerald-100";
  if (passPct >= 0.5) return "bg-amber-50 text-warning border-amber-100";
  return "bg-red-50 text-danger border-red-100";
}

export default function ControlsPage() {
  const [data, setData] = useState<ControlsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.controls().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading control library…</p>;

  const k = data.kpis;
  const failing = data.controls.filter((c) => c.status === "fail");
  const passRate = k && k.controls_total ? k.controls_pass / k.controls_total : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Control library</h1>
        <p className="text-sm text-muted">
          Named revenue-assurance controls mapped to every recon check. Health is evaluated from pre-aggregated Neon summaries.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Controls evaluated" value={String(k?.controls_total ?? 0)} hint="Coverage of the mapped catalog" />
        <KpiCard label="Passing" value={String(k?.controls_pass ?? 0)} hint={pct(passRate)} tone="ok" />
        <KpiCard label="Failing" value={String(k?.controls_fail ?? 0)} hint="Open exceptions in this book" tone="leak" />
        <KpiCard label="Coverage" value={pct(Number(k?.coverage_pct ?? 0))} hint="Share of controls with a recorded result" tone="ok" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coverage and health by domain</CardTitle>
          <CardDescription>Passing share of mapped controls in each domain</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.by_domain.map((d) => {
              const share = d.n ? d.passing / d.n : 0;
              return (
                <Link
                  key={d.domain}
                  to={areaPath(d.domain)}
                  className={cn("min-w-0 rounded-lg border px-3 py-2", heat(share >= 0.9 ? "pass" : "fail", share))}
                >
                  <div className="truncate text-sm font-medium capitalize">{d.domain.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs">
                    {d.passing}/{d.n} passing · {pct(share)}
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Failing controls</CardTitle>
          <CardDescription>Highest leakage first. Click through to the domain page.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 pr-3">Control</th>
                <th className="pb-2 pr-3">Domain</th>
                <th className="pb-2 pr-3">Owner</th>
                <th className="pb-2 pr-3">Frequency</th>
                <th className="pb-2 pr-3 text-right">Exceptions</th>
                <th className="pb-2 text-right">Leakage / exposure</th>
              </tr>
            </thead>
            <tbody>
              {failing.slice(0, 40).map((c) => (
                <FailRow key={c.control_id} c={c} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function FailRow({ c }: { c: ControlRow }) {
  return (
    <tr className="border-t border-line">
      <td className="max-w-[280px] py-2 pr-3">
        <Link to={areaPath(c.domain)} className="block truncate font-medium text-ink hover:underline" title={c.objective}>
          {c.name}
        </Link>
        <div className="truncate text-[11px] text-muted">{c.threshold}</div>
      </td>
      <td className="py-2 pr-3 capitalize text-muted">{c.domain.replace(/_/g, " ")}</td>
      <td className="py-2 pr-3 text-muted">{c.owner}</td>
      <td className="py-2 pr-3 text-muted">{c.frequency}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{c.exception_count}</td>
      <td className="py-2 text-right tabular-nums text-danger">{inr(c.leakage, true)}</td>
    </tr>
  );
}
