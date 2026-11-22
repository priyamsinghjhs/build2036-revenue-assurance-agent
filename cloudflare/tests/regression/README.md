# Regression suite

Runs a rigorous, free-tier-friendly regression against the live Worker and an isolated Neon branch.

```bash
export REGRESSION_DATABASE_URL=...   # test branch only — never the production URL
# or: export REGRESSION_DATABASE_URL_FILE=/path/to/url
evals are not required. This suite prefers deterministic SQL and HTTP checks and does not call an LLM judge.
cloudflare/tests/regression/run.sh
```

What it covers:

1. **Functional** — plants known breaks (`REGTEST-*`, `CAP-REGTEST-1`, …) on the Neon branch and asserts each domain view detects the exact ID, amount and category. A clean merchant (`MER_REGCLEAN`) must stay matched with ₹0 leakage. Book leakage (area summary) is reconciled to the KPI and the live Executive payload. KYC/AML and other risk/ops areas are treated as exposure, not book leakage.
2. **Technical** — every important `/api/*` GET returns 200 with schema-shaped JSON; bad IDs and empty bodies are errors; ask-your-data rejects writes and injections; refresh is idempotent (counts and open anomalies/cases stay put); endpoint latency is recorded; `tsc` for the Worker and the app; Playwright smoke on all primary routes at 1440, 1280 and 390 (0 console errors, 0 overlaps, bar-chart tick count equals bar count).
3. **Autonomy** — asserts the cron `15 2 * * *` is registered, reads the last `ra_automation_log` row, and triggers `scheduled()` via `wrangler dev --test-scheduled` against the **test branch** (not production). Contract-rule approval, the review queue, suggestion accept/dismiss, and outbound drafts remain human-gated and the gates are asserted.

The suite never mutates production seed data and never prints secrets. Delete the temporary Neon branch when the run finishes.
