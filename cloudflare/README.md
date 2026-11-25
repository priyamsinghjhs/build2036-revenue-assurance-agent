# Revenue Assurance (Cloudflare + Neon)

Public Workers Free app with a React frontend and a Hono Worker. Runtime data is **Neon Postgres** (free tier) over `@neondatabase/serverless`. Dashboards read pre-aggregated summary tables and are cached for 120s. A daily Cron Trigger (02:15 UTC / 07:45 Asia/Calcutta) drafts the leadership brief, investigates the top exception within the Workers AI neuron budget, and seeds the Action Queue.

The landing page is an **Executive summary** for leadership (KPIs, waterfall, trend, top drivers, heatmap, recovery funnel, printable brief). Domain pages share one template. Palette: navy / slate, one blue accent, semantic red/amber/green for status only. Inter, 8px spacing, shadcn/Radix components.

Lifecycle now also covers **Merchant Settlement** (gross-to-net batches),
**Merchant Funding** (NEFT/RTGS/IMPS, SLA and account checks) and
**Acquirer / Sponsor** (volumes, fee pass-through, statement recon), with
dedicated Settlement, Funding and Acquirer agents on the orchestrator roster.

See `postgres/README.md` for apply steps. Do not bind D1. Hyperdrive is not used.

# Cloudflare-native Revenue Assurance

Graphical payment-acquiring revenue assurance app on the **Workers Free** plan.

- **Frontend:** React + TypeScript + Vite + Tailwind CSS, Recharts, React Flow, lucide-react
- **Worker:** TypeScript (Hono) + Neon Postgres + Workers AI binding `env.AI`
- **URL:** `https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev`

SQL does the matching math. Agents only interpret compact summaries, prioritize gaps, and recommend actions. Dashboard pages never call the LLM. Agent JSON is cached in Neon (`ra_agent_runs`, `ra_agent_outputs`, `ra_action_queue`). An optional offline compiler lives in `tools/offline/neuro_symbolic_auditor.py` (Docling + Ollama + DuckDB); the live app uses Workers AI, a JS SQL AST validator and Postgres NUMERIC tests instead.

All data is **synthetic** (seed=2036, October 2026 book) and labelled `is_synthetic = 1`.

## Pages

| Route | What you see |
|-------|----------------|
| `/` | KPI cards, money-flow graph, leakage trend, gap types, recon-by-domain |
| `/authorization` | Auth ↔ capture, expired auths, mismatches |
| `/scheme` | Visa / Mastercard / RuPay / Amex settlement and fee variance |
| `/bank` | TRS bank statement vs scheme net, unidentified credits |
| `/fees` | Gateway, network/switch, and partner/ISO fee invoices vs expected |
| `/terminals` | POS rental billing vs inventory |
| `/apm` | UPI, wallets, BNPL, net banking, A2A provider reports |
| `/fx` | Applied FX vs reference rate and markup cap |
| `/pricing` | MDR billed vs contracted bps |
| `/payouts` | Payout vs net settlement, overdue reserves |
| `/chargebacks` | Unrecovered chargebacks, double-counted refunds |
| `/lifecycle` | End-to-end system map of every hop, leakage on edges, click-through |
| `/billing` | Contract vs billing rating, unbilled usage |
| `/invoicing` | Billing vs invoices, credit notes, GST |
| `/cash` | Cash application, short-pays, unapplied cash, AR ageing |
| `/vendors` | Vendor invoices vs expected cost and payments (including duplicates) |
| `/gl` | Subledgers vs GL, unposted / misposted journals |
| `/hops` | Gateway↔switch↔clearing, bank statement↔TRS |
| `/settlement` | Merchant settlement batches, fees, gross-to-net, missing or duplicate txns |
| `/funding` | NEFT/RTGS/IMPS funding, SLA, wrong or changed accounts |
| `/acquirer` | Sponsor-bank volumes, fee pass-through, statement recon |
| `/controls` | Control library: health heatmap, failing controls, coverage by domain |
| `/config` | Pricing / MDR / commission / fee / limit change log and unapproved impact |
| `/tax` | GST 18% on MDR/fees, illustrative TDS and zero-MDR, daily cap breaches |
| `/kyc` | KYC status, risk tier, MCC, limits, aggregator hierarchy |
| `/interfaces` | Per-hop message counts and volumes, drops, daily funnel |
| `/aml` | Rule-based structuring, refund abuse, round-tripping, velocity, dormant bursts |
| `/network-risk` | Entity graph with Postgres risk scores; CSV export for offline GNN training |
| `/success` | Approval / failure reasons by channel, acquirer and APM, including EMI |
| `/trace` | End-to-end journey for a txn, batch or invoice id |
| `/agents` | Agent roster, React Flow handoff graph, visual outputs, action queue |
| `/investigate/:id` | On-demand investigator → action → auditor for one exception |
| `/contracts` | Contract documents, extracted rules, citations, edge-case tests and approval |
| `/anomalies` | z-score / EWMA sensors and on-demand investigation |
| `/routing` | Offline routing simulation (synthetic data) |
| `/ask` | Natural-language questions against allow-listed views |
| `/cases` | Root-cause cases, Kanban, SLA and history |
| `/risks` | Risk library mapped to controls and findings |
| `/files` | Missing and out-of-sequence daily files |
| `/ingestion` | Canonical settlement rows from camt.053, NPCI UPI, IPM and BASE II samples |
| `/review` | Human review queue for auditor needs_review items |
| `/review/:id` | Approve, reject or send back with a mandatory comment |

