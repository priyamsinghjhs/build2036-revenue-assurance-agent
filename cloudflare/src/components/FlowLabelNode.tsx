import { Handle, Position, type NodeProps } from "@xyflow/react";

/** Compact wrapping label so React Flow nodes don't collide or overflow. */
export function FlowLabelNode({ data }: NodeProps) {
  const label = String((data as { label?: string }).label ?? "");
  const lines = label.split("\n");
  return (
    <div className="w-full px-1.5 py-1 text-center text-[11px] font-semibold leading-tight tracking-tight">
      {lines.map((line, i) => (
        <div key={i} className="break-words" title={line}>
          {line}
        </div>
      ))}
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-slate-500" />
    </div>
  );
}

export const flowNodeTypes = { label: FlowLabelNode };
