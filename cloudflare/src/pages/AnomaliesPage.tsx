import { useEffect, useMemo, useState } from "react";
import { api, type AnomalyPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

type SeriesRow = AnomalyPayload["series"][number];

const FEATURED = ["approval_rate", "fee_ratio", "settlement_latency", "refund_cb_ratio"];

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" ? Number.isFinite(v) : Number.isFinite(Number(v));
}

function dayLabel(raw: unknown): string {
  const s = String(raw ?? "");
  return s.length >= 10 ? s.slice(0, 10) : s || "—";
}

function formatMetric(metric: string, v: unknown): string {
  if (!isFiniteNum(v)) return "—";
  const n = Number(v);
  if (metric === "approval_rate" || metric === "refund_cb_ratio") return `${(n * 100).toFixed(1)}%`;
  if (metric === "settlement_latency") return `${n.toFixed(1)}d`;
  if (metric === "fee_ratio") return `${n.toFixed(2)} bps`;
  return n.toFixed(3);
}

function deviationLabel(metric: string, row: SeriesRow): string {
  const z = isFiniteNum(row.zscore) ? Number(row.zscore) : null;
  const value = Number(row.value);
  const ewma = Number(row.ewma);
  let pct = "";
  if (Number.isFinite(value) && Number.isFinite(ewma) && Math.abs(ewma) > 1e-9) {
    pct = `${value - ewma >= 0 ? "+" : ""}${(((value - ewma) / Math.abs(ewma)) * 100).toFixed(1)}%`;
  } else if (Number.isFinite(value) && Number.isFinite(ewma) && (metric === "approval_rate" || metric === "refund_cb_ratio")) {
    pct = `${value - ewma >= 0 ? "+" : ""}${((value - ewma) * 100).toFixed(1)} pp`;
  }
  const zPart = z != null ? `z ${z.toFixed(2)}` : "z —";
  return pct ? `${zPart} (${pct} vs EWMA)` : zPart;
}

