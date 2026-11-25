export type RelayProbeResult = {
  ok: boolean;
  message: string;
  http_status?: number;
  probe: string;
  latency_ms: number;
};

const TIMEOUT_MS = 8_000;
const BINDING_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type HyperdriveLike = { connectionString: string };

function sanitize(message: string, secrets: string[]): string {
  let out = message.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://***@");
  out = out.replace(/mysql:\/\/[^\s@]+@/gi, "mysql://***@");
  for (const s of secrets) {
    if (s && s.length > 3) out = out.split(s).join("***");
  }
  return out.slice(0, 500);
}

export function isHyperdrive(value: unknown): value is HyperdriveLike {
  return Boolean(value) && typeof value === "object" && typeof (value as HyperdriveLike).connectionString === "string";
}

export function listHyperdriveBindingNames(env: unknown): string[] {
  if (!env || typeof env !== "object") return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (BINDING_NAME.test(key) && isHyperdrive(value)) names.push(key);
  }
  return names.sort();
}

export function getHyperdrive(env: unknown, name: string): HyperdriveLike | null {
  if (!BINDING_NAME.test(name) || !env || typeof env !== "object") return null;
  const value = (env as Record<string, unknown>)[name];
  return isHyperdrive(value) ? value : null;
}

export async function probeHyperdrive(
  env: unknown,
  bindingName: string,
  kind: "mysql" | "postgres",
  secrets: string[],
  t0: number,
): Promise<RelayProbeResult> {
  const name = bindingName.trim();
  if (!name) {
    return {
      ok: false,
      probe: "Hyperdrive",
      latency_ms: Date.now() - t0,
      message: "Enter a Hyperdrive binding name, or use another supported path (Neon HTTP URI for Postgres, or an HTTPS gateway).",
    };
  }
  if (!BINDING_NAME.test(name)) {
    return { ok: false, probe: "Hyperdrive", latency_ms: Date.now() - t0, message: "Binding names may contain only letters, digits and underscore." };
  }
  const binding = getHyperdrive(env, name);
  if (!binding) {
    const attached = listHyperdriveBindingNames(env);
    return {
      ok: false,
      probe: `Hyperdrive ${name}`,
      latency_ms: Date.now() - t0,
      message: `No Hyperdrive binding named ${name} is attached to this Worker. Attached bindings: ${attached.length ? attached.join(", ") : "none"}. Create a config in the dashboard or with wrangler hyperdrive create, add { "binding": "${name}", "id": "<hyperdrive id>" } under hyperdrive in wrangler.jsonc, and redeploy. This app does not create Hyperdrive configs.`,
    };
  }
  try {
    if (kind === "postgres") {
      const postgres = (await import("postgres")).default;
      const sql = postgres(binding.connectionString, { max: 1, connect_timeout: 8 });
      try {
        await sql`SELECT 1 AS ok`;
        return { ok: true, probe: `Hyperdrive ${name} SELECT 1`, latency_ms: Date.now() - t0, message: `SELECT 1 succeeded through Hyperdrive binding ${name}.` };
      } finally {
        await sql.end({ timeout: 2 }).catch(() => undefined);
      }
    }
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({ uri: binding.connectionString, connectTimeout: TIMEOUT_MS, disableEval: true });
    try {
      await conn.query("SELECT 1 AS ok");
      return { ok: true, probe: `Hyperdrive ${name} SELECT 1`, latency_ms: Date.now() - t0, message: `SELECT 1 succeeded through Hyperdrive binding ${name}.` };
    } finally {
      await conn.end().catch(() => undefined);
    }
  } catch (err) {
    return {
      ok: false,
      probe: `Hyperdrive ${name}`,
      latency_ms: Date.now() - t0,
      message: sanitize(err instanceof Error ? err.message : String(err), secrets),
    };
  }
}

export async function probeTunnelHealth(
  rawUrl: string,
  accessId: string,
  accessSecret: string,
  secrets: string[],
  probe: string,
  t0: number,
): Promise<RelayProbeResult> {
  let base: URL;
  try {
    base = new URL(rawUrl);
  } catch {
    return { ok: false, probe, latency_ms: Date.now() - t0, message: "Gateway URL must be a valid HTTPS URL." };
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return { ok: false, probe, latency_ms: Date.now() - t0, message: "Gateway URL must be http or https. This Worker will not open Oracle Net, Hive Thrift or MongoDB TCP itself." };
  }
  const headers: Record<string, string> = { accept: "application/json, text/plain, */*" };
  if (accessId) headers["CF-Access-Client-Id"] = accessId;
  if (accessSecret) headers["CF-Access-Client-Secret"] = accessSecret;
  const candidates: string[] = [base.toString()];
  if (base.pathname === "/" || base.pathname === "") {
    candidates.push(new URL("/health", base).toString(), new URL("/healthz", base).toString());
  }
  let last: { status: number; text: string; url: string } | null = null;
  let lastErr = "";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = sanitize(await res.text(), secrets).slice(0, 240);
      last = { status: res.status, text, url };
      if (res.ok) {
        return {
          ok: true,
          http_status: res.status,
          probe,
          latency_ms: Date.now() - t0,
          message: `Gateway health ${url} responded HTTP ${res.status}.`,
        };
      }
    } catch (err) {
      lastErr = sanitize(err instanceof Error ? err.message : String(err), secrets);
    }
  }
  if (last) {
    return {
      ok: false,
      http_status: last.status,
      probe,
      latency_ms: Date.now() - t0,
      message: `Gateway health ${last.url} responded HTTP ${last.status}. ${last.text}`,
    };
  }
  return { ok: false, probe, latency_ms: Date.now() - t0, message: lastErr || "The gateway health endpoint could not be reached." };
}
