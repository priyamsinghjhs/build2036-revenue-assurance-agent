import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type DataSourceConnection, type DataSourceConnector, type DataSourcesPayload } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publicErrorMessage } from "../../shared/errors";

const CATEGORIES: { id: DataSourceConnector["category"]; label: string }[] = [
  { id: "warehouse", label: "Warehouses" },
  { id: "object_storage", label: "Object storage" },
  { id: "database", label: "Databases" },
  { id: "billing", label: "Billing" },
  { id: "invoicing", label: "Invoicing" },
];

const inputClass = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function ModeBadge({ mode }: { mode: "http" | "gateway" }) {
  return mode === "http" ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800" data-testid="sync-mode-badge">
      Live HTTP test
    </span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning" data-testid="sync-mode-badge">
      Config only · needs a gateway
    </span>
  );
}

export default function DataSourcesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DataSourcesPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const connectorId = params.connectorId;
  const connectionId = params.connectionId;

  async function reload() {
    const next = await api.dataSources();
    setData(next);
    return next;
  }

  useEffect(() => {
    reload().catch((e) => setError(publicErrorMessage(e, "Couldn't load data sources.")));
  }, []);

  const connector = useMemo(() => {
    if (!data) return null;
    if (connectorId) return data.catalog.find((c) => c.id === connectorId) ?? null;
    if (connectionId) {
      const row = data.connections.find((c) => c.connection_id === connectionId);
      return row ? data.catalog.find((c) => c.id === row.connector_id) ?? null : null;
    }
    return null;
  }, [data, connectorId, connectionId]);

  const existing = useMemo(
    () => (connectionId && data ? data.connections.find((c) => c.connection_id === connectionId) ?? null : null),
    [data, connectionId],
  );

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading data sources…</p>;

  if (connector) {
    return (
      <ConnectionForm
        catalog={connector}
        existing={existing}
        targets={data.mapping_targets}
        kek={data.kek_configured}
        note={data.note}
        busy={busy}
        notice={notice}
        onCancel={() => navigate("/settings/data-sources")}
        onSave={async (body) => {
          setBusy(true);
          setNotice("");
          try {
            const saved = await api.saveDataSource({ ...body, connector_id: connector.id, connection_id: existing?.connection_id }, existing?.connection_id);
            setNotice("Saved. Secret fields were not sent back to the browser.");
            const next = await reload();
            const id = saved.connection?.connection_id;
            if (id && !existing) navigate(`/settings/data-sources/c/${id}`, { replace: true });
            return next.connections.find((c) => c.connection_id === id) ?? saved.connection;
          } catch (e) {
            setNotice(publicErrorMessage(e, "Save failed."));
            throw e;
          } finally {
            setBusy(false);
          }
        }}
        onTest={async (id) => {
          setBusy(true);
          setNotice("");
          try {
            const res = await api.testDataSource(id);
            setNotice(res.message || (res.ok ? "Probe succeeded." : "Probe did not succeed."));
            await reload();
            return res;
          } catch (e) {
            const msg = publicErrorMessage(e, "Test failed.");
            setNotice(msg);
            throw e;
          } finally {
            setBusy(false);
          }
        }}
        onSync={async (id) => {
          setBusy(true);
          setNotice("");
          try {
            const res = await api.syncDataSource(id);
            setNotice(res.message || (res.ok ? "Sync recorded." : "Sync was not started."));
            await reload();
            return res;
          } catch (e) {
            setNotice(publicErrorMessage(e, "Sync failed."));
            throw e;
          } finally {
            setBusy(false);
          }
        }}
        onDelete={async (id) => {
          setBusy(true);
          try {
            await api.deleteDataSource(id);
            navigate("/settings/data-sources");
            await reload();
          } catch (e) {
            setNotice(publicErrorMessage(e, "Delete failed."));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="data-sources-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            <Link to="/settings" className="hover:underline">Settings</Link> / Data sources
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Data sources</h1>
          <p className="text-sm text-muted">{data.note}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">
          Free plan · {data.catalog.length} connectors
        </span>
      </header>

      {!data.kek_configured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="kek-warning">
          The Worker secret DATA_SOURCES_KEK is not set, so credentials cannot be stored. Non-secret fields can still be saved.
        </p>
      )}

      {data.connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saved connections</CardTitle>
            <CardDescription>Status comes from the last live probe. Credentials are never displayed.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="data-source-connections">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Connector</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Last test</th>
                  <th className="py-2">Schedule</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map((row) => {
                  const c = data.catalog.find((x) => x.id === row.connector_id);
                  return (
                    <tr key={row.connection_id} className="border-b border-line/70">
                      <td className="py-2 pr-3">
                        <Link className="font-medium text-ink underline" to={`/settings/data-sources/c/${row.connection_id}`}>
                          {row.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{c?.title ?? row.connector_id}</td>
                      <td className="py-2 pr-3">{row.status}{row.has_credentials ? " · credentials saved" : ""}</td>
                      <td className="py-2 pr-3 text-muted">{row.last_test_message || "—"}</td>
                      <td className="py-2">{row.schedule_enabled ? row.schedule_kind : "manual"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {CATEGORIES.map((cat) => {
        const items = data.catalog.filter((c) => c.category === cat.id);
        if (!items.length) return null;
        return (
          <section key={cat.id} className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{cat.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((c) => (
                <Link key={c.id} to={`/settings/data-sources/new/${c.id}`} data-testid={`connector-card-${c.id}`}>
                  <Card className="h-full transition hover:border-accent">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{c.title}</CardTitle>
                        <ModeBadge mode={c.sync_mode} />
                      </div>
                      <CardDescription>{c.vendor}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted">
                      <p>{c.summary}</p>
                      <p className="text-xs leading-relaxed">{c.honesty}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ConnectionForm({
  catalog,
  existing,
  targets,
  kek,
  note,
  busy,
  notice,
  onCancel,
  onSave,
  onTest,
  onSync,
  onDelete,
}: {
  catalog: DataSourceConnector;
  existing: DataSourceConnection | null;
  targets: DataSourcesPayload["mapping_targets"];
  kek: boolean;
  note: string;
  busy: boolean;
  notice: string;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<DataSourceConnection | undefined>;
  onTest: (id: string) => Promise<{ ok: boolean; message?: string }>;
  onSync: (id: string) => Promise<{ ok: boolean; message?: string }>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name || catalog.title);
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...(existing?.config ?? {}) }));
  const [scheduleKind, setScheduleKind] = useState(existing?.schedule_kind || "manual");
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(existing?.schedule_enabled));
  const [mapping, setMapping] = useState(existing?.mapping?.length ? existing.mapping : catalog.mapping_targets.slice(0, 1).map((t) => {
    const dest = targets.find((x) => x.id === t);
    return { target: t, source_field: "", dest_field: dest?.fields[0] || "" };
  }));

  useEffect(() => {
    setName(existing?.name || catalog.title);
    setFields({ ...(existing?.config ?? {}) });
    setScheduleKind(existing?.schedule_kind || "manual");
    setScheduleEnabled(Boolean(existing?.schedule_enabled));
    setMapping(existing?.mapping?.length ? existing.mapping : catalog.mapping_targets.slice(0, 1).map((t) => {
      const dest = targets.find((x) => x.id === t);
      return { target: t, source_field: "", dest_field: dest?.fields[0] || "" };
    }));
  }, [catalog.id, existing?.connection_id]);

  const allowedTargets = targets.filter((t) => catalog.mapping_targets.includes(t.id));

  return (
    <div className="space-y-5" data-testid="data-source-form">
      <p className="text-xs uppercase tracking-wide text-muted">
        <Link to="/settings" className="hover:underline">Settings</Link>
        {" / "}
        <Link to="/settings/data-sources" className="hover:underline">Data sources</Link>
        {" / "}
        {catalog.title}
      </p>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{existing ? existing.name : `New ${catalog.title} connection`}</h1>
          <p className="text-sm text-muted">{note}</p>
        </div>
        <ModeBadge mode={catalog.sync_mode} />
      </header>
      <p className="text-sm leading-relaxed text-muted" data-testid="connector-honesty">{catalog.honesty}</p>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Secret fields are write-only. After a save they appear blank, with a “saved” hint if the server has a ciphertext.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Display name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {catalog.fields.map((f) => (
            <label key={f.name} className="block text-sm">
              <span className="mb-1 block text-muted">
                {f.label}
                {f.required ? " *" : ""}
                {f.secret && existing?.has_credentials ? " (saved — leave blank to keep)" : ""}
              </span>
              {f.type === "select" ? (
                <select className={inputClass} value={fields[f.name] ?? f.options?.[0]?.value ?? ""} onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))}>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea className={inputClass} rows={3} value={fields[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))} />
              ) : (
                <input
                  className={inputClass}
                  type={f.secret || f.type === "password" ? "password" : f.type === "url" ? "url" : "text"}
                  autoComplete="off"
                  value={fields[f.name] ?? ""}
                  placeholder={f.secret && existing?.has_credentials ? "••••••••" : f.placeholder}
                  onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))}
                  data-secret={f.secret ? "true" : "false"}
                />
              )}
              {f.help ? <span className="mt-1 block text-xs text-muted">{f.help}</span> : null}
            </label>
          ))}
          {!kek && catalog.fields.some((f) => f.secret) ? (
            <p className="text-sm text-warning">This Worker cannot store the secret fields until DATA_SOURCES_KEK is configured.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Field mapping</CardTitle>
          <CardDescription>Map incoming source fields onto recon tables. Nothing is written until a successful HTTP sync is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {mapping.map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <select className={inputClass} value={row.target} onChange={(e) => setMapping((m) => m.map((r, j) => j === i ? { ...r, target: e.target.value } : r))}>
                {allowedTargets.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.table})</option>)}
              </select>
              <input className={inputClass} placeholder="Source field" value={row.source_field} onChange={(e) => setMapping((m) => m.map((r, j) => j === i ? { ...r, source_field: e.target.value } : r))} />
              <select className={inputClass} value={row.dest_field} onChange={(e) => setMapping((m) => m.map((r, j) => j === i ? { ...r, dest_field: e.target.value } : r))}>
                {(allowedTargets.find((t) => t.id === row.target)?.fields ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const t = allowedTargets[0];
            if (t) setMapping((m) => [...m, { target: t.id, source_field: "", dest_field: t.fields[0] ?? "" }]);
          }}>Add mapping row</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync schedule and status</CardTitle>
          <CardDescription>The daily Worker cron will only probe enabled HTTP connectors. Gateway connectors are never auto-synced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select className={inputClass + " max-w-xs"} value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value)}>
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily (with the 02:15 UTC cron)</option>
              <option value="weekly">Weekly</option>
            </select>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
              Enable schedule
            </label>
          </div>
          {existing ? (
            <dl className="grid gap-1 text-sm text-muted" data-testid="connection-status">
              <div>Status: <span className="text-ink">{existing.status}</span> {existing.has_credentials ? "· credentials saved" : ""}</div>
              <div>Last test: {existing.last_test_ok == null ? "—" : existing.last_test_ok ? "ok" : "failed"} {existing.last_test_message ? `— ${existing.last_test_message}` : ""}</div>
              <div>Last sync: {existing.last_sync_ok == null ? "—" : existing.last_sync_ok ? "recorded" : "not started"} {existing.last_sync_message ? `— ${existing.last_sync_message}` : ""}</div>
            </dl>
          ) : (
            <p className="text-sm text-muted">Save the connection before running a test.</p>
          )}
        </CardContent>
      </Card>

      {notice ? <p className="text-sm" data-testid="data-source-notice">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void onSave({ name, fields, mapping, schedule_kind: scheduleKind, schedule_enabled: scheduleEnabled })}>Save</Button>
        <Button variant="outline" disabled={busy || !existing} onClick={() => existing && void onTest(existing.connection_id)} data-testid="test-connection">
          Test connection
        </Button>
        <Button variant="outline" disabled={busy || !existing} onClick={() => existing && void onSync(existing.connection_id)}>
          Run sync
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Back to catalog</Button>
        {existing ? (
          <Button variant="danger" disabled={busy} onClick={() => void onDelete(existing.connection_id)}>Delete</Button>
        ) : null}
      </div>
    </div>
  );
}
