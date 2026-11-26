import { useState } from "react";
import { Button } from "@/components/ui/button";

export function BulkActions({ selectedIds, onDone }: { selectedIds: string[]; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function act(status: "approved" | "rejected") {
    if (!selectedIds.length) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/actions/bulk", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_ids: selectedIds, status }),
      });
      const j = await r.json();
      setMsg(j.ok ? `Updated ${selectedIds.length}` : j.error || "Failed");
      if (j.ok) onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={busy || !selectedIds.length} onClick={() => act("approved")}>
        Approve selected
      </Button>
      <Button size="sm" variant="outline" disabled={busy || !selectedIds.length} onClick={() => act("rejected")}>
        Reject selected
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
