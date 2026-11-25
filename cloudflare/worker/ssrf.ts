/**
 * Deny-list for user-supplied fetch targets.
 * HTTPS only; no loopback, link-local, private, CGNAT, metadata, or non-http(s) schemes.
 * Resolves DNS (DoH) before connect and refuses redirects to internal destinations.
 */

const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip: number, prefix: string, bits: number): boolean {
  const base = ipv4ToInt(prefix);
  if (base == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return true;
  return (
    inCidr(n, "0.0.0.0", 8) ||
    inCidr(n, "10.0.0.0", 8) ||
    inCidr(n, "100.64.0.0", 10) ||
    inCidr(n, "127.0.0.0", 8) ||
    inCidr(n, "169.254.0.0", 16) ||
    inCidr(n, "172.16.0.0", 12) ||
    inCidr(n, "192.168.0.0", 16) ||
    inCidr(n, "192.0.0.0", 24) ||
    inCidr(n, "192.0.2.0", 24) ||
    inCidr(n, "198.18.0.0", 15) ||
    inCidr(n, "198.51.100.0", 24) ||
    inCidr(n, "203.0.113.0", 24) ||
    inCidr(n, "224.0.0.0", 4) ||
    inCidr(n, "240.0.0.0", 4)
  );
}

export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().trim();
  if (s === "::1" || s === "0:0:0:0:0:0:0:1") return true;
  if (s.startsWith("fe80:") || s.startsWith("fec0:")) return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true;
  if (s.startsWith("ff")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f:.]+)$/i.exec(s);
  if (mappedHex && mappedHex[1].includes(".")) return isPrivateIPv4(mappedHex[1]);
  return false;
}

export function isIpLiteral(host: string): "v4" | "v6" | null {
  const h = host.replace(/^\[|\]$/g, "");
  if (ipv4ToInt(h) != null) return "v4";
  if (h.includes(":")) return "v6";
  return null;
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata",
]);

export function hostnameBlocked(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home")) return true;
  if (h === "localhost6" || h.endsWith(".localhost6")) return true;
  return false;
}

export function assertHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL is not valid.");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTPS destinations are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  }
  const host = url.hostname;
  if (hostnameBlocked(host)) {
    throw new UnsafeUrlError("That host is not allowed.");
  }
  const kind = isIpLiteral(host);
  if (kind === "v4" && isPrivateIPv4(host.replace(/^\[|\]$/g, ""))) {
    throw new UnsafeUrlError("Private or loopback IPv4 destinations are not allowed.");
  }
  if (kind === "v6" && isPrivateIPv6(host.replace(/^\[|\]$/g, ""))) {
    throw new UnsafeUrlError("Private or loopback IPv6 destinations are not allowed.");
  }
  return url;
}

type DohAnswer = { Status: number; Answer?: { type: number; data: string }[] };

async function doh(host: string, type: "A" | "AAAA"): Promise<string[]> {
  const url = `${DOH}?name=${encodeURIComponent(host)}&type=${type}`;
  const res = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new UnsafeUrlError("Could not resolve the destination host.");
  const body = (await res.json()) as DohAnswer;
  const answers = body.Answer || [];
  const want = type === "A" ? 1 : 28;
  return answers.filter((a) => a.type === want && a.data).map((a) => a.data.replace(/\.$/, ""));
}

export async function resolvePublicHost(host: string): Promise<string[]> {
  const h = host.replace(/^\[|\]$/g, "");
  const kind = isIpLiteral(h);
  if (kind === "v4") {
    if (isPrivateIPv4(h)) throw new UnsafeUrlError("Private or loopback IPv4 destinations are not allowed.");
    return [h];
  }
  if (kind === "v6") {
    if (isPrivateIPv6(h)) throw new UnsafeUrlError("Private or loopback IPv6 destinations are not allowed.");
    return [h];
  }
  if (hostnameBlocked(h)) throw new UnsafeUrlError("That host is not allowed.");
  let v4: string[] = [];
  let v6: string[] = [];
  try {
    [v4, v6] = await Promise.all([doh(h, "A"), doh(h, "AAAA")]);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    throw new UnsafeUrlError("Could not resolve the destination host.");
  }
  const ips = [...v4, ...v6];
  if (!ips.length) throw new UnsafeUrlError("The destination host did not resolve to a public address.");
  for (const ip of ips) {
    if (ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip)) {
      throw new UnsafeUrlError("The destination host resolves to a private or link-local address.");
    }
  }
  return ips;
}

export async function assertSafeHttpsDestination(raw: string): Promise<URL> {
  const url = assertHttpsUrl(raw);
  await resolvePublicHost(url.hostname);
  return url;
}

export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeHttpsDestination(current);
    const res = await fetch(url.toString(), {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Too many redirects.");
}
