import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Play, RefreshCw } from "lucide-react";
import { api, type ActionRow, type LatestRun, type Roster } from "../api";
import { SeverityBadge, StatusDot } from "../components/SeverityBadge";
import { inr, prettyCat } from "../lib/format";

const DOMAINS = [
  { id: "all", label: "Run all" },
  { id: "authorization", label: "Auth / Capture" },
  { id: "scheme", label: "Scheme" },
  { id: "fees", label: "Network & Gateway" },
  { id: "partner", label: "Partner fees" },
  { id: "terminal", label: "POS terminals" },
  { id: "bank_trs", label: "TRS bank" },
  { id: "apm", label: "APM" },
  { id: "fx", label: "FX" },
];

type StepStatus = "idle" | "running" | "done" | "cached" | "error";

export default function AgentsPage() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [latest, setLatest] = useState<LatestRun | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [status, setStatus] = useState<Record<string, StepStatus>>({});
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [active, setActive] = useState<string>("orchestrator");
  const [domain, setDomain] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  const loadCached = useCallback(async (scope: string) => {
    const [{ latest: cached }, act] = await Promise.all([api.latest(scope), api.actions()]);
    setActions(act.actions);
    if (cached) {
      setLatest(cached);
      const map: Record<string, unknown> = {};
      const st: Record<string, StepStatus> = {};
      for (const o of cached.outputs) {
        map[o.agent_id] = o.output;
        st[o.agent_id] = "cached";
      }
      setOutputs(map);
      setStatus(st);
      if (cached.outputs[0]) setActive(cached.outputs[0].agent_id);
    }
  }, []);

  useEffect(() => {
    api
      .roster()
      .then(setRoster)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    loadCached("all").catch(() => undefined);
  }, [loadCached]);

  async function runPipeline() {
    if (!roster) return;
    setBusy(true);
    setError("");
    try {
      const started = await api.startRun({ scope: domain, domain: domain === "all" ? undefined : domain });
      setRunId(started.run_id);
      const nextStatus: Record<string, StepStatus> = {};
      const nextOut: Record<string, unknown> = {};
      for (const id of started.sequence) nextStatus[id] = "idle";
      setStatus({ ...nextStatus });
      setOutputs({});
      for (const agentId of started.sequence) {
        setActive(agentId);
        setStatus((s) => ({ ...s, [agentId]: "running" }));
        const step = await api.step({
          run_id: started.run_id,
          agent_id: agentId,
          scope: domain,
          domain: domain === "all" ? "" : domain,
        });
        nextOut[agentId] = step.output;
        setOutputs((o) => ({ ...o, [agentId]: step.output }));
        setStatus((s) => ({ ...s, [agentId]: "done" }));
      }
      await api.complete(started.run_id);
      const act = await api.actions();
      setActions(act.actions);
      setLatest({
        run: { run_id: started.run_id, status: "completed" },
        outputs: started.sequence.map((id) => ({
          agent_id: id,
          domain: domain === "all" ? null : domain,
          output: nextOut[id],
          created_at: new Date().toISOString(),
        })),
        actions: act.actions.filter((a) => a.run_id === started.run_id),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nodes: Node[] = useMemo(() => {
    if (!roster) return [];
    const reconIndex = new Map(
      roster.agents.filter((x) => x.kind === "reconciliation").map((x, i) => [x.id, i]),
    );
    return roster.agents.map((a) => {
      let x = 0, y = 160;
      if (a.kind === "orchestrator") { x = 0; y = 160; }
      else if (a.kind === "reconciliation") {
        const i = reconIndex.get(a.id) ?? 0;
        x = 180 + (i % 4) * 155;
        y = 30 + Math.floor(i / 4) * 100;
      } else if (a.kind === "gap") { x = 820; y = 160; }
      else if (a.kind === "investigate") { x = 1000; y = 160; }
      else if (a.kind === "action") { x = 1180; y = 160; }
      else { x = 1360; y = 160; }
      const st = status[a.id] || "idle";
      const border =
        st === "running" ? "#22d3ee" : st === "error" ? "#fb7185" : st === "done" || st === "cached" ? "#34d399" : "#334155";
      return {
        id: a.id,
        position: { x, y },
        data: { label: a.name },
        style: {
          background: active === a.id ? "#164e63" : "#152033",
          color: "#e5eef7",
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: 6,
          width: 150,
          fontSize: 11,
          fontWeight: 600,
        },
      } satisfies Node;
    });
  }, [roster, status, active]);

  const edges: Edge[] = useMemo(() => {
    if (!roster) return [];
    return roster.edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: { stroke: "#64748b" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
    }));
  }, [roster]);

  const selected = outputs[active] as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-slate-400">SQL matches first · agents interpret, prioritise, and act</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-white/10 bg-[#101827] px-3 py-2 text-sm"
            value={domain}
            disabled={busy}
            onChange={(e) => setDomain(e.target.value)}
          >
            {DOMAINS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={runPipeline}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "Running…" : "Run pipeline"}
          </button>
        </div>
      </header>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {runId && <p className="text-[11px] text-slate-500">Run {runId}</p>}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Roster</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(roster?.agents || []).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActive(a.id)}
              className={`rounded-2xl border p-3 text-left transition ${
                active === a.id ? "border-cyan-400/60 bg-[#152a3d]" : "border-white/10 bg-[#101827]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{a.name}</span>
                <span className="flex items-center gap-1 text-[11px] uppercase text-slate-400">
                  <StatusDot status={status[a.id] || "idle"} />
                  {status[a.id] || "idle"}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-400">{a.role}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Pipeline</h2>
        <div className="h-[300px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c1220]">
          <ReactFlow nodes={nodes} edges={edges} fitView panOnDrag zoomOnScroll={false} proOptions={{ hideAttribution: true }}>
            <Background color="#1e293b" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-[#101827] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Agent output</h2>
          <AgentOutput output={selected} />
          {!selected && <p className="text-sm text-slate-500">Run a pipeline or pick a cached agent.</p>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#101827] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Action queue</h2>
          <ActionQueue rows={actions} />
        </section>
      </div>
      {latest?.run && (
        <p className="text-[11px] text-slate-500">Cached run status: {String(latest.run.status ?? "known")}</p>
      )}
    </div>
  );
}

function AgentOutput({ output }: { output?: Record<string, unknown> }) {
  if (!output) return null;
  const chips = [
    output.risk_level,
    output.match_quality,
    output.assessment,
    output.signoff,
    output.root_cause,
  ].filter((v) => typeof v === "string") as string[];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <SeverityBadge key={c} value={c} />
        ))}
        {typeof output.confidence === "number" && (
          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
            {(Number(output.confidence) * 100).toFixed(0)}% confidence
          </span>
        )}
      </div>
      {typeof output.cfo_one_liner === "string" && <p className="text-slate-200">{output.cfo_one_liner}</p>}
      {typeof output.summary === "string" && <p className="text-slate-300">{output.summary}</p>}
      <KeyList title="Attention" items={asList(output.attention)} />
      <KeyList title="Themes" items={asList(output.themes)} />
      <KeyList title="Evidence" items={asList(output.evidence)} />
      <KeyList title="Priority domains" items={asList(output.priority_domains)} />
      <GapList items={output.top_gaps} />
      <GapList items={output.priority_gaps} />
      <ActionList items={output.actions} />
    </div>
  );
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function KeyList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((i) => (
          <span key={i} className="rounded-md bg-white/10 px-2 py-0.5 text-xs capitalize text-slate-200">
            {prettyCat(i)}
          </span>
        ))}
      </div>
    </div>
  );
}

function GapList({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className="space-y-1 text-xs text-slate-300">
      {items.map((g, i) => {
        const row = g as Record<string, unknown>;
        return (
          <li key={i} className="rounded-lg bg-white/5 px-2 py-1">
            {String(row.category || row.area || "gap")}
            {row.leakage != null ? ` · ${inr(Number(row.leakage), true)}` : ""}
            {row.why ? ` — ${row.why}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

function ActionList({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {items.map((a, i) => {
        const row = a as Record<string, unknown>;
        return (
          <li key={i} className="rounded-lg border border-white/10 px-2 py-1">
            <span className="font-semibold uppercase text-cyan-300">{String(row.action ?? row.type ?? "act")}</span>
            {row.amount != null ? <span className="ml-2 text-rose-300">{inr(Number(row.amount), true)}</span> : null}
            {row.rationale ? <div className="text-slate-400">{String(row.rationale)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ActionQueue({ rows }: { rows: ActionRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No queued actions yet.</p>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-1">Action</th>
            <th className="py-1">Amount</th>
            <th className="py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.action_id} className="border-t border-white/5">
              <td className="py-1.5">
                <div className="font-semibold uppercase text-cyan-300">{r.action}</div>
                <div className="line-clamp-2 text-slate-400">{r.rationale}</div>
              </td>
              <td className="py-1.5 tabular-nums text-rose-300">{inr(r.amount, true)}</td>
              <td className="py-1.5">{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
