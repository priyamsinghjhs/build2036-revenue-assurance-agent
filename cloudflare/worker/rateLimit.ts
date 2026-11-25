/** Cache-API rate limiter (no KV). Best-effort per colo; login lockout also uses Postgres. */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

function keyUrl(key: string): Request {
  return new Request(`https://ra-ratelimit.internal/${encodeURIComponent(key)}`);
}

export async function hitRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const req = keyUrl(key);
  let count = 0;
  let started = Date.now();
  try {
    const cache = (globalThis as { caches?: { default?: { match: (r: Request) => Promise<Response | undefined>; put: (r: Request, s: Response) => Promise<void> } } }).caches?.default;
    if (!cache) return { ok: true, remaining: limit, retryAfterSec: windowSec };
    const existing = await cache.match(req);
    if (existing) {
      const body = (await existing.json()) as { n?: number; started?: number };
      count = Number(body.n || 0);
      started = Number(body.started || started);
      const age = (Date.now() - started) / 1000;
      if (age >= windowSec) {
        count = 0;
        started = Date.now();
      }
    }
  } catch {
    count = 0;
    started = Date.now();
  }
  count += 1;
  const remainingWindow = Math.max(1, windowSec - Math.floor((Date.now() - started) / 1000));
  try {
    const cachePut = (globalThis as { caches?: { default?: { put: (r: Request, s: Response) => Promise<void> } } }).caches?.default;
    if (cachePut) {
      await cachePut.put(
        req,
        new Response(JSON.stringify({ n: count, started }), {
          headers: { "content-type": "application/json", "cache-control": `max-age=${remainingWindow}` },
        }),
      );
    }
  } catch {
    // Cache put can fail on some runtimes; fail open would burn AI, so fail closed for AI keys only at the call site if needed.
  }
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: remainingWindow,
  };
}

export function clientIp(req: { header: (name: string) => string | undefined }): string {
  const cf = req.header("cf-connecting-ip") || "";
  if (cf) return cf.slice(0, 64);
  const xff = req.header("x-forwarded-for") || "";
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return "unknown";
}
