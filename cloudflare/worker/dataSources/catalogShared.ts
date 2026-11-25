export type ConnectorCategory =
  | "warehouse"
  | "object_storage"
  | "database"
  | "billing"
  | "invoicing"
  | "file_transfer"
  | "card_scheme"
  | "upi_npci"
  | "processor"
  | "indian_gateway"
  | "global_psp"
  | "bank_statement"
  | "disputes"
  | "fraud"
  | "erp"
  | "fx"
  | "streams"
  | "custom";
export type SyncMode = "http" | "hyperdrive" | "gateway" | "file" | "planned";
export type RelayKind = "http" | "hyperdrive" | "tunnel" | "none";
export type FieldType = "text" | "password" | "url" | "select" | "textarea";

export type CatalogField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  config?: boolean; // stored in config_json even if secret=false; default: !secret
};

export type MappingTarget = {
  id: string;
  table: string;
  label: string;
  fields: string[];
};

export type ConnectorDef = {
  id: string;
  title: string;
  vendor: string;
  category: ConnectorCategory;
  sync_mode: SyncMode;
  summary: string;
  honesty: string;
  docs_url?: string;
  fields: CatalogField[];
  mapping_targets: string[];
  probe_name: string;
  relay?: RelayKind;
  setup_title?: string;
  setup_steps?: string[];
  parser?: string;
};

export function f(name: string, label: string, type: FieldType, extra: Partial<CatalogField> = {}): CatalogField {
  return { name, label, type, ...extra };
}

export const HYPERDRIVE_SETUP_STEPS = [
  "In the Cloudflare dashboard open Storage & databases → Hyperdrive, or run: npx wrangler hyperdrive create <name> --connection-string=\"postgres://…\" (or mysql://…).",
  "Hyperdrive is included on the Workers free plan (up to 100,000 queries per day). This app will not create a Hyperdrive config in your account.",
  "Copy the Hyperdrive ID and add a binding in wrangler.jsonc, for example: \"hyperdrive\": [{ \"binding\": \"HYPERDRIVE_MYSQL\", \"id\": \"<id>\" }]. Redeploy the Worker.",
  "Enter that exact binding name in this form, plus host, port, database and user. The password is stored encrypted with DATA_SOURCES_KEK and is never returned.",
  "Test runs SELECT 1 through the binding when it is present and reports the real result. If the binding is missing, Test fails. Raw TCP without Hyperdrive is not available from this Worker.",
];

export const TUNNEL_SETUP_STEPS = [
  "Install cloudflared from the Cloudflare Zero Trust downloads page.",
  "Authenticate and create a tunnel, for example: cloudflared tunnel login && cloudflared tunnel create ra-gateway. This app will not create a tunnel in your account.",
  "Run a small HTTPS service on the private network that can speak the native protocol (Oracle Net, Hive Thrift or MongoDB wire) and expose a /health endpoint.",
  "Point the tunnel at that service (cloudflared tunnel route dns <tunnel> gateway.example.com and an ingress rule) so the hostname is reachable over HTTPS.",
  "Optional: protect the hostname with Cloudflare Access and create a Service Token (client id and secret).",
  "Paste the public gateway URL. If Access is enabled, also paste the service-token client id and secret. Those secrets are encrypted with DATA_SOURCES_KEK and never returned to the browser.",
  "Test sends GET to the gateway health endpoint (with CF-Access-Client-Id / CF-Access-Client-Secret when provided) and reports the live HTTP status. A missing or failing gateway is reported as a failure.",
];

export const ACCESS_FIELDS = [
  f("gateway_url", "HTTPS gateway URL", "url", { help: "Public URL of your cloudflared or other TLS gateway. Test calls /health when you only provide a host root." }),
  f("access_client_id", "Access client id", "password", { secret: true, help: "Cloudflare Access service-token client id. Stored encrypted. Leave blank if the gateway is not behind Access." }),
  f("access_client_secret", "Access client secret", "password", { secret: true, help: "Cloudflare Access service-token secret. Stored encrypted and never returned." }),
];

export const HYPERDRIVE_FIELDS = [
  f("host", "Host", "text"),
  f("port", "Port", "text"),
  f("database", "Database", "text"),
  f("username", "Username", "text"),
  f("password", "Password", "password", { secret: true }),
  f("hyperdrive_binding", "Hyperdrive binding name", "text", { placeholder: "HYPERDRIVE_MYSQL", help: "Must match a hyperdrive.binding in wrangler.jsonc after you create the config and redeploy." }),
];
