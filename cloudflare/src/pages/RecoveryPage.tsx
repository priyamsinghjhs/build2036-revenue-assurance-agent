import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RecoveryRow, type RecoveryTotals } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inrExact } from "../../shared/money";
import { RECOVERY_LABELS, RECOVERY_STATES, type RecoveryState } from "../../shared/recovery";
import { pct } from "@/lib/format";

const PAGE = 50;

export default function RecoveryPage() {
  const [totals, setTotals] = useState<RecoveryTotals | null>(null);
  const [rows, setRows] = useState<RecoveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .recovery({ state, limit: PAGE, offset })
      .then((r) => {
        setTotals(r.totals);
        setRows(r.rows);
        setTotal(r.page.total);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [state, offset]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!totals) return <p className="text-muted">Loading recovery tracker…</p>;
  return (
    <div className="space-y-6" data-testid="recovery-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Recovery tracker</h1>
        <p className="text-sm text-muted">
          Every book exception from identified to closed. Potential equals book leakage; all figures are SQL sums over{" "}
          <code>v_ra_recovery_tracker</code>{totals.scoped ? " (filtered to your role's scope)" : ""}.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Potential" value={inrExact(totals.potential)} hint={`${totals.n ?? total} book exceptions`} />
        <KpiCard label="Recovered" value={inrExact(totals.recovered)} tone="ok" />
        <KpiCard label="Recovery rate" value={pct(totals.recovery_rate, 2)} hint="recovered ÷ potential" />
        <KpiCard label="Written off" value={inrExact(totals.written_off)} tone="leak" />
        <KpiCard label="Open" value={inrExact(totals.open)} hint={totals.overdue != null ? `${totals.overdue} past due date` : undefined} tone="warn" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>By state</CardTitle>
          <CardDescription>Click a state to filter the list.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <Button variant={state === "" ? "default" : "outline"} size="sm" onClick={() => { setState(""); setOffset(0); }}>All</Button>
          {RECOVERY_STATES.map((s) => {
            const b = totals.by_state[s] ?? { n: 0, expected: 0, recovered: 0 };
            return (
              <Button key={s} variant={state === s ? "default" : "outline"} size="sm" onClick={() => { setState(s); setOffset(0); }}>
                {RECOVERY_LABELS[s]} · {b.n} · {inrExact(b.expected)}
              </Button>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-muted">
              <tr><th className="py-2">Exception</th><th>State</th><th className="text-right">Expected</th><th className="text-right">Recovered</th><th className="text-right">Outstanding</th><th>Owner</th><th>Due</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.exception_id} className="border-t border-line">
                  <td className="py-2"><Link className="text-accent hover:underline" to={`/review/${encodeURIComponent(r.exception_id)}`}>{r.area} · {r.category.replace(/_/g, " ")} · {r.ref_id}</Link></td>
                  <td>{RECOVERY_LABELS[r.state as RecoveryState] ?? r.state}</td>
                  <td className="text-right tabular-nums">{inrExact(r.expected_amount)}</td>
                  <td className="text-right tabular-nums">{inrExact(r.recovered_amount)}</td>
                  <td className="text-right tabular-nums">{inrExact(r.outstanding)}</td>
                  <td>{r.owner ?? "—"}</td>
                  <td className={r.overdue ? "text-danger" : ""}>{r.due_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : "No items"}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
