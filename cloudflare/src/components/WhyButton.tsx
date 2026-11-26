import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function WhyButton({ exceptionId }: { exceptionId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/exceptions/${encodeURIComponent(exceptionId)}/why`, { credentials: "same-origin" });
      setData(await r.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
          if (!data) void load();
        }}
      >
        Why?
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why this exception</DialogTitle>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {data && (
            <pre className="text-xs whitespace-pre-wrap max-h-80 overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