## Multi-agent pipeline

Deterministic SQL views compute matched / unmatched / variance and leakage. The frontend sequences `/api/agents/runs` then `/api/agents/step` (one LLM call per request) and finishes with `/api/agents/complete`.

| Agent | Role |
|-------|------|
| Orchestrator | Routes work and sets domain priority |
| Auth / Capture Recon | Interprets auth ↔ capture SQL |
| Scheme Settlement Recon | Interprets scheme settlement and fee SQL |
| Network & Gateway Recon | Interprets network and gateway invoices vs expected |
| Partner Fee Recon | Interprets ISO / referral / platform share |
| POS Terminal Recon | Interprets rental billing vs inventory |
| TRS Bank Recon | Interprets treasury bank vs scheme net |
| APM Recon | Interprets UPI / wallet / BNPL / A2A reports |
| FX Recon | Interprets applied FX vs reference rate |
| Gap / Leakage Detection | Prioritises leakage themes |
| Investigator / Root-cause | Explains why the top gaps exist |
| Action / Recommendation | Dispute, recover, re-bill, escalate, adjust — with amounts |
| Auditor / Compliance | Completeness, policy fit, sign-off |
| Config / Tax / KYC / Interfaces / AML / Network / Success recon | On-demand domain agents (not in “Run all”, to stay inside the free neuron budget) |

"Run all" is 13 sequential Workers AI calls (stay within 10k neurons/day). "Run pipeline" for one domain is 6 calls. A single-exception investigation is 3 calls (investigator, action, auditor). Re-running a cached scope still calls the LLM; opening dashboards does not.

Legacy settlement endpoints remain at `/api/settlements` and `/api/legacy/agents/*`.

## Data layer (Neon Postgres)

Runtime reads go to **Neon Postgres** (free tier) via `@neondatabase/serverless`,
not D1. See `postgres/README.md` for why D1 row-reads blew the free daily cap,
how summaries are materialized, and how to apply `postgres/001_schema_and_seed.sql`
plus `postgres/002_summaries.sql`. Dashboard JSON is cached 120s in memory and
the Cache API. Do not deploy until `DATABASE_URL` is set.

## Deploy (Workers Free plan)

