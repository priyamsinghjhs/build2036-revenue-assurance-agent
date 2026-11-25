import { useEffect, useState } from "react";
import { api } from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function UsersPage() {
  const [rows, setRows] = useState<{ id: string; role: string; name: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .users()
      .then((r) => setRows(r.users))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!rows) return <p className="text-muted">Loading users…</p>;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Users</h1>
        <p className="text-sm text-muted">Role login IDs for this deployment. Passwords are not stored or displayed here.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>Admin can view the roster. Access is enforced on the Worker for every /api route.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 pr-3">Login ID</th>
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2">Role</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono text-xs">{u.id}</td>
                  <td className="py-2 pr-3">{u.name}</td>
                  <td className="py-2">{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
