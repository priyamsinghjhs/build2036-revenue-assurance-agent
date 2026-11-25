/**
 * Time one live background recon job end to end, polling like the Agents page (1.2s).
 * Usage: APP_SHARED_PASSWORD=... node scripts/time-live-job.mjs [all|deterministic] [baseUrl]
 * Never prints the password.
 */
const mode = process.argv[2] === "deterministic" ? "deterministic" : "all";
const base = process.argv[3] || "https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev";
const pw = process.env.APP_SHARED_PASSWORD;
if (!pw) throw new Error("APP_SHARED_PASSWORD is not set");
const jar = new Map();
async function api(path, init = {}) {
  const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers || {}) } });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const [k, ...v] = kv.split("="); jar.set(k, v.join("=")); }
  const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null }; }
}
await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: pw }) });
const csrf = await api("/api/csrf");
const t0 = Date.now();
const job = await api("/api/recon/jobs", { method: "POST", headers: { "x-csrf-token": csrf.json?.token || "", "idempotency-key": `time-${mode}-${Date.now()}` },
  body: JSON.stringify({ scope: "all", include_narrative: mode === "all" }) });
if (job.status !== 202 && job.status !== 200) throw new Error(`create ${job.status}`);
let st = job.json; let polls = 0;
while (Date.now() - t0 < 300_000) {
  await new Promise((r) => setTimeout(r, 1200));
  st = (await api(`/api/recon/jobs/${job.json.job_id}`)).json; polls++;
  if (st.status === "succeeded" || st.status === "failed") break;
}
console.log(JSON.stringify({ mode, job_id: job.json.job_id, status: st.status, wall_ms: Date.now() - t0, polls, chunks: st.chunks,
  done: st.progress?.done, failed: st.progress?.failed, total: st.progress?.total,
  steps: (st.steps || []).map((s) => `${s.agent_id}=${s.ms}ms${s.status !== "done" ? ":" + s.status : ""}`).join(" ") }));