You need a Cloudflare API token with Workers edit, D1 edit, and Workers AI access, plus account `95f96d50618b771a8c58542029828a1a`.

```bash
cd cloudflare
npm install
npx wrangler d1 migrations apply revenue-assurance --remote
npm run deploy
```

Seed SQL is generated by `python scripts/generate_payment_seed.py` (writes a combined file under `scripts/`) and split into `migrations/0002_ra_schema.sql` … `0032_exception_rows.sql`. Exceptions are materialized in `ra_exception_rows` so dashboard reads stay small on the D1 free 5M rows-read/day cap. A 14-way UNION view of the recon steps is too expensive on D1 and is split (`v_ra_exceptions_a/b/c`).

No API token secret is required at runtime: the Worker calls `env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct")`.

## Free-plan limits

- **Workers Free:** 100,000 requests/day; 10 ms CPU per request (I/O and Workers AI waits are not CPU). Do not enable Workers Paid, Containers, or other billable add-ons.
- **D1 Free:** 10 databases / account, 500 MB per database, 5 million rows read / day, 100,000 rows written / day.
- **Workers AI Free:** 10,000 neurons/day (resets 00:00 UTC). Llama 4 Scout is billed at \$0.27 / M input tokens and \$0.85 / M output tokens (≈24.5k neurons / M input, ≈77.3k neurons / M output). Agent `max_tokens` is 1024. A 18-agent "run all" can use on the order of a thousand neurons; prefer per-domain or single-exception runs if the daily allocation is tight. Further inference fails until the next UTC day unless the account is on Workers Paid.

The original Render service is left running and is not required for this deployment.


## AI quality and evaluations

After every LLM agent step the Worker runs a **deterministic grounding check**: numbers, amounts, IDs, dates and merchants in the output must appear in (or be derivable from) the SQL facts that were passed in. Faithfulness is supported claims / total claims. On failure the same agent is re-prompted with the unsupported claims (at most two reworks). If it still fails, the output is marked `unverified`, is not presented as fact, and is routed to the Review queue. An optional LLM-as-judge pass is deliberately **not** used at runtime, so the free neuron budget stays with the agents themselves. Prompts require the model to answer only from the provided context and to say `insufficient data` when a fact is missing; temperature is 0.

The Agents page has an **AI quality** panel (faithfulness, hallucination rate, reworks, unverified count per agent). The Executive summary shows a compact faithfulness KPI.

For a free local run on this box (no GitHub Actions, no OpenAI, no Confident AI), use `evals/run_local.sh` — see `evals/README.md`. Offline and in CI, `evals/` runs a [DeepEval](https://github.com/confident-ai/deepeval) suite (Faithfulness, Hallucination, Answer Relevancy, and Contextual Recall/Precision for contract RAG) using Workers AI as both the model-under-test and the judge. The GitHub Actions workflow (`.github/workflows/evals.yml`) skips cleanly when `CF_ACCOUNT_ID` and `CF_AI_API_TOKEN` are not set; a maintainer must add those secrets — they are not stored in this repository. `evals/benchmark_models.py` compares alternative Workers AI models on the same goldens; `evals/rejected_to_goldens.py` turns reviewer-rejected outputs into new goldens.

Contract retrieval is **hybrid**: Postgres full-text (`ts_rank`, BM25-ish) plus pgvector, with an optional `@cf/baai/bge-reranker-base` rerank (this model is included in the shared Workers AI free neuron allocation). Seed chunks are clause-sized (~400–600 characters).

## Cloudflare Code Mode

Worker Loaders / Dynamic Workers (the sandbox used for Cloudflare Code Mode) are **not available on the Workers Free plan** — they require Workers Paid, and a free-account deploy with a `worker_loaders` binding is rejected. The investigator therefore keeps using deterministic SQL graph tools attached to its input, and Ask-your-data keeps using validated SELECT-only SQL under `ra_readonly`. Code Mode is skipped until the account is on a paid plan.
