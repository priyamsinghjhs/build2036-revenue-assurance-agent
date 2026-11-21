# Cloudflare-native Revenue Assurance Copilot

Free-plan rewrite of the Streamlit / LangGraph / DuckDB app:

- **Frontend:** React + TypeScript + Vite + Tailwind CSS, built to static assets
- **Worker:** TypeScript (Hono) with a D1 database and a Workers AI binding
- **URL:** served by the same Worker at `https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev`

The five-agent pipeline (Anomaly Detector → Investigator → Evidence Synthesizer → Recommendation → Auditor) is ported faithfully from `src/agents/agents.py`, with the LangGraph DAG expressed as sequential HTTP steps driven by the frontend. Each step is a separate `/api/agents/*` request so a single Worker invocation stays within free-plan CPU / subrequest limits (Workers AI waits do not count toward CPU time).

No API token secret is required at runtime: the Worker calls `env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct")`.

## Deploy (Workers Free plan)

You need a Cloudflare API token with Workers edit, D1 edit, and Workers AI access, plus account `95f96d50618b771a8c58542029828a1a`.

```bash
cd cloudflare
npm install

# First time only: create the D1 database (free plan allows 10 databases).
npx wrangler d1 create revenue-assurance
# Paste the printed database_id into wrangler.jsonc → d1_databases[0].database_id

# Apply schema + deterministic seed (generated from src/data/init_db.py).
npx wrangler d1 migrations apply revenue-assurance --remote

npm run deploy
```

Local development (optional):

```bash
npx wrangler d1 migrations apply revenue-assurance --local
# Terminal 1
npx wrangler dev
# Terminal 2
npm run dev   # Vite on :5173, proxies /api to wrangler on :8787
```

Regenerate the seed SQL after changing the Python data literals:

```bash
python scripts/generate_seed.py
```

## Free-plan limits

- **Workers Free:** 100,000 requests/day; 10 ms CPU per request (I/O and Workers AI waits are not CPU). Do not enable Workers Paid, Containers, or other billable add-ons.
- **D1 Free:** 10 databases / account, 500 MB per database, 5 million rows read / day, 100,000 rows written / day.
- **Workers AI Free:** 10,000 neurons/day (resets 00:00 UTC). Llama 4 Scout is billed at \$0.27 / M input tokens and \$0.85 / M output tokens (≈24.5k neurons / M input, ≈77.3k neurons / M output). A full five-agent investigation typically uses a few hundred neurons; plan on on the order of tens of investigations per day before the free allocation is exhausted. Further inference fails until the next UTC day unless the account is on Workers Paid.
- Agent `max_tokens` is set to 1024 (Workers AI defaults to 256, which would truncate evidence and CFO summaries).

The original Render service is left running and is not required for this deployment.
