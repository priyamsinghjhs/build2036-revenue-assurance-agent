import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ReviewListItem } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

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
        <KpiCard label="Pending amount" value={inr(pending.reduce((s,r)=>s+Number(r.amount||0),0), true)} tone="leak" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Latest auditor output per exception.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
              <th className="pb-2 pr-3">Exception</th><th className="pb-2 pr-3">Area</th><th className="pb-2 pr-3">Merchant</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3 text-right">Amount</th><th className="pb-2">Open</th>
            </tr></thead>
            <tbody>
              {rows.map((r)=>{
                const id = encodeURIComponent(r.exception_id);
                return (
                  <tr key={r.exception_id} className="border-t border-line">
                    <td className="max-w-[280px] truncate py-2 pr-3 font-mono text-xs" title={r.exception_id}>
                      <Link className="text-accent hover:underline" to={`/review/${id}`}>{r.exception_id}</Link>
                    </td>
                    <td className="py-2 pr-3">{r.area}</td>
                    <td className="py-2 pr-3">{r.merchant_id ?? "—"}</td>
                    <td className="py-2 pr-3">{r.review_status}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(r.amount||0), true)}</td>
                    <td className="py-2"><Link className="text-xs text-accent hover:underline" to={`/review/${id}`}>Review</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
