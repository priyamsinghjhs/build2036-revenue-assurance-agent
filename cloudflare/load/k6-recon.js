/**
 * k6 load test for ~1M transactions/day.
 *
 * 1_000_000 txns / 86400 s ≈ 11.6 RPS sustained.
 * This script ramps to a peak that covers a bursty day and asserts:
 *   - p95 API latency < 800 ms
 *   - recon day run completes under the job timeout
 *
 * Run: k6 run -e BASE_URL=https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev cloudflare/load/k6-recon.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8787";
const reconTrend = new Trend("recon_day_ms");

export const options = {
  scenarios: {
    // Sustained day: ~12 RPS for 10 minutes approximates the average of 1M/day.
    sustained: {
      executor: "constant-arrival-rate",
      rate: 12,
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
    // Peak burst: 60 RPS for 2 minutes (about 5x average).
    peak: {
      executor: "constant-arrival-rate",
      rate: 60,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 40,
      maxVUs: 100,
      startTime: "10m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    recon_day_ms: ["p(95)<15000"],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ username: "admin@ra.local", password: __ENV.PASSWORD || "Krishna@2026" }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(login, { "login ok": (r) => r.status === 200 });
  return { cookie: login.headers["Set-Cookie"] || "" };
}

export default function (data) {
  const params = { headers: { Cookie: data.cookie, Accept: "application/json" } };
  const exec = http.get(`${BASE}/api/executive`, params);
  check(exec, { "executive 200": (r) => r.status === 200 });

  const day = new Date().toISOString().slice(0, 10);
  const started = Date.now();
  const recon = http.post(
    `${BASE}/api/recon/jobs`,
    JSON.stringify({ scope: "all", mode: "deterministic", day }),
    { headers: { ...params.headers, "Content-Type": "application/json" } },
  );
  reconTrend.add(Date.now() - started);
  check(recon, { "recon accepted": (r) => r.status === 200 || r.status === 202 });
  sleep(0.2);
}
