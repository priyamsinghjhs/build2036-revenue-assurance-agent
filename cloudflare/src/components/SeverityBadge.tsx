import { Badge } from "@/components/ui/badge";

export function SeverityBadge({ value }: { value: "high" | "medium" | "low" | string }) {
  const tone = value === "high" || value === "critical" ? "high" : value === "medium" || value === "watch" ? "medium" : "low";
  return <Badge tone={tone}>{value}</Badge>;
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "matched" || status === "completed" || status === "cached" || status === "approved" || status === "done"
      ? "bg-success"
      : status === "unmatched" || status === "error" || status === "rejected" || status === "failed"
        ? "bg-danger"
        : status === "running"
          ? "bg-accent animate-pulse"
          : "bg-warning";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}
