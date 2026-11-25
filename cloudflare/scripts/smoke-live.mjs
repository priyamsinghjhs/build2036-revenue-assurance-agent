/**
 * Post-deploy smoke test. Reads APP_SHARED_PASSWORD from the environment and never prints it.
 * Usage: APP_SHARED_PASSWORD=... node scripts/smoke-live.mjs [baseUrl]
 * Exit code 1 on any failure (including a Cloudflare 1101 page).
 */
const base = process.argv[2] || "https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev";
const pw = process.env.APP_SHARED_PASSWORD;
if (!pw) throw new Error("APP_SHARED_PASSWORD is not set");
const results = [];
let failed = 0;
const ok = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failed += 1;
};
async function timed(fn) {
  const t0 = Date.now();
  const v = await fn();
  return [v, Date.now() - t0];
}

for (const path of ["/", "/review", "/agents", "/recovery", "/recon-rules"]) {
  const [r, ms] = await timed(() => fetch(base + path));
  const text = await r.text();
  ok(`page ${path}`, r.status === 200 && !/Error 1101|Worker threw exception/i.test(text), `${r.status} ${ms}ms`);
}

const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: pw }),
});
const cookies = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
ok("login admin", login.status === 200, `${login.status}`);
const jar = new Map(cookies.map((c) => c.split("=")).map(([k, ...v]) => [k, v.join("=")]));
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
async function api(path, init = {}) {
  const t0 = Date.now();
  const r = await fetch(base + path, { ...init, headers: { accept: "application/json", "content-type": "application/json", cookie: cookieHeader(), ...(init.headers || {}) } });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const [k, ...v] = kv.split("=");
    jar.set(k, v.join("="));
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, ms: Date.now() - t0, text };
}

const me = await api("/api/auth/me");
ok("auth/me", me.status === 200 && me.json?.user?.role === "admin", `${me.status}`);
const exec = await api("/api/executive");
ok("executive", exec.status === 200 && exec.json?.kpis, `${exec.status} ${exec.ms}ms leakage=${exec.json?.kpis?.leakage} n=${exec.json?.kpis?.exception_count}`);
const rec = await api("/api/recovery/summary");
ok("recovery summary", rec.status === 200, `${rec.status} ${rec.ms}ms potential=${rec.json?.potential} recovered=${rec.json?.recovered} rate=${rec.json?.recovery_rate} n=${rec.json?.n}`);
ok("recovery potential == exec book leakage", Math.abs(Number(rec.json?.potential) - Number(exec.json?.kpis?.leakage)) <= 0.009 && rec.json?.check?.potential_equals_book_leakage === true,
  `potential=${rec.json?.potential} exec=${exec.json?.kpis?.leakage} sql_book=${rec.json?.check?.book_leakage}`);
ok("recovery items == exec exception count", Number(rec.json?.n) === Number(exec.json?.kpis?.exception_count), `${rec.json?.n} vs ${exec.json?.kpis?.exception_count}`);
const list = await api("/api/recovery?limit=5");
ok("recovery list", list.status === 200 && list.json?.rows?.length > 0, `${list.status} ${list.ms}ms total=${list.json?.page?.total}`);
const firstId = list.json?.rows?.[0]?.exception_id;
if (firstId) {
  const item = await api(`/api/recovery/items/${encodeURIComponent(firstId)}`);
  ok("recovery item", item.status === 200 && item.json?.item?.exception_id === firstId, `${item.status} state=${item.json?.item?.state} allowed=${(item.json?.allowed_next || []).join("|")}`);
}
const rules = await api("/api/recon/rules");
ok("recon rules", rules.status === 200 && rules.json?.active?.version >= 1, `${rules.status} active=v${rules.json?.active?.version} apm_tol=${rules.json?.active?.config?.areas?.apm?.amount_tolerance}`);
const rh = await api("/api/recon/rules/history");
ok("recon rules history", rh.status === 200, `${rh.status} rows=${rh.json?.history?.length}`);

// Compliance / usability endpoints from PRs #7/#8.
const csrf = await api("/api/csrf");
ok("csrf token", csrf.status === 200 && typeof csrf.json?.token === "string", `${csrf.status}`);
const gl = await api("/api/glossary");
ok("glossary", gl.status === 200, `${gl.status} ${gl.ms}ms`);
const sla = await api("/api/sla");
ok("sla ageing", sla.status === 200 && Array.isArray(sla.json?.ageing), `${sla.status} buckets=${sla.json?.ageing?.length}`);
if (firstId) {
  const why = await api(`/api/exceptions/${encodeURIComponent(firstId)}/why`);
  ok("exception why", why.status === 200, `${why.status} ${why.ms}ms`);
}
const noCsrf = await api("/api/recon/jobs", { method: "POST", body: JSON.stringify({ scope: "all", include_narrative: false }) });
ok("csrf enforced on job create", noCsrf.status === 403, `${noCsrf.status}`);

// Background recon job (deterministic: no Workers AI neurons).
const key = `smoke-${Date.now()}`;
const job = await api("/api/recon/jobs", { method: "POST", body: JSON.stringify({ scope: "all", include_narrative: false }), headers: { "x-csrf-token": csrf.json?.token || "", "idempotency-key": key } });
ok("job create 202", job.status === 202 || (job.status === 200 && job.json?.reused), `${job.status} ${job.ms}ms id=${job.json?.job_id}`);
let st = job.json;
const t0 = Date.now();
for (let i = 0; i < 60 && st?.job_id; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const g = await api(`/api/recon/jobs/${st.job_id}?outputs=1`);
  st = { ...g.json, job_id: st.job_id };
  if (st.status === "succeeded" || st.status === "failed") break;
}
const grounded = (st?.outputs || []).filter((o) => o.output?.verification === "grounded").length;
ok("job completes", st?.status === "succeeded", `${st?.status} ${Date.now() - t0}ms steps=${st?.progress?.done}/${st?.progress?.total} chunks=${st?.chunks} grounded=${grounded}`);

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} — ${r.detail}`);
console.log(`smoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
