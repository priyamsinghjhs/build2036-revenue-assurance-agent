import { Link } from "react-router-dom";
import { Database, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6" data-testid="settings-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-muted">Operator configuration. The October book stays synthetic; connections you add here are for ingest planning.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/settings/data-sources" className="block" data-testid="settings-data-sources-link">
          <Card className="h-full transition hover:border-accent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" /> Data sources
              </CardTitle>
              <CardDescription>Connect warehouses, object storage, databases, billing and invoicing systems.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted">
              Each connector shows an honest badge (Live HTTP, Hyperdrive, Gateway, File, or Planned). Credentials are encrypted server-side and never shown again. This app does not create Hyperdrive configs or Cloudflare Tunnels for you.
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-4 w-4" /> Workspace
            </CardTitle>
            <CardDescription>This deployment is the free Workers plan with Neon over HTTP.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            Hyperdrive (free plan, 100,000 queries/day) can be bound for Postgres and MySQL after you create a config. Oracle, Hive, MongoDB and SFTP need a Cloudflare Tunnel or HTTPS gateway. No Hyperdrive binding or tunnel is configured in this deployment unless you add one.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
