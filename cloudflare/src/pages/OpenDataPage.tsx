import { useEffect, useState } from "react";
import { api, type OpenDataPayload } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

function rows(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString("en-IN");
}

export default function OpenDataPage() {
  const [data, setData] = useState<OpenDataPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.openData().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading open data sources…</p>;
  const f = data.figures;
  const amlScores = f.aml.scores?.n ?? 0;
  return (
    <div className="space-y-6" data-testid="open-data-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Open data sources</h1>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
          Isolated from the INR book
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Database size" value={f.db_size?.pretty ?? "—"} hint="Cap ~350 MB" tone="ok" />
        <KpiCard
          label="Book leakage (guard)"
          value={inr(Number(data.guard?.book_leakage ?? 0), true)}
          hint={`${data.guard?.exception_count ?? 0} exceptions · open tables excluded`}
          tone="leak"
        />
        <KpiCard
          label="TabFormer USD slice"
          value={rows(f.tabformer.n)}
          hint={`${rows(f.tabformer.fraud)} labelled fraud · not booked`}
        />
        <KpiCard
          label="IBM AML edges"
          value={rows(f.aml.edges)}
          hint={`${rows(f.aml.laundering)} laundering · ${rows(amlScores)} GraphSAGE scores`}
        />
      </div>

      {f.usdinr ? (
        <p className="text-sm text-muted">
          Latest ECB-derived USD/INR: <strong className="text-ink">{Number(f.usdinr.rate).toFixed(4)}</strong> on {f.usdinr.day}.
          MCC {rows(f.mcc)} · ISO 4217 {rows(f.iso4217)} · IFSC banks {rows(f.ifsc_banks)} · RBI PSI {rows(f.rbi_psi)}.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sources, rows, and attribution</CardTitle>
          <CardDescription>Licenses stay with the publisher. These tables never enter book-leakage KPIs.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="open-data-table">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3 text-right">Rows</th>
                <th className="py-2 pr-3">License / attribution</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(data.datasets ?? []).map((d) => (
                <tr key={d.dataset_id} className="border-b border-line/70 align-top" data-testid="open-data-row">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-ink">{d.title}</div>
                    {d.source_url ? (
                      <a className="text-xs text-brand underline" href={d.source_url} target="_blank" rel="noreferrer">
                        {d.source_name}
                      </a>
                    ) : (
                      <div className="text-xs text-muted">{d.source_name}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{rows(d.row_count)}</td>
                  <td className="py-2 pr-3">
                    {d.license_url ? (
                      <a className="underline" href={d.license_url} target="_blank" rel="noreferrer">
                        {d.license}
                      </a>
                    ) : (
                      <span>{d.license}</span>
                    )}
                    <div className="text-xs text-muted">{d.attribution}</div>
                  </td>
                  <td className="py-2 text-muted">{d.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
