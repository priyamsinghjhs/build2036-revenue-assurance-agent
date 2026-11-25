import { useEffect, useState } from "react";
import { api, type RecoveryHistoryRow, type RecoveryRow } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inrExact } from "../../shared/money";
import { RECOVERY_LABELS, type RecoveryState } from "../../shared/recovery";

const label = (s: string) => RECOVERY_LABELS[s as RecoveryState] ?? s;

/** Recovery lifecycle on the review detail page. Figures come from /api/recovery (SQL). */
export function RecoveryPanel({ exceptionId }: { exceptionId: string }) {
  const [item, setItem] = useState<RecoveryRow | null>(null);
  const [history, setHistory] = useState<RecoveryHistoryRow[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  async function load() {
    try {
      const r = await api.recoveryItem(exceptionId);
      setItem(r.item);
      setHistory(r.history);
      setAllowed(r.allowed_next);
      setTo(r.allowed_next[0] ?? "");
      setError("");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [exceptionId]);

  async function submit() {
    if (!item || !to) return;
    setBusy(true);
    setError("");
    try {
      await api.recoveryTransition(exceptionId, {
        to,
        amount: amount.trim() === "" ? undefined : Number(amount),
        owner: owner.trim() || undefined,
        due_date: due || undefined,
        note: note.trim() || undefined,
        expected_version: item.version,
      });
      setAmount("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return null;
  return (
    <Card data-testid="recovery-panel">
      <CardHeader>
        <CardTitle>Recovery</CardTitle>
        <CardDescription>Track this item to closure. Amounts are from SQL; every change is audited. Nothing is sent outside the app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-danger">{error}</p>}
        {!item ? (
          <p className="text-muted">Loading recovery…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div><div className="text-[11px] uppercase text-muted">State</div><strong data-testid="recovery-state">{label(item.state)}</strong></div>
              <div><div className="text-[11px] uppercase text-muted">Expected</div><strong className="tabular-nums">{inrExact(item.expected_amount)}</strong></div>
              <div><div className="text-[11px] uppercase text-muted">Recovered</div><strong className="tabular-nums">{inrExact(item.recovered_amount)}</strong></div>
              <div><div className="text-[11px] uppercase text-muted">Outstanding</div><strong className="tabular-nums">{inrExact(item.outstanding)}</strong></div>
              <div>
                <div className="text-[11px] uppercase text-muted">Owner · due (SLA)</div>
                <strong>{item.owner ?? "—"}</strong> · <span className={item.overdue ? "text-danger" : ""}>{item.due_date ?? "—"}{item.overdue ? " overdue" : ""}</span>
              </div>
            </div>
            {allowed.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 items-end">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Move to</span>
                  <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-md border border-line px-2 py-2">
                    {allowed.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Amount (₹)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={to === "recovered" ? String(item.outstanding) : ""} disabled={to !== "partially_recovered" && to !== "recovered"} className="w-full rounded-md border border-line px-2 py-2 tabular-nums" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Owner</span>
                  <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={item.owner ?? "you"} className="w-full rounded-md border border-line px-2 py-2" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Due date</span>
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-full rounded-md border border-line px-2 py-2" />
                </label>
                <label className="block lg:col-span-1">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Note</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-line px-2 py-2" />
                </label>
                <Button disabled={busy || !to} onClick={() => void submit()}>{busy ? "Saving…" : "Record"}</Button>
              </div>
            ) : (
              <p className="text-muted">{item.state === "closed" ? "Closed." : "Your role has no allowed next step for this item (closing needs a different user from the last update)."}</p>
            )}
            {history.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase text-muted">History</div>
                <ul className="space-y-1 text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="tabular-nums">
                      {String(h.at).slice(0, 16).replace("T", " ")} · {h.actor} ({h.role}) · {label(h.from_state)} → {label(h.to_state)}
                      {Number(h.amount_delta) ? ` · +${inrExact(Number(h.amount_delta))}` : ""}{h.note ? ` · “${h.note}”` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
