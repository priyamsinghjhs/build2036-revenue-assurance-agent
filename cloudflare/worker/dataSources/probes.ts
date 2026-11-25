import { neon } from "@neondatabase/serverless";
import type { ConnectorDef } from "./catalog";

export type ProbeResult = {
  ok: boolean;
  message: string;
  http_status?: number;
  probe: string;
  latency_ms: number;
};

const TIMEOUT_MS = 8_000;

function sanitize(message: string, secrets: string[]): string {
  let out = message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://***@");
  for (const s of secrets) {
    if (s && s.length > 3) out = out.split(s).join("***");
  }
  return out.slice(0, 500);
}

async function timedFetch(url: string, init: RequestInit, secrets: string[]): Promise<{ status: number; text: string; ok: boolean }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  return { status: res.status, text: sanitize(text, secrets).slice(0, 240), ok: res.ok };
}

function need(creds: Record<string, string>, config: Record<string, string>, name: string): string {
  return (creds[name] || config[name] || "").trim();
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return hex(digest);
}

async function awsListObjects(region: string, bucket: string, prefix: string, accessKey: string, secretKey: string, secrets: string[]): Promise<ProbeResult> {
  const t0 = Date.now();
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const qs = new URLSearchParams({ "list-type": "2", "max-keys": "1" });
  if (prefix) qs.set("prefix", prefix);
  const query = [...qs.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join("&");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex("");
  const canonical = `GET\n/\n${query}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
  const canonicalHash = await sha256Hex(canonical);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${canonicalHash}`;
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = hex(await hmacSha256(kSigning, stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;
  try {
    const res = await timedFetch(`https://${host}/?${query}`, {
      method: "GET",
      headers: { authorization: auth, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash },
    }, secrets);
    return {
      ok: res.ok,
      http_status: res.status,
      probe: "S3 ListObjectsV2",
      latency_ms: Date.now() - t0,
      message: res.ok ? `S3 listed objects on ${bucket} (HTTP ${res.status}).` : `S3 ListObjects failed with HTTP ${res.status}. ${res.text}`,
    };
  } catch (err) {
    return { ok: false, probe: "S3 ListObjectsV2", latency_ms: Date.now() - t0, message: sanitize(err instanceof Error ? err.message : String(err), secrets) };
  }
}

async function probeGateway(url: string, probe: string, secrets: string[], t0: number): Promise<ProbeResult> {
  try {
    const res = await timedFetch(url, { method: "GET" }, secrets);
    return {
      ok: res.ok,
      http_status: res.status,
      probe,
      latency_ms: Date.now() - t0,
      message: res.ok
        ? `Gateway ${url} responded HTTP ${res.status}.`
        : `Gateway ${url} responded HTTP ${res.status}. ${res.text}`,
    };
  } catch (err) {
    return { ok: false, probe, latency_ms: Date.now() - t0, message: sanitize(err instanceof Error ? err.message : String(err), secrets) };
  }
}

export async function runProbe(
  connector: ConnectorDef,
  config: Record<string, string>,
  creds: Record<string, string>,
): Promise<ProbeResult> {
  const t0 = Date.now();
  const secrets = Object.values(creds).filter(Boolean);
  const cfg = { ...config };
  const get = (name: string) => need(creds, cfg, name);

  if (connector.sync_mode === "gateway") {
    const gateway = get("gateway_url");
    if (!gateway) {
      return {
        ok: false,
        probe: connector.probe_name,
        latency_ms: Date.now() - t0,
        message: connector.honesty,
      };
    }
    return probeGateway(gateway, connector.probe_name, secrets, t0);
  }

  try {
    switch (connector.id) {
      case "snowflake": {
        const account = get("account");
        const token = get("token");
        if (!account || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Account identifier and a programmatic access token are required." };
        const host = account.includes(".") ? `${account}.snowflakecomputing.com` : `${account}.snowflakecomputing.com`;
        const body = {
          statement: "SELECT 1 AS ok",
          timeout: 10,
          warehouse: get("warehouse") || undefined,
          database: get("database") || undefined,
          schema: get("schema") || undefined,
          role: get("role") || undefined,
        };
        const res = await timedFetch(`https://${host}/api/v2/statements`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Snowflake SQL API accepted SELECT 1." : `Snowflake SQL API HTTP ${res.status}. ${res.text}` };
      }
      case "databricks": {
        const host = get("host").replace(/\/$/, "");
        const warehouse = get("warehouse_id");
        const token = get("token");
        if (!host || !warehouse || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Workspace host, warehouse ID and a personal access token are required." };
        const res = await timedFetch(`${host}/api/2.0/sql/statements`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ warehouse_id: warehouse, statement: "SELECT 1", wait_timeout: "10s", catalog: get("catalog") || undefined, schema: get("schema") || undefined }),
        }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Databricks accepted SELECT 1." : `Databricks HTTP ${res.status}. ${res.text}` };
      }
      case "aws_s3": {
        const bucket = get("bucket");
        const region = get("region");
        const access = get("access_key_id");
        const secret = get("secret_access_key");
        if (!bucket || !region || !access || !secret) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Bucket, region, access key and secret key are required." };
        return awsListObjects(region, bucket, get("prefix"), access, secret, secrets);
      }
      case "gcs": {
        const bucket = get("bucket");
        const token = get("access_token");
        if (!bucket || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Bucket and an OAuth access token are required." };
        const u = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
        u.searchParams.set("maxResults", "1");
        if (get("prefix")) u.searchParams.set("prefix", get("prefix"));
        const res = await timedFetch(u.toString(), { headers: { authorization: `Bearer ${token}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? `GCS listed objects in ${bucket}.` : `GCS HTTP ${res.status}. ${res.text}` };
      }
      case "bigquery": {
        const project = get("project_id");
        const token = get("access_token");
        if (!project || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Project ID and an OAuth access token are required." };
        const res = await timedFetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ query: "SELECT 1 AS ok", useLegacySql: false, location: get("location") || undefined, timeoutMs: 8000, maxResults: 1 }),
        }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "BigQuery accepted SELECT 1." : `BigQuery HTTP ${res.status}. ${res.text}` };
      }
      case "azure_blob": {
        const account = get("account");
        const container = get("container");
        const sas = get("sas_token");
        if (!account || !container) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Storage account and container are required." };
        if (!sas) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "A SAS token is required for the free-tier probe. Account-key SharedKey signing is not used unless you also provide a SAS." };
        const token = sas.startsWith("?") ? sas : `?${sas}`;
        const url = `https://${account}.blob.core.windows.net/${encodeURIComponent(container)}?restype=container&comp=list&maxresults=1${get("prefix") ? `&prefix=${encodeURIComponent(get("prefix"))}` : ""}${token.startsWith("?") ? "&" + token.slice(1) : ""}`;
        const res = await timedFetch(url, { headers: { "x-ms-version": "2020-10-02" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? `Azure Blob listed ${container}.` : `Azure Blob HTTP ${res.status}. ${res.text}` };
      }
      case "postgres": {
        const uri = get("connection_uri");
        if (!uri) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "A Postgres connection URI is required." };
        if (!/^postgres(ql)?:\/\//i.test(uri)) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "The URI must start with postgres:// or postgresql://." };
        const sql = neon(uri, { fetchOptions: { timeout: TIMEOUT_MS } });
        await sql.query("SELECT 1 AS ok");
        return { ok: true, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "SELECT 1 succeeded over the Neon HTTP driver." };
      }
      case "stripe": {
        const key = get("secret_key");
        if (!key) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "A Stripe secret key is required." };
        const res = await timedFetch("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${key}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Stripe /v1/balance succeeded." : `Stripe HTTP ${res.status}. ${res.text}` };
      }
      case "chargebee": {
        const site = get("site");
        const key = get("api_key");
        if (!site || !key) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Site name and API key are required." };
        const auth = btoa(`${key}:`);
        const res = await timedFetch(`https://${site}.chargebee.com/api/v2/subscriptions?limit=1`, { headers: { authorization: `Basic ${auth}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Chargebee listed subscriptions." : `Chargebee HTTP ${res.status}. ${res.text}` };
      }
      case "zuora": {
        const base = (get("base_url") || "https://rest.zuora.com").replace(/\/$/, "");
        let token = get("access_token");
        if (!token && get("client_id") && get("client_secret")) {
          const body = new URLSearchParams({ grant_type: "client_credentials", client_id: get("client_id"), client_secret: get("client_secret") });
          const tok = await timedFetch(`${base}/oauth/v2/token` , { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, secrets);
          if (!tok.ok) return { ok: false, http_status: tok.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: `Zuora token request HTTP ${tok.status}. ${tok.text}` };
          try { token = String((JSON.parse(tok.text) as { access_token?: string }).access_token || ""); } catch { token = ""; }
          if (!token) return { ok: false, http_status: tok.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Zuora token response did not include an access_token." };
        }
        if (!token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Provide an access token or OAuth client credentials." };
        const res = await timedFetch(`${base}/v1/connections`, { headers: { authorization: `Bearer ${token}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Zuora GET /v1/connections succeeded." : `Zuora HTTP ${res.status}. ${res.text}` };
      }
      case "recurly": {
        const key = get("api_key");
        if (!key) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "A Recurly API key is required." };
        const host = get("region") === "eu" ? "v3.eu.recurly.com" : "v3.recurly.com";
        const res = await timedFetch(`https://${host}/sites`, { headers: { authorization: `Basic ${btoa(key + ":")}`, accept: "application/vnd.recurly.v2021-02-25+json" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Recurly /sites succeeded." : `Recurly HTTP ${res.status}. ${res.text}` };
      }
      case "razorpay": {
        const id = get("key_id");
        const secret = get("key_secret");
        if (!id || !secret) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Key ID and key secret are required." };
        const res = await timedFetch("https://api.razorpay.com/v1/payments?count=1", { headers: { authorization: `Basic ${btoa(`${id}:${secret}`)}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Razorpay listed payments." : `Razorpay HTTP ${res.status}. ${res.text}` };
      }
      case "quickbooks": {
        const realm = get("realm_id");
        const token = get("access_token");
        if (!realm || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Realm ID and an OAuth access token are required. This app does not complete Intuit OAuth." };
        const host = get("environment") === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
        const res = await timedFetch(`${host}/v3/company/${encodeURIComponent(realm)}/companyinfo/${encodeURIComponent(realm)}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "QuickBooks companyinfo succeeded." : `QuickBooks HTTP ${res.status}. ${res.text}` };
      }
      case "xero": {
        const tenant = get("tenant_id");
        const token = get("access_token");
        if (!tenant || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Tenant ID and an OAuth access token are required. This app does not complete Xero OAuth." };
        const res = await timedFetch("https://api.xero.com/api.xro/2.0/Organisation", { headers: { authorization: `Bearer ${token}`, "Xero-tenant-id": tenant, accept: "application/json" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Xero Organisation succeeded." : `Xero HTTP ${res.status}. ${res.text}` };
      }
      case "zoho_books": {
        const org = get("organization_id");
        const token = get("access_token");
        if (!org || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Organization ID and an OAuth access token are required. This app does not complete Zoho OAuth." };
        const base = (get("base_url") || "https://www.zohoapis.com").replace(/\/$/, "");
        const res = await timedFetch(`${base}/books/v3/organizations`, { headers: { authorization: `Zoho-oauthtoken ${token}` } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "Zoho Books organizations succeeded." : `Zoho Books HTTP ${res.status}. ${res.text}` };
      }
      case "netsuite": {
        const gateway = get("gateway_url");
        const token = get("access_token");
        const account = get("account_id");
        const base = (get("base_url") || (account ? `https://${account}.suitetalk.api.netsuite.com` : "")).replace(/\/$/, "");
        if (gateway) return probeGateway(gateway, connector.probe_name, secrets, t0);
        if (!token || !base) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Provide an OAuth access token and REST base URL, or a custom gateway URL. TBA/HMAC is not implemented here." };
        const res = await timedFetch(`${base}/services/rest/record/v1/metadata-catalog`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "NetSuite metadata-catalog succeeded." : `NetSuite HTTP ${res.status}. ${res.text}` };
      }
      case "freshbooks": {
        const account = get("account_id");
        const token = get("access_token");
        if (!account || !token) return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: "Account ID and an OAuth access token are required. This app does not complete FreshBooks OAuth." };
        const res = await timedFetch(`https://api.freshbooks.com/accounting/account/${encodeURIComponent(account)}/invoices/invoices?per_page=1`, { headers: { authorization: `Bearer ${token}`, "Api-Version": "2023-02-20" } }, secrets);
        return { ok: res.ok, http_status: res.status, probe: connector.probe_name, latency_ms: Date.now() - t0, message: res.ok ? "FreshBooks invoices list succeeded." : `FreshBooks HTTP ${res.status}. ${res.text}` };
      }
      default:
        return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: `No HTTP probe is implemented for ${connector.id}.` };
    }
  } catch (err) {
    return { ok: false, probe: connector.probe_name, latency_ms: Date.now() - t0, message: sanitize(err instanceof Error ? err.message : String(err), secrets) };
  }
}
