const mem = new Map<string, { exp: number; body: string }>();
export const DASHBOARD_TTL_MS = 120_000;

function cacheRequest(key: string): Request {
  return new Request("https://ra-cache.internal/" + key, { method: "GET" });
}

/** Isolate memory + Cache API. No KV. TTL defaults to 2 minutes. */
export async function cachedJson(
  key: string,
  loader: () => Promise<unknown>,
  ttlMs = DASHBOARD_TTL_MS,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.exp > now) {
    return jsonResponse(hit.body, "mem");
  }

  try {
    const cached = await caches.default.match(cacheRequest(key));
    if (cached) {
      const body = await cached.text();
      mem.set(key, { exp: now + ttlMs, body });
      return jsonResponse(body, "cache-api");
    }
  } catch {
    // Cache API can be unavailable in some local runtimes.
  }

  const data = await loader();
  const body = JSON.stringify(data);
  mem.set(key, { exp: now + ttlMs, body });

  const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
  try {
    const stored = new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, s-maxage=${maxAge}`,
      },
    });
    const put = caches.default.put(cacheRequest(key), stored);
    if (waitUntil) waitUntil(put);
  } catch {
    // ignore
  }
  return jsonResponse(body, "miss", maxAge);
}

export function invalidateMem(prefix = ""): void {
  for (const key of [...mem.keys()]) {
    if (!prefix || key.startsWith(prefix)) mem.delete(key);
  }
}

function jsonResponse(body: string, via: string, maxAge?: number): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-cache": via,
  };
  if (maxAge) headers["cache-control"] = `public, s-maxage=${maxAge}`;
  return new Response(body, { headers });
}
