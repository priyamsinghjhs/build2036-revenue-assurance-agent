import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ReviewListItem } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inrExact } from "../../shared/money";

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<ReviewListItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.reviews().then(setRows).catch((e)=>setError(e instanceof Error?e.message:String(e))); }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!rows) return <p className="text-muted">Loading review queue…</p>;
  const pending = rows.filter((r)=>r.review_status==="pending");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Review queue</h1>
        <p className="text-sm text-muted">Auditor <code>needs_review</code> items waiting for a human decision. Approve, reject or send back — nothing is sent outside the app.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Pending review" value={String(pending.length)} tone={pending.length?"warn":"ok"} />
        <KpiCard label="Decided in queue" value={String(rows.length-pending.length)} />
        <KpiCard label="Pending leakage" value={inrExact(pending.reduce((s,r)=>s+Number(r.amount||0),0))} tone="leak" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Latest auditor output per exception.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => {
              const id = encodeURIComponent(r.exception_id);
              return (
                <li key={r.exception_id} className="rounded-lg border border-line p-3">
                  <p className="break-all font-mono text-xs leading-5 text-ink">{r.exception_id}</p>
                  <p className="mt-2 text-sm">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs">{r.area}</span>
                    <span className="ml-2 text-muted">{r.merchant_id ?? "—"}</span>
                  </p>
                  <p className="mt-1 flex items-center justify-between text-sm">
                    <span>{r.review_status}</span>
                    <span className="tabular-nums">{inrExact(Number(r.amount || 0))}</span>
                  </p>
                  <Link className="mt-2 inline-block text-xs font-medium text-accent hover:underline" to={`/review/${id}`}>Review</Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="pb-2 pr-3">Exception</th><th className="pb-2 pr-3">Area</th><th className="pb-2 pr-3">Merchant</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3 text-right">Leakage</th><th className="pb-2">Open</th>
            </tr></thead>
            <tbody>
              {rows.map((r)=>{
                const id = encodeURIComponent(r.exception_id);
                return (
                  <tr key={r.exception_id} className="border-t border-line">
                    <td className="max-w-[280px] py-2 pr-3 font-mono text-xs">
                      <Link className="block break-all text-accent hover:underline" to={`/review/${id}`}>{r.exception_id}</Link>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{r.area}</td>
                    <td className="py-2 pr-3">{r.merchant_id ?? "—"}</td>
                    <td className="py-2 pr-3">{r.review_status}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{inrExact(Number(r.amount || 0))}</td>
                    <td className="py-2"><Link className="text-xs text-accent hover:underline" to={`/review/${id}`}>Review</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
