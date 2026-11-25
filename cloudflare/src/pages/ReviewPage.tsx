import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ReviewDetail } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inrExact } from "../../shared/money";
import { AuditPanel } from "@/components/AuditPanel";
import { useAuth } from "@/auth";
import { RecoveryPanel } from "@/components/RecoveryPanel";

function asObj(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") { try { return JSON.parse(v) as Record<string, unknown>; } catch { return { text: v }; } }
  if (typeof v === "object") return v as Record<string, unknown>;
  return { text: String(v) };
}

export default function ReviewPage() {
  const { can } = useAuth();
  const canDecide = can("approve_review");
  const { id = "" } = useParams();
  const decoded = decodeURIComponent(id);
  const [data, setData] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");

  async function load() {
    try { setData(await api.review(decoded)); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, [decoded]);

  async function decide(decision: "approved"|"rejected"|"reinvestigate") {
    if (!comment.trim()) { setError("A comment is required."); return; }
    setBusy(decision); setError("");
    try {
      const amt = override.trim()==="" ? undefined : Number(override);
      await api.submitReview(decoded, { decision, comment, amount_override: Number.isFinite(amt as number) ? amt : undefined });
      setDone(decision);
      setComment("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  if (error && !data) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading review…</p>;
  const inv = asObj(data.investigator);
  const act = asObj(data.action);
  const aud = asObj(data.auditor);
  const recAmt = Number(data.item.amount ?? 0);
  const pending = data.item.review_status === "pending";
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted"><Link to="/review" className="hover:underline">Review queue</Link></p>
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink" title={decoded}>Human review</h1>
        <p className="text-sm text-muted">No emails, disputes or claims are sent from this page. A decision is recorded on the case, the action queue and the learning log.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Exception summary</CardTitle>
          <CardDescription>{data.item.area} · {data.item.category} · {data.item.merchant_id ?? "—"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-mono text-xs text-muted truncate" title={decoded}>{decoded}</p>
          <p>{String(data.item.description ?? "—")}</p>
          <p>Leakage: <strong className="tabular-nums">{inrExact(recAmt)}</strong></p>
          <p>Recommended action: <strong>{String((() => {
            const list = Array.isArray(act.actions) ? act.actions : [];
            const first = list[0] && typeof list[0] === "object" && list[0] !== null ? (list[0] as Record<string, unknown>) : {};
            return act.action ?? act.recommendation ?? first.type ?? "—";
          })())}</strong></p>
          {data.item.case_id && <p>Linked case: <Link className="text-accent hover:underline" to="/cases">{String(data.item.case_id)}</Link></p>}
          <p>Investigate: <Link className="text-accent hover:underline" to={`/investigate/${encodeURIComponent(decoded)}`}>Open investigation</Link></p>
        </CardContent>
      </Card>
      <RecoveryPanel exceptionId={String(data.item.exception_id ?? decoded)} />
      <Card>
        <CardHeader>
          <CardTitle>Auditor review</CardTitle>
          <CardDescription>Structured checks and proposed next steps. Accept creates an in-app Action Queue item; Dismiss requires a comment.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuditPanel
            output={aud}
            exceptionId={decoded}
            decisions={data.suggestion_decisions}
            onDecided={() => void load()}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Evidence / SQL facts</CardTitle></CardHeader>
          <CardContent><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(data.item.facts ?? inv.facts ?? inv.evidence ?? inv, null, 2)}</pre></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Investigator</CardTitle></CardHeader>
          <CardContent><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(inv, null, 2)}</pre></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recommended action</CardTitle></CardHeader>
          <CardContent><pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(act, null, 2)}</pre></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>Comment is mandatory. Optional amount override is stored with the decision.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-sm text-danger">{error}</p>}
          {done && <p className="text-sm text-success">Recorded as {done}. Nothing was sent externally.</p>}
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Comment (required)</span>
            <textarea value={comment} onChange={(e)=>setComment(e.target.value)} rows={3} className="w-full rounded-md border border-line px-3 py-2 text-sm" disabled={!pending} />
          </label>
          <label className="block max-w-xs text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Amount override (optional)</span>
            <input value={override} onChange={(e)=>setOverride(e.target.value)} className="w-full rounded-md border border-line px-3 py-2 text-sm tabular-nums" disabled={!pending} />
          </label>
          {pending && canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!busy} onClick={()=>void decide("approved")}>{busy==="approved"?"Saving…":"Approve"}</Button>
              <Button variant="outline" disabled={!!busy} onClick={()=>void decide("rejected")}>{busy==="rejected"?"Saving…":"Reject"}</Button>
              <Button variant="outline" disabled={!!busy} onClick={()=>void decide("reinvestigate")}>{busy==="reinvestigate"?"Saving…":"Send back for re-investigation"}</Button>
            </div>
          ) : pending ? <p className="text-sm text-muted">This role can view the review but cannot record a decision.</p>
          : <p className="text-sm text-muted">This item already has a decision ({data.item.review_status}).</p>}
        </CardContent>
      </Card>
    </div>
  );
}
