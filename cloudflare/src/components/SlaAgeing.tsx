import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Row = { bucket?: string; count?: number; leakage?: number; [k: string]: unknown };

export function SlaAgeing() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sla", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setRows(j.ageing || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA ageing</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">No ageing data.</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th>Bucket</th>
                <th>Count</th>
                <th>Leakage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td>{String(r.bucket || r.age_bucket || "—")}</td>
                  <td>{Number(r.count || 0)}</td>
                  <td>{Number(r.leakage || r.amount || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
