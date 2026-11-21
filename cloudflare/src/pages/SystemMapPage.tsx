import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { api, type SystemMap } from "@/api";
import { flowNodeTypes } from "@/components/FlowLabelNode";
import { inr, pct } from "@/lib/format";

export default function SystemMapPage() {
  const [data, setData] = useState<SystemMap | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.systemMap().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const nodes: Node[] = useMemo(() => {
    if (!data) return [];
    return data.nodes.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      type: "label",
      data: { label: n.label, href: n.href },
      style: {
        background: "#ffffff",
        color: "#0f172a",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 0,
        width: 168,
        minHeight: 40,
        cursor: "pointer",
      },
    }));
  }, [data]);

  const edges: Edge[] = useMemo(() => {
    if (!data) return [];
    return data.edges.map((e) => {
      const leak = e.leakage > 0;
      return {
        id: `${e.source}-${e.target}-${e.label}`,
        source: e.source,
        target: e.target,
        data: { href: e.href },
        label: `${inr(e.leakage, true)}`,
        style: { stroke: leak ? "#b91c1c" : "#1d4ed8", strokeWidth: leak ? 2.2 : 1.6 },
        labelStyle: { fill: leak ? "#b91c1c" : "#475569", fontSize: 9, fontWeight: 600 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
        markerEnd: { type: MarkerType.ArrowClosed, color: leak ? "#b91c1c" : "#1d4ed8" },
      };
    });
  }, [data]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading system map…</p>;

  const leakEdges = [...data.edges].sort((a, b) => b.leakage - a.leakage).slice(0, 8);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Payment lifecycle</h1>
          <p className="text-sm text-muted">Every system hop. Click a node or edge to open the domain.</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
          Synthetic data
        </span>
      </header>

      <div className="h-[420px] overflow-hidden rounded-xl border border-line bg-white sm:h-[520px] lg:h-[600px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          panOnDrag
          zoomOnScroll={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => {
            const href = (n.data as { href?: string }).href;
            if (href) navigate(href);
          }}
          onEdgeClick={(_, e) => {
            const href = (e.data as { href?: string } | undefined)?.href;
            if (href) navigate(href);
          }}
        >
          <Background color="#e2e8f0" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {leakEdges.map((e) => (
          <button
            key={`${e.source}-${e.target}-${e.label}`}
            type="button"
            onClick={() => navigate(e.href)}
            className="rounded-xl border border-line bg-white p-3 text-left hover:border-accent/40"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{e.label}</div>
            <div className="mt-1 font-semibold text-danger">{inr(e.leakage, true)}</div>
            <div className="text-[11px] text-muted">{pct(e.match_rate)} match · {e.exceptions} gaps</div>
          </button>
        ))}
      </div>
    </div>
  );
}
