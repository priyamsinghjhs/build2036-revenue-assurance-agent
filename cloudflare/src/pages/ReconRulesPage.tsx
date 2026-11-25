import { useEffect, useState } from "react";
import { api, type RuleConfig, type RuleHistoryRow, type RulesResponse } from "@/api";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FIELDS = [
  ["amount_tolerance", "Amount tolerance (₹)"],
  ["fx_tolerance_bps", "FX tolerance (bps)"],
  ["fee_variance_bps", "Fee variance (bps)"],
  ["date_window_days", "Date window (days)"],
] as const;

function fmtChange(v: unknown) {
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export default function ReconRulesPage() {
  const { can, user } = useAuth();
  const [data, setData] = useState<RulesResponse | null>(null);
  const [draft, setDraft] = useState<RuleConfig | null>(null);
  const [history, setHistory] = useState<RuleHistoryRow[]>([]);
  const [note, setNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [r, h] = await Promise.all([api.reconRules(), api.reconRuleHistory()]);
    setData(r);
    setDraft(JSON.parse(JSON.stringify(r.active.config)) as RuleConfig);
    setHistory(h.history);
  }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function propose() {
    if (!data || !draft) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await api.proposeReconRules({ config: draft, note, base_version: data.active.version });
      setMsg(`Proposed version ${r.version} (${r.changes.length} change${r.changes.length === 1 ? "" : "s"}). A different approver must approve it before recon uses it.`);
      setNote("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function decide(version: number, decision: "approve" | "reject") {
    setBusy(true); setError(""); setMsg("");
    try {
      await api.decideReconRules(version, decision, decisionNote);
      setMsg(decision === "approve" ? `Version ${version} is now active. The next recon run reads it.` : `Version ${version} rejected.`);
      setDecisionNote("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (error && !data) return <p className="text-danger">{error}</p>;
  if (!data || !draft) return <p className="text-muted">Loading recon rules…</p>;
  const canEdit = can("settings");
  const setArea = (area: string, field: string, value: unknown) =>
    setDraft({ ...draft, areas: { ...draft.areas, [area]: { ...draft.areas[area], [field]: value } } });

  return (
    <div className="space-y-6" data-testid="recon-rules-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Recon rules &amp; tolerances</h1>
        <p className="text-sm text-muted">
          Active version <strong>{data.active.version}</strong>
          {data.active.decided_by ? ` · approved by ${data.active.decided_by}` : ""}. Recon reads these at run time. Changes are
          versioned, need a second approver (maker-checker) and are audited. All-zero tolerances reproduce the original results.
        </p>
      </header>
      {msg && <p className="text-sm text-success">{msg}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>{canEdit ? "Edit and propose" : "Active rules"}</CardTitle>
          <CardDescription>A row is cleared as within tolerance only when |leakage| is strictly below a positive limit. Matching keys document which exception-row columns pair records.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto text-sm">
          <table className="w-full">
            <thead className="text-left text-[11px] uppercase text-muted">
              <tr><th className="py-2">Area</th>{FIELDS.map(([f, l]) => <th key={f}>{l}</th>)}<th>Matching keys</th></tr>
            </thead>
            <tbody>
              {data.areas.map((area) => (
                <tr key={area} className="border-t border-line">
                  <td className="py-2 font-medium">{area}</td>
                  {FIELDS.map(([f]) => (
                    <td key={f} className="pr-2">
                      <input
                        type="number" min={data.limits[f]?.min} max={data.limits[f]?.max} step="any"
                        disabled={!canEdit}
                        value={String(draft.areas[area][f])}
                        onChange={(e) => setArea(area, f, e.target.value === "" ? 0 : Number(e.target.value))}
                        className="w-28 rounded-md border border-line px-2 py-1 tabular-nums"
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      disabled={!canEdit}
                      value={draft.areas[area].matching_keys.join(", ")}
                      onChange={(e) => setArea(area, "matching_keys", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
                      className="w-56 rounded-md border border-line px-2 py-1"
                      title={`Allowed: ${data.matching_key_columns.join(", ")}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] uppercase text-muted">Match quality: good ≥</span>
              <input type="number" step="0.001" disabled={!canEdit} value={draft.global.match_good} onChange={(e) => setDraft({ ...draft, global: { ...draft.global, match_good: Number(e.target.value) } })} className="w-24 rounded-md border border-line px-2 py-1" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] uppercase text-muted">watch ≥</span>
              <input type="number" step="0.001" disabled={!canEdit} value={draft.global.match_watch} onChange={(e) => setDraft({ ...draft, global: { ...draft.global, match_watch: Number(e.target.value) } })} className="w-24 rounded-md border border-line px-2 py-1" />
            </label>
            {canEdit && (
              <>
                <label className="block flex-1 text-sm">
                  <span className="mb-1 block text-[11px] uppercase text-muted">Reason (required)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-md border border-line px-2 py-1" />
                </label>
                <Button disabled={busy || !note.trim()} onClick={() => void propose()}>Propose change</Button>
                <Button variant="outline" disabled={busy} onClick={() => setDraft(JSON.parse(JSON.stringify(data.defaults)) as RuleConfig)}>Reset to defaults</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pending approval</CardTitle>
          <CardDescription>The proposer cannot approve their own change. CFO, auditor or admin approve.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!data.proposals.length && <p className="text-muted">Nothing pending.</p>}
          {data.proposals.map((p) => (
            <div key={p.version} className="rounded-md border border-line p-3">
              <div className="font-medium">Version {p.version} · by {p.proposed_by} · based on v{p.base_version}</div>
              <div className="text-muted">“{p.note}”</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {p.changes.map((c) => <li key={c.path}><code>{c.path}</code>: {fmtChange(c.old)} → {fmtChange(c.new)}</li>)}
              </ul>
              {can("approve_review") && user?.id !== p.proposed_by ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input placeholder="Decision note" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} className="rounded-md border border-line px-2 py-1" />
                  <Button size="sm" disabled={busy} onClick={() => void decide(p.version, "approve")}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(p.version, "reject")}>Reject</Button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">Waiting for a different approver.</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Audit trail</CardTitle><CardDescription>Who changed what, when, old → new.</CardDescription></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs">
            {history.map((h) => (
              <li key={h.id}>
                {String(h.at).slice(0, 16).replace("T", " ")} · v{h.version} {h.action} by {h.actor}{h.role ? ` (${h.role})` : ""}
                {h.changes?.length ? ` · ${h.changes.map((c) => `${c.path}: ${fmtChange(c.old)} → ${fmtChange(c.new)}`).join("; ")}` : ""}
                {h.note ? ` · “${h.note}”` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
