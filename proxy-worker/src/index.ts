/**
 * Free-plan proxy: workers.dev → the Render Streamlit app.
 * The repo-root Worker (Containers + Durable Objects) is kept for a
 * future Workers Paid upgrade; deploy this project from proxy-worker/.
 */

const UPSTREAM_HOST = "revenue-assurance-agent.onrender.com";
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;
const ORIGIN_TIMEOUT_MS = 25_000;
const RETRYABLE = new Set([502, 503, 504, 521, 522, 523, 524]);

export default {
  async fetch(request: Request, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const incoming = new URL(request.url);
    const target = new URL(request.url);
    target.hostname = UPSTREAM_HOST;
    target.protocol = "https:";
    target.port = "";

    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";

    // Kick Render's free-tier dyno even if this request later times out.
    if (!isWebSocket) {
      ctx.waitUntil(wakeUpstream());
    }

    const outbound = new Request(target.toString(), {
      method: request.method,
      headers: rewriteRequestHeaders(request.headers),
      body: request.body,
      redirect: "manual",
      // Required when forwarding a streamed body in some runtimes.
      ...(request.body ? { duplex: "half" as const } : {}),
    });

    try {
      const upstream = isWebSocket
        ? await fetch(outbound)
        : await fetchWithTimeout(outbound, ORIGIN_TIMEOUT_MS);

      if (isWebSocket) {
        return upstream;
      }

      if (RETRYABLE.has(upstream.status) && wantsFriendlyPage(request)) {
        return wakingUpPage(incoming);
      }

      return rewriteResponse(upstream, incoming);
    } catch {
      if (isWebSocket) {
        return new Response("Upstream WebSocket unavailable", { status: 502 });
      }
      return wakingUpPage(incoming);
    }
  },
};

async function wakeUpstream(): Promise<void> {
  try {
    await fetchWithTimeout(
      new Request(`${UPSTREAM_ORIGIN}/_stcore/health`, { method: "GET", redirect: "manual" }),
      ORIGIN_TIMEOUT_MS,
    );
  } catch {
    // Render may still be booting; the next browser refresh will retry.
  }
}

function rewriteRequestHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  // Streamlit checks Origin / Referer against its own host for XSRF.
  // Present the Render origin so we do not need to disable CORS/XSRF there.
  if (headers.has("Origin")) {
    headers.set("Origin", UPSTREAM_ORIGIN);
  }
  const referer = headers.get("Referer");
  if (referer) {
    try {
      const ref = new URL(referer);
      ref.hostname = UPSTREAM_HOST;
      ref.protocol = "https:";
      ref.port = "";
      headers.set("Referer", ref.toString());
    } catch {
      headers.delete("Referer");
    }
  }
  // Host is derived from the target URL by fetch(); drop any stale value.
  headers.delete("Host");
  return headers;
}

function rewriteResponse(upstream: Response, incoming: URL): Response {
  const headers = new Headers(upstream.headers);

  const location = headers.get("Location");
  if (location) {
    try {
      const loc = new URL(location, UPSTREAM_ORIGIN);
      if (loc.hostname === UPSTREAM_HOST) {
        loc.protocol = incoming.protocol;
        loc.hostname = incoming.hostname;
        loc.port = incoming.port;
        headers.set("Location", loc.toString());
      }
    } catch {
      // leave as-is
    }
  }

  const acao = headers.get("Access-Control-Allow-Origin");
  if (acao && acao !== "*") {
    headers.set("Access-Control-Allow-Origin", incoming.origin);
    headers.append("Vary", "Origin");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function wantsFriendlyPage(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  const path = new URL(request.url).pathname;
  if (path.startsWith("/_stcore/")) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return accept.includes("text/html") || accept.includes("*/*") || accept === "";
}

function wakingUpPage(incoming: URL): Response {
  const href = incoming.pathname + incoming.search;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="8;url=${escapeHtml(href)}">
  <title>Waking up — Revenue Assurance Agent</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; min-height: 100vh;
      display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
    main { max-width: 36rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
    p { line-height: 1.55; color: #cbd5e1; }
    .spin { width: 2rem; height: 2rem; margin: 0 auto 1.25rem; border: 3px solid #334155;
      border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main>
    <div class="spin" aria-hidden="true"></div>
    <h1>Waking up, refresh in a minute</h1>
    <p>The Revenue Assurance app is starting on Render&rsquo;s free tier. This page refreshes automatically; you can also refresh manually in about a minute.</p>
  </main>
  <script>setTimeout(function () { location.reload(); }, 8000);</script>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "8",
    },
  });
}

async function fetchWithTimeout(request: Request, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}
