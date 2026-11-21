import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CaseListItem } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";

const COLS: { id: string; title: string }[] = [
  { id: "new", title: "New" },
  { id: "investigating", title: "Investigating" },
  { id: "awaiting_approval", title: "Awaiting approval" },
  { id: "resolved", title: "Resolved" },
];

export default function CasesPage() {
  const [rows, setRows] = useState<CaseListItem[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [comment, setComment] = useState("");
  const [view, setView] = useState<"kanban"|"list">("kanban");
  useEffect(() => { api.cases().then(setRows).catch((e)=>setError(e instanceof Error?e.message:String(e))); }, []);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    api.caseDetail(sel).then(setDetail as never).catch((e)=>setError(e instanceof Error?e.message:String(e)));
  }, [sel]);

  const overdue = (rows??[]).filter((c)=>c.overdue).length;
  const grouped = useMemo(() => {
    const m: Record<string, CaseListItem[]> = {};
    for (const c of rows??[]) (m[c.status] ||= []).push(c);
    return m;
  }, [rows]);

  async function act(id: string, patch: { status?: string; comment?: string }) {
    await api.updateCase(id, patch);
    setRows(await api.cases());
    if (sel===id) setDetail(await api.caseDetail(id) as never);
    setComment("");
  }

  if (error) return <p className="text-danger">{error}</p>;
  if (!rows) return <p className="text-muted">Loading cases…</p>;
  const evs = ((detail?.events as Record<string,unknown>[]) ?? []);
  const exs = ((detail?.exceptions as Record<string,unknown>[]) ?? []);
  const c = detail?.case as Record<string,unknown> | undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Cases</h1>
          <p className="text-sm text-muted">Exceptions clustered by root-cause keys. Owners, SLA clocks, comments and linked actions stay in-app.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={view==="kanban"?"default":"outline"} onClick={()=>setView("kanban")}>Kanban</Button>
          <Button size="sm" variant={view==="list"?"default":"outline"} onClick={()=>setView("list")}>List</Button>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Open cases" value={String(rows.filter(r=>r.status!=="resolved").length)} />
        <KpiCard label="Overdue SLA" value={String(overdue)} tone={overdue?"warn":"ok"} />
        <KpiCard label="Total leakage in cases" value={inr(rows.reduce((s,r)=>s+Number(r.leakage||0),0), true)} tone="leak" />
      </div>
      {view==="kanban" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map((col) => (
            <div key={col.id} className="min-w-0 rounded-xl border border-line bg-white p-3">
              <div className="mb-2 flex justify-between text-xs uppercase tracking-wide text-muted">
                <span>{col.title}</span><span>{(grouped[col.id]||[]).length}</span>
              </div>
              <div className="space-y-2">
                {(grouped[col.id]||[]).slice(0,12).map((c0) => (
                  <button key={c0.case_id} type="button" onClick={()=>setSel(c0.case_id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${sel===c0.case_id?"border-accent bg-slate-50":"border-line"}`}>
                    <div className="truncate font-medium" title={c0.title}>{c0.title}</div>
                    <div className="flex justify-between gap-2 text-[11px] text-muted">
                      <span className="truncate">{c0.owner ?? "Unassigned"}{c0.overdue?" · overdue":""}</span>
                      <span className="tabular-nums">{inr(Number(c0.leakage||0), true)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted"><tr>
                <th className="pb-2 pr-3">Case</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Owner</th><th className="pb-2 pr-3">SLA</th><th className="pb-2 text-right">Leakage</th>
              </tr></thead>
              <tbody>
                {rows.map((c0)=>(
                  <tr key={c0.case_id} className="border-t border-line cursor-pointer" onClick={()=>setSel(c0.case_id)}>
                    <td className="max-w-[280px] truncate py-2 pr-3" title={c0.title}>{c0.title}</td>
                    <td className="py-2 pr-3 capitalize">{c0.status.replace(/_/g," ")}</td>
                    <td className="py-2 pr-3">{c0.owner ?? "—"}</td>
                    <td className="py-2 pr-3">{c0.overdue ? "Overdue" : (c0.sla_due ? String(c0.sla_due).slice(0,10) : "—")}</td>
                    <td className="py-2 text-right tabular-nums">{inr(Number(c0.leakage||0), true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {c && (
        <Card>
          <CardHeader>
            <CardTitle>{String(c.title)}</CardTitle>
            <CardDescription>{String(c.status).replace(/_/g," ")} · owner {String(c.owner??"unassigned")} · cause {String(c.cause_key)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{String(c.cause_label)}</p>
            <div className="flex flex-wrap gap-2">
              {COLS.map((col) => <Button key={col.id} size="sm" variant="outline" onClick={()=>void act(String(c.case_id), { status: col.id })}>{col.title}</Button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <input value={comment} onChange={(e)=>setComment(e.target.value)} placeholder="Add a comment" className="min-w-[16rem] flex-1 rounded-md border border-line px-3 py-2 text-sm" />
              <Button size="sm" disabled={!comment.trim()} onClick={()=>void act(String(c.case_id), { comment })}>Add comment</Button>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Linked exceptions</h3>
              <ul className="mt-1 space-y-1">
                {exs.map((e, i) => {
                  const id = typeof e === "string" ? e : String((e as Record<string, unknown>).exception_id ?? "");
                  const leak = typeof e === "object" && e && "leakage" in (e as object) ? Number((e as Record<string, unknown>).leakage || 0) : null;
                  return (
                    <li key={id || i} className="truncate">
                      <Link className="text-accent hover:underline" to={`/investigate/${encodeURIComponent(id)}`}>{id}</Link>
                      {leak != null ? <span className="text-muted"> · {inr(leak, true)}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">History</h3>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {evs.map((ev)=>(
                  <li key={String(ev.event_id)}><span className="text-ink">{String(ev.kind)}</span> · {String(ev.actor)} · {String(ev.body)}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