export default function AnomaliesPage() {
  const [data, setData] = useState<AnomalyPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  useEffect(() => {
    api.anomalies().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, SeriesRow[]>();
    for (const s of data.series) {
      const k = `${s.metric}::${s.segment}`;
      const list = map.get(k) ?? [];
      list.push(s);
      map.set(k, list);
    }
    const out = [...map.entries()].map(([k, rows]) => {
      const [metric, segment] = k.split("::");
      const sorted = [...rows].sort((a, b) => dayLabel(a.day).localeCompare(dayLabel(b.day)));
      const flagged = sorted.some((r) => Number(r.is_anomaly) === 1);
      return { metric, segment, rows: sorted, flagged };
    }).filter((g) => g.flagged || FEATURED.includes(g.metric));
    out.sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.metric.localeCompare(b.metric) || a.segment.localeCompare(b.segment));
    return out;
  }, [data]);

  async function investigate(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api.investigateAnomaly(id);
      setResult(r.exception_id ? `Investigated ${r.event_id} → ${r.exception_id}` : "Skipped");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading anomaly sensors…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Anomalies</h1>
        <p className="text-sm text-muted">{data.note}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Open events" value={String(data.open_count ?? data.events.filter((e) => e.status === "open").length)} tone="warn" />
        <KpiCard
          label="Isolation-forest open"
          value={String(data.events.filter((e) => String(e.metric).startsWith("iforest") && e.status === "open").length)}
          hint="Settlement fee / FX markup · deduped, never re-opened"
          tone="warn"
        />
        <KpiCard label="Cron behaviour" value="Top-1" hint="An open event triggers one investigation, inside the neuron budget" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Detected events</CardTitle>
          <CardDescription>Statistical flags. Investigate runs the on-demand investigator pipeline.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 pr-3">Event</th>
                <th className="pb-2 pr-3">Day</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3 text-right">Value</th>
                <th className="pb-2 pr-3 text-right">z</th>
                <th className="pb-2 pr-3 text-right">Impact</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.event_id} className="border-t border-line">
                  <td className="py-2 pr-3">{e.metric.replace(/_/g, " ")} · {e.segment}</td>
                  <td className="py-2 pr-3">{dayLabel(e.day)}</td>
                  <td className="py-2 pr-3 capitalize">{e.status}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMetric(e.metric, e.value)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(e.zscore || 0).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(e.impact || 0), true)}</td>
                  <td className="py-2">
                    {e.status === "open" ? (
                      <Button size="sm" disabled={busy} onClick={() => void investigate(String(e.event_id))}>Investigate</Button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && <p className="mt-3 text-xs text-muted">{result}</p>}
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.metric + "-" + g.segment} data-testid="anomaly-spark-card">
            <CardHeader>
              <CardTitle className="truncate text-sm" data-testid="anomaly-spark-title">
                {g.metric.replace(/_/g, " ")} · {g.segment}
              </CardTitle>
              <CardDescription>Sparkline with EWMA band</CardDescription>
            </CardHeader>
            <CardContent>
              <Spark metric={g.metric} segment={g.segment} rows={g.rows} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Spark({ metric, segment, rows }: { metric: string; segment: string; rows: SeriesRow[] }) {
  const usable = rows.filter((r) => isFiniteNum(r.value));
  const last = usable[usable.length - 1];
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);

  if (!usable.length) {
    return (
      <p data-testid="anomaly-spark-empty" className="text-sm text-muted">
        No data for this series.
      </p>
    );
  }

  const w = 520;
  const h = 96;
  const pad = 6;
  const ys = usable.flatMap((r) => [Number(r.band_lo ?? r.value), Number(r.value), Number(r.band_hi ?? r.value)]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const sx = (i: number) => pad + (i / Math.max(usable.length - 1, 1)) * (w - pad * 2);
  const sy = (v: number) => h - pad - ((v - min) / Math.max(max - min, 1e-9)) * (h - pad * 2);
  const line = usable.map((r, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(Number(r.value)).toFixed(1)}`).join(" ");
  const band =
    usable.map((r, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(Number(r.band_hi ?? r.value)).toFixed(1)}`).join(" ") +
    " " +
    [...usable].reverse().map((r, i) => `L${sx(usable.length - 1 - i).toFixed(1)} ${sy(Number(r.band_lo ?? r.value)).toFixed(1)}`).join(" ") +
    " Z";

  function nearest(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * w;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < usable.length; i++) {
      const d = Math.abs(sx(i) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { i: best, x: sx(best), y: sy(Number(usable[best].value)) };
  }

  const tipRow = tip ? usable[tip.i] : null;

  return (
    <div>
      <dl
        data-testid="anomaly-spark-kpis"
        className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"
      >
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Current</dt>
          <dd className="font-semibold tabular-nums text-ink">{formatMetric(metric, last.value)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">EWMA baseline</dt>
          <dd className="font-semibold tabular-nums text-ink">{formatMetric(metric, last.ewma ?? last.value)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Deviation</dt>
          <dd className="font-semibold tabular-nums text-ink">{deviationLabel(metric, last)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-muted">Date</dt>
          <dd className="font-semibold tabular-nums text-ink">{dayLabel(last.day)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] uppercase tracking-wide text-muted">Expected band</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {formatMetric(metric, last.band_lo ?? last.value)} – {formatMetric(metric, last.band_hi ?? last.value)}
          </dd>
        </div>
      </dl>
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-24 w-full overflow-visible text-accent"
          role="img"
          aria-label={`${metric.replace(/_/g, " ")} ${segment} sparkline`}
          onMouseLeave={() => setTip(null)}
          onMouseMove={(e) => setTip(nearest(e.clientX, e.currentTarget))}
        >
          <title>{`${metric.replace(/_/g, " ")} · ${segment}: current ${formatMetric(metric, last.value)}, EWMA ${formatMetric(metric, last.ewma)}, band ${formatMetric(metric, last.band_lo)} – ${formatMetric(metric, last.band_hi)}, ${deviationLabel(metric, last)}, ${dayLabel(last.day)}`}</title>
          <path d={band} fill="#93c5fd55" stroke="none" />
          <path d={line} fill="none" stroke="#1d4ed8" strokeWidth="1.6" />
          {usable.map((r, i) =>
            Number(r.is_anomaly) === 1 ? <circle key={i} cx={sx(i)} cy={sy(Number(r.value))} r="3" fill="#b91c1c" /> : null,
          )}
          {tipRow && tip ? (
            <circle cx={sx(tip.i)} cy={sy(Number(tipRow.value))} r="3.5" fill="#1d4ed8" stroke="#fff" strokeWidth="1" />
          ) : null}
        </svg>
        {tipRow && tip ? (
          <div
            data-testid="anomaly-spark-tooltip"
            className="pointer-events-none absolute z-10 w-52 rounded-md border border-line bg-white px-2 py-1.5 text-[11px] text-ink shadow-sm"
            style={{
              left: `${Math.min(Math.max((tip.x / w) * 100, 18), 82)}%`,
              top: 0,
              transform: "translate(-50%, -8px)",
            }}
          >
            <div className="font-semibold">{dayLabel(tipRow.day)}</div>
            <div>Current {formatMetric(metric, tipRow.value)}</div>
            <div>EWMA {formatMetric(metric, tipRow.ewma ?? tipRow.value)}</div>
            <div>
              Band {formatMetric(metric, tipRow.band_lo ?? tipRow.value)} – {formatMetric(metric, tipRow.band_hi ?? tipRow.value)}
            </div>
            <div>{deviationLabel(metric, tipRow)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
