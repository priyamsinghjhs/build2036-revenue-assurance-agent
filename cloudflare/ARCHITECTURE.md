# Architecture notes

## Orchestration

Two implementations exist:

1. **Local / Streamlit** (`src/graph.py`): LangGraph `StateGraph` with in-memory `AgentState`. Linear flow, no persistence. Used for local demo.

2. **Cloudflare Workers** (production): Manual step runner in `worker/agentRunner.ts`. State stored in `ra_agent_outputs` keyed by `run_id`. Supports deterministic fallback, grounding checks, and SSE streaming. This is the source of truth for the live app.

Shared contract: each agent receives compact SQL summaries and returns structured JSON. Later agents receive the last few prior outputs.

## Free-tier constraints

- Workers Free CPU and request limits
- Neon free tier
- Workers AI neuron budget

Heavy work should move to Queues + Cron (skeleton in `queueConsumer.ts`).

## Security

- Per-user passwords: migration `019` (branch)
- CSRF: `csrf.ts` + `/api/csrf`
- PAN masking: `shared/mask.ts`
- Data retention: `retention.ts` + migration `021`
