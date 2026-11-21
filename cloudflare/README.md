# Revenue Assurance (Cloudflare + Neon)

Public Workers Free app with a React frontend and a Hono Worker. Runtime data is **Neon Postgres** (free tier) over `@neondatabase/serverless`. Dashboards read pre-aggregated summary tables and are cached for 120s. A daily Cron Trigger (02:15 UTC / 07:45 Asia/Calcutta) drafts the leadership brief, investigates the top exception within the Workers AI neuron budget, and seeds the Action Queue.

The landing page is an **Executive summary** for leadership (KPIs, waterfall, trend, top drivers, heatmap, recovery funnel, printable brief). Domain pages share one template. Palette: navy / slate, one blue accent, semantic red/amber/green for status only. Inter, 8px spacing, shadcn/Radix components.

See `postgres/README.md` for apply steps. Do not bind D1. Hyperdrive is not used.

# Cloudflare-native Revenue Assurance

Graphical payment-acquiring revenue assurance app on the **Workers Free** plan.

- **Frontend:** React + TypeScript + Vite + Tailwind CSS, Recharts, React Flow, lucide-react
- **Worker:** TypeScript (Hono) + D1 + Workers AI binding `env.AI`
- **URL:** `https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev`

SQL does the matching math. Agents only interpret compact summaries, prioritize gaps, and recommend actions. Dashboard pages never call the LLM. Agent JSON is cached in D1 (`ra_agent_runs`, `ra_agent_outputs`, `ra_action_queue`).

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
| `/agents` | Agent roster, React Flow handoff graph, visual outputs, action queue |
| `/investigate/:id` | On-demand investigator → action → auditor for one exception |

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
