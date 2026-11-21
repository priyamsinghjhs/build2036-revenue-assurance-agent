import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { fetchSettlements, runAgent } from "./api";
import {
  AGENT_STEPS,
  RESULT_TABS,
  type InvestigationResult,
  type SettlementListRow,
  type TabId,
} from "./types";

export default function App() {
  const [settlements, setSettlements] = useState<SettlementListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [running, setRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [tab, setTab] = useState<TabId>("CFO Summary");

  useEffect(() => {
    let cancelled = false;
    fetchSettlements()
      .then(({ settlements: rows }) => {
        if (cancelled) return;
        setSettlements(rows);
        if (rows.length) setSelected((prev) => prev || rows[0].settlement_id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setSettlements([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMeta = useMemo(
    () => settlements?.find((row) => row.settlement_id === selected),
    [settlements, selected],
  );

  async function onRun() {
    if (!selected || running) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    setTab("CFO Summary");
    let state: InvestigationResult = { settlement_id: selected, audit_trail: [] };
    try {
      for (const step of AGENT_STEPS) {
        setCurrentAgent(step.label);
        const next = await runAgent(step.path, state);
        state = { ...state, ...next };
        setResult({ ...state });
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      setResult(state.audit_trail.length ? state : null);
    } finally {
      setRunning(false);
      setCurrentAgent(null);
    }
  }

  return (
    <div className="flex min-h-screen bg-white text-[#31333f]">
      <aside className="hidden w-64 shrink-0 border-r border-[#d6d6d9] bg-[#f0f2f6] px-6 py-8 md:block">
        <Sidebar />
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6 md:px-10">
        <h1 className="text-[1.85rem] font-semibold tracking-tight">
          Agentic Revenue Assurance Copilot
        </h1>
        <p className="mt-1 text-[0.95rem] text-[#808495]">
          BUILD 2036 — Applied AI & Agentic Intelligence | Open-source multi-agent system
        </p>

        <div className="mt-6 md:hidden">
          <Sidebar />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_2fr]">
          <section>
            <h2 className="mb-3 text-xl font-semibold">Select Case</h2>
            {loadError ? (
              <div className="rounded-md border border-[#ff4b4b]/40 bg-[#ff4b4b]/10 px-3 py-2 text-sm text-[#7a0010]">
                {loadError}
              </div>
            ) : settlements === null ? (
              <p className="text-sm text-[#808495]">Loading settlements…</p>
            ) : settlements.length === 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
                No settlements found. The database may need to be re-initialized.
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium" htmlFor="settlement">
                  Settlement
                </label>
                <div className="mt-1" data-testid="stSelectbox">
                  <select
                    id="settlement"
                    aria-label="Settlement"
                    className="w-full rounded-md border border-[#d6d6d9] bg-white px-3 py-2 text-sm shadow-sm focus:border-[#ff4b4b] focus:outline-none"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    disabled={running}
                  >
                    {settlements.map((row) => (
                      <option key={row.settlement_id} value={row.settlement_id}>
                        {row.settlement_id}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedMeta && (
                  <p className="mt-2 text-xs text-[#808495]">
                    Expected {selectedMeta.expected_amount} · Settled {selectedMeta.settled_amount} ·{" "}
                    {selectedMeta.status}
                  </p>
                )}
                <button
                  type="button"
                  className="mt-4 rounded-md bg-[#ff4b4b] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#ff2b2b] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onRun}
                  disabled={!selected || running}
                >
                  Run Investigation
                </button>
                {running && (
                  <div className="mt-4 flex items-center gap-3 text-sm text-[#31333f]">
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#ff4b4b] border-t-transparent" />
                    <span>
                      Agents investigating...
                      {currentAgent ? ` ${currentAgent}` : ""}
                    </span>
                  </div>
                )}
                {runError && (
                  <div className="mt-4 rounded-md border border-[#ff4b4b]/40 bg-[#ff4b4b]/10 px-3 py-2 text-sm text-[#7a0010]">
                    {runError}
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            {result ? (
              <>
                <h2 className="mb-3 text-xl font-semibold">Investigation Results</h2>
                <div role="tablist" aria-label="Investigation Results" className="flex flex-wrap gap-1 border-b border-[#d6d6d9]">
                  {RESULT_TABS.map((name) => {
                    const selectedTab = tab === name;
                    return (
                      <button
                        key={name}
                        role="tab"
                        aria-selected={selectedTab}
                        className={`px-3 py-2 text-sm font-medium ${
                          selectedTab
                            ? "border-b-2 border-[#ff4b4b] text-[#31333f]"
                            : "text-[#808495] hover:text-[#31333f]"
                        }`}
                        onClick={() => setTab(name)}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                <div className="pt-4" role="tabpanel">
                  <TabBody tab={tab} result={result} />
                </div>
              </>
            ) : (
              <p className="pt-10 text-sm text-[#808495]">
                Select a settlement and run an investigation to see the five-agent results here.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <div>
      <h3 className="text-base font-semibold">Agents</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>Anomaly Detector</li>
        <li>Investigator</li>
        <li>Evidence Synthesizer</li>
        <li>Recommendation Agent</li>
        <li>Auditor / Explainer</li>
      </ol>
      <h3 className="mt-6 text-base font-semibold">Stack</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>D1 (SQLite)</li>
        <li>Cloudflare Workers AI (Llama 4 Scout)</li>
        <li>TypeScript Worker</li>
        <li>React + Vite + Tailwind</li>
      </ul>
    </div>
  );
}

function TabBody({ tab, result }: { tab: TabId; result: InvestigationResult }) {
  if (tab === "CFO Summary") {
    return <div className="markdown-body text-sm"><Markdown>{result.cfo_summary || "No summary"}</Markdown></div>;
  }
  if (tab === "Recommendation") {
    return (
      <pre className="overflow-auto rounded-md bg-[#f0f2f6] p-4 font-mono text-sm whitespace-pre-wrap">
        {result.recommendation || ""}
      </pre>
    );
  }
  if (tab === "Evidence") {
    return <div className="markdown-body text-sm"><Markdown>{result.evidence || ""}</Markdown></div>;
  }
  if (tab === "Investigation") {
    return <div className="markdown-body text-sm"><Markdown>{result.investigation || ""}</Markdown></div>;
  }
  return (
    <div className="space-y-3 font-mono text-xs leading-5 whitespace-pre-wrap">
      {(result.audit_trail ?? []).map((step, i) => (
        <p key={i}>{step}</p>
      ))}
    </div>
  );
}
