import { useEffect, useState } from "react";
import { useAuth } from "@/auth";
import { api, type ContractRule, type ContractsPayload, type DocumentDetail, type RuleTest } from "@/api";
import { KpiCard } from "@/components/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ContractsPage() {
  const canApproveRules = useAuth().can("approve_review");
  const canTest = useAuth().can("recon_run");
  const [data, setData] = useState<ContractsPayload | null>(null);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [sel, setSel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [tests, setTests] = useState<RuleTest[] | null>(null);
  const [testNote, setTestNote] = useState("");

  async function load() {
    try { setData(await api.contracts()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!sel) { setDoc(null); return; }
    api.contractDoc(sel).then(setDoc).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sel]);

  async function extract() {
    if (!sel) return;
    setBusy("extract");
    try { await api.extractContract(sel); await load(); setDoc(await api.contractDoc(sel)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id);
    try {
      await api.decideRule(id, status);
      await load();
      if (sel) setDoc(await api.contractDoc(sel));
      if (ruleId === id) await loadTests(id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function loadTests(id: string) {
    setRuleId(id);
    try {
      const r = await api.ruleTests(id);
      setTests(r.tests);
      setTestNote(r.note ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function runTests(id: string) {
    setBusy("tests");
    try {
      const r = await api.runRuleTests(id);
      setRuleId(id);
      setTests(r.tests);
      setTestNote(r.note ?? (r.passed ? "All edge-case tests passed." : "One or more tests failed."));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading contracts…</p>;
  const pending = data.rules.filter((r) => r.status === "extracted").length;
  const approved = data.rules.filter((r) => r.status === "approved").length;
  const impact = data.impact.reduce((s, r) => s + Number(r.leakage || 0), 0);
  const selected = data.rules.find((r) => r.rule_id === ruleId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Contracts &amp; rules</h1>
        <p className="text-sm text-muted">
          Synthetic documents in Neon with pgvector retrieval. Each rule is a strict schema
          (<code>rule_name</code>, exact <code>contract_citation</code>, and a validated
          <code>sql_expression</code>). The expression is checked as an AST, executed in Postgres NUMERIC
          under a read-only role, and must pass synthetic edge-case tests plus human approval before it becomes live SQL.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Pending approval" value={String(pending)} tone="warn" />
        <KpiCard label="Approved rules" value={String(approved)} tone="ok" />
        <KpiCard label="SQL-detected impact" value={inr(impact, true)} tone="leak" hint="Unapplied rebate, wrong tier, fee change, expired terms" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>Select a schedule, bulletin or agreement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.documents.map((d) => (
              <button key={d.doc_id} type="button" onClick={() => setSel(d.doc_id)}
                className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm", sel===d.doc_id ? "border-accent bg-slate-50" : "border-line")}>
                <div className="truncate font-medium text-ink">{d.title}</div>
                <div className="text-[11px] text-muted">{d.kind.replace(/_/g," ")} · {d.party} · {d.approved}/{d.rules} approved</div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Document viewer</CardTitle>
            <CardDescription>{doc ? String(doc.document.title) : "Pick a document"}</CardDescription>
          </CardHeader>
          <CardContent>
            {!doc && <p className="text-sm text-muted">Choose a document to read clauses and extract rules.</p>}
            {doc && (
              <div className="space-y-3">
                <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-50 p-3 text-xs text-ink">{String(doc.document.body_markdown)}</div>
                <Button disabled={busy==="extract"} onClick={() => void extract()}>{busy==="extract" ? "Extracting…" : "Extract rules (LLM)"}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Extracted rules</CardTitle>
          <CardDescription>Approve a rule only after its edge-case tests pass. Rejected rules are not executed. Z3 is not used in-app; it remains an optional offline prover.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="pb-2 pr-3">Rule</th><th className="pb-2 pr-3">Rate</th><th className="pb-2 pr-3">Citation</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3 text-right">Impact</th><th className="pb-2">Action</th></tr>
            </thead>
            <tbody>
              {data.rules.map((r: ContractRule) => (
                <tr key={r.rule_id} className="border-t border-line">
                  <td className="max-w-[220px] py-2 pr-3 align-top">
                    <button type="button" className="block w-full truncate text-left font-medium text-accent hover:underline" title={r.rule_name || r.rule_id} onClick={() => void loadTests(r.rule_id)}>{r.rule_name || r.party}</button>
                    <div className="truncate text-[11px] text-muted">{r.party} · {r.fee_type}</div>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{r.rate ?? "—"} {r.unit}{r.threshold ? ` · ≥ ${r.threshold}` : ""}</td>
                  <td className="max-w-[240px] truncate py-2 pr-3 text-xs text-muted" title={r.citation}>{r.citation}</td>
                  <td className="py-2 pr-3 capitalize">{r.status}{Number(r.tests_passed) ? " · tests pass" : r.sql_expression ? " · tests pending" : ""}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-danger">{Number(r.impact||0) ? inr(Number(r.impact), true) : "—"}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.status === "extracted" && canApproveRules && (
                        <>
                          <Button size="sm" disabled={!!busy || !Number(r.tests_passed)} onClick={() => void decide(r.rule_id, "approved")}>Approve</Button>
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void decide(r.rule_id, "rejected")}>Reject</Button>
                        </>
                      )}
                      {canTest ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runTests(r.rule_id)}>Run tests</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {ruleId && (
        <Card>
          <CardHeader>
            <CardTitle>Edge-case tests{selected ? ` · ${selected.rule_name || selected.rule_id}` : ""}</CardTitle>
            <CardDescription>
              Expected results are derived from the structured parameters (exactly 10,000 or the rule threshold, just above, cap hits, zero-MDR rails). The validated expression then runs in Postgres NUMERIC under <code>ra_readonly</code> with a statement timeout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {testNote && <p className="text-xs text-muted">{testNote}</p>}
            {tests && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr><th className="pb-2 pr-3">Test</th><th className="pb-2 pr-3">Inputs</th><th className="pb-2 pr-3 text-right">Expected</th><th className="pb-2 pr-3 text-right">Actual</th><th className="pb-2">Result</th></tr>
                  </thead>
                  <tbody>
                    {tests.map((trow) => (
                      <tr key={trow.test_id} className="border-t border-line">
                        <td className="max-w-[200px] truncate py-2 pr-3" title={trow.note}>{trow.name}</td>
                        <td className="max-w-[260px] truncate py-2 pr-3 text-xs text-muted" title={JSON.stringify(trow.inputs)}>
                          {Object.entries(trow.inputs).filter(([k, v]) => v !== false && v !== "INR" && k !== "currency").map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{trow.expected}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{trow.actual ?? "—"}</td>
                        <td className="py-2">{trow.passed == null ? "—" : trow.passed ? "Pass" : "Fail"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-ink">{selected?.sql_expression || "No sql_expression yet."}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
