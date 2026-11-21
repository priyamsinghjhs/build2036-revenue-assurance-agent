# Agentic Revenue Assurance Copilot

**BUILD 2036 — Applied AI & Agentic Intelligence**

A fully open-source, multi-agent system that performs first-pass revenue assurance investigations for Treasury and Finance teams. Agents autonomously detect anomalies, investigate root causes, synthesize evidence, recommend actions, and generate CFO-ready audit trails.

**Zero cloud credits required for local use.** Runs entirely locally with DuckDB + Ollama + LangGraph, or deploy the Streamlit app on Render with Cloudflare Workers AI.

## Agents

| Agent | Responsibility |
|-------|----------------|
| **Anomaly Detector** | Flags fee variance, settlement mismatches, unexpected volume, delayed settlements using statistical rules + DuckDB |
| **Investigator** | Digs into root cause with SQL queries against DuckDB + RAG over contracts/fee schedules |
| **Evidence Synthesizer** | Builds structured case with numbers, timeline, and supporting evidence |
| **Recommendation Agent** | Proposes action (auto-adjust, dispute, escalate, mark known) + confidence score |
| **Auditor / Explainer** | Generates CFO-ready summary with full audit trail |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/priyamsinghjhs/build2036-revenue-assurance-agent.git
cd build2036-revenue-assurance-agent
pip install -r requirements.txt

# 2. Start Ollama and pull a model
ollama serve
ollama pull llama3.1:8b   # or qwen2.5:7b / mistral

# 3. Initialize synthetic data
python src/data/init_db.py

# 4. Run the demo
streamlit run app.py
```

`LLM_PROVIDER` defaults to `ollama`. The app also creates `data/revenue_assurance.db` on startup if it is missing.

## Deploy

Host the Streamlit app on Render's free web service and call Cloudflare Workers AI for the LLM.

1. In the Cloudflare dashboard, create a Workers AI API token and copy your account ID.
2. Connect this repo as a Render Blueprint (`render.yaml`) or as a Python web service. The Blueprint uses:
   - **Build:** `pip install -r requirements.txt && python src/data/init_db.py`
   - **Start:** `streamlit run app.py --server.port $PORT --server.address 0.0.0.0 --server.headless true --browser.gatherUsageStats false`
   - **Health check:** `/_stcore/health`
3. When prompted, set `CF_ACCOUNT_ID` and `CF_AI_API_TOKEN`. `LLM_PROVIDER` is already set to `cloudflare`, and `CLOUDFLARE_MODEL` defaults to `@cf/meta/llama-4-scout-17b-16e-instruct` (Workers AI text-gen, tool-calling).
4. After the deploy succeeds, open the `*.onrender.com` URL.

The free instance sleeps after 15 minutes of inactivity, so the first visit after a break can take about a minute. Render's ephemeral disk does not persist the DuckDB file; the app rebuilds the synthetic database on startup.


## Deploy on Cloudflare Containers

The same Streamlit app can run as a [Cloudflare Container](https://developers.cloudflare.com/containers/) behind a Worker, at `https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev`.

The Worker uses the current Durable Object Container API (the `@cloudflare/containers` package is deprecated). HTTP and WebSocket traffic is forwarded to a single named container instance so Streamlit sessions stick. The container uses instance type `standard-1`, sleeps after 15 minutes of inactivity, and needs outbound Internet for Workers AI.

```bash
npm install
# One-time: authenticate Wrangler, then set the Workers AI token as a Worker secret
npx wrangler login
npx wrangler secret put CF_AI_API_TOKEN
npx wrangler deploy
```

Containers require the Workers Paid plan. `CF_ACCOUNT_ID`, `LLM_PROVIDER`, and `CLOUDFLARE_MODEL` are plain Worker vars in `wrangler.jsonc` and are passed into the container at start.

## Architecture

```
Streamlit UI → LangGraph Multi-Agent Flow
                ├─ DuckDB (settlements, fees, transactions)
                ├─ Ollama (local LLM) or Cloudflare Workers AI
                └─ Keyword retrieval over fee-policy documents
```


## Cloudflare-native (Workers Free)

The app also runs entirely on the Cloudflare free plan as a React + Vite + Tailwind SPA served from a TypeScript Worker (D1 + Workers AI). This replaces the workers.dev proxy and does not use Containers or Pages.

See [`cloudflare/README.md`](cloudflare/README.md) for deploy steps (`cd cloudflare && npm install && npx wrangler d1 migrations apply revenue-assurance --remote && npm run deploy`).

Live URL: https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev

The five-agent investigation is unchanged in prompts and outputs; the LangGraph flow is sequential TypeScript steps invoked one agent per API request so the Worker stays inside free-plan limits. The synthetic DuckDB dataset is seeded into D1 from the same literals as `src/data/init_db.py`.

## Why This Fits BUILD 2036

- **Vertical AI Copilot** for Treasury/Finance revenue assurance
- **Multi-agent reasoning** with tool use, structured output, and auditability
- **Transforms decision-making**: first-pass investigation that currently takes hours of analyst time
- **2036 narrative**: By 2036, treasury teams will have agentic investigators instead of manual queues
- **Domain authenticity**: Inspired by real RADAR-style revenue assurance platforms

## Tech Stack (All Open Source)

- **Data**: DuckDB
- **LLM**: Ollama (Llama 3.1) locally, or Cloudflare Workers AI (Llama 4 Scout) in production
- **Orchestration**: LangGraph
- **RAG**: Keyword retrieval over fee schedules (upgradeable to a vector store)
- **UI**: Streamlit
- **Anomaly**: pandas + DuckDB settlement checks, with LLM classification

## Project Structure

```
├── app.py                      # Streamlit demo
├── Dockerfile                  # Container image for Cloudflare / local
├── wrangler.jsonc              # Cloudflare Containers + Worker config
├── worker/index.ts             # Routes HTTP/WebSocket to one container
├── render.yaml                 # Render Blueprint (free web service)
├── src/
│   ├── agents/                 # All 5 agents
│   ├── tools/                  # DuckDB + RAG tools
│   ├── graph.py                # LangGraph orchestration
│   └── data/init_db.py         # Synthetic data generator
├── requirements.txt
├── cloudflare/                 # Free-plan Worker + React SPA + D1
└── README.md
```

## Demo Flow

1. Select or paste a settlement / fee anomaly
2. Watch Anomaly Detector flag it
3. Investigator pulls related data + contract context
4. Evidence Synthesizer builds the case
5. Recommendation Agent proposes action + confidence
6. Auditor generates CFO-ready summary with full audit trail

Built for the **11th TiE Global Summit 2026 — BUILD 2036** hackathon.
