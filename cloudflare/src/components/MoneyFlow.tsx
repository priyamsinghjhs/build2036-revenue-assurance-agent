import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { flowNodeTypes } from "./FlowLabelNode";
import { inr } from "../lib/format";

export function MoneyFlow({
  flow,
}: {
  flow: {
    capture: number;
    gateway_fees: number;
    scheme_gross: number;
    scheme_net: number;
    bank: number;
    payout: number;
    leakage_by_area: Record<string, number>;
  };
}) {
  const leak = (k: string) => flow.leakage_by_area[k] ?? 0;
  const nodes: Node[] = useMemo(
    () => [
      n("merchant", "Merchants", flow.capture, 0, 80),
      n("gateway", "Gateway", flow.capture - flow.gateway_fees, 180, 20),
      n("scheme", "Schemes", flow.scheme_net, 360, 80),
      n("bank", "Bank / TRS", flow.bank, 540, 20),
      n("payout", "Payouts", flow.payout, 720, 80),
      leakN("l1", "Auth / capture leak", leak("authorization"), 180, 200),
      leakN("l2", "Scheme / fee leak", leak("scheme") + leak("gateway") + leak("network"), 360, 200),
      leakN("l3", "Bank / TRS leak", leak("bank_trs"), 540, 200),
      leakN("l4", "Payout leak", leak("payouts") + leak("pricing") + leak("chargebacks"), 720, 200),
    ],
    [flow],
  );
  const edges: Edge[] = useMemo(
    () => [
      e("merchant", "gateway", flow.capture, false),
      e("gateway", "scheme", flow.scheme_gross, false),
      e("scheme", "bank", flow.scheme_net, false),
      e("bank", "payout", flow.payout, false),
      e("merchant", "l1", leak("authorization"), true),
      e("gateway", "l2", leak("scheme") + leak("gateway") + leak("network"), true),
      e("scheme", "l3", leak("bank_trs"), true),
      e("bank", "l4", leak("payouts") + leak("pricing") + leak("chargebacks"), true),
    ],
    [flow],
  );
  return (
    <div className="h-[240px] overflow-hidden rounded-xl border border-line bg-white sm:h-[320px] md:h-[360px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        panOnDrag
        zoomOnScroll={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function n(id: string, label: string, value: number, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    type: "label",
    data: { label: `${label}\n${inr(value, true)}` },
    style: {
      background: "#ffffff",
      color: "#0f172a",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      padding: 0,
      width: 148,
      minHeight: 44,
    },
  };
}

function leakN(id: string, label: string, value: number, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    type: "label",
    data: { label: `${label}\n${inr(value, true)}` },
    style: {
      background: "#fef2f2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
      borderRadius: 12,
      padding: 0,
      width: 156,
      minHeight: 44,
    },
  };
}

function e(source: string, target: string, value: number, leak: boolean): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label: inr(value, true),
    style: { stroke: leak ? "#b91c1c" : "#1d4ed8", strokeWidth: leak ? 2 : 2.5 },
    labelStyle: { fill: leak ? "#b91c1c" : "#334155", fontSize: 10 },
    markerEnd: { type: MarkerType.ArrowClosed, color: leak ? "#b91c1c" : "#1d4ed8" },
  };
}
