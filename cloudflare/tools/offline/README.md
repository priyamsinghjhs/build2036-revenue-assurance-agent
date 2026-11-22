# Offline model training (v9)

These scripts run on a laptop or in the agent box, **not** in the Cloudflare Worker
and **not** on a schedule in Neon. They stay inside the free plan: local CPU,
synthetic October 2026 book, no paid APIs.

```bash
# from cloudflare/
python3 -m venv /tmp/ra-ml-venv
 /tmp/ra-ml-venv/bin/pip install -r tools/offline/requirements.txt
# Direct Postgres (5432) is often blocked; export via the Neon HTTP driver, train, then import:
node tools/offline/export_features.mjs /tmp/ra-ml-data
RA_ML_DATA=/tmp/ra-ml-data RA_ML_OUT=/tmp/ra-ml-data/out \
  /tmp/ra-ml-venv/bin/python tools/offline/train_models.py
node tools/offline/import_scores.mjs /tmp/ra-ml-data/out/neon_writeback.json
# URLs are read from /workspace/secrets/neon_database_url and are never printed.
```

| Script | What it does | Live vs offline |
| --- | --- | --- |
| `featuretools_select.py` | Optional Deep Feature Synthesis / feature selection; prints the SQL feature list actually used | offline |
| `train_models.py` | LightGBM (false-decline, chargeback, dispute-win), IsolationForest, a tiny autoencoder, GraphSAGE-lite; writes JSON trees + scores back to Neon | offline train, live scores |
| Feature store `refresh_ra_features()` | Velocity, MCC ratios, merchant baselines, decline/retry, fee and FX deviations | **live** (called from `refresh_ra_summaries`) |
| TypeScript tree evaluator | Scores one row and path-attribution SHAP in the Worker | **live** |
| Isolation forest flags | Synced into `ra_anomaly_events` without re-opening closed rows | **live** (from stored scores) |
| GraphSAGE-lite | Optional enrichment of `ra_graph_enrichment.sage_score` | **offline only** |
| Retry Thompson sim | Fee-aware arms on soft declines | **live** SQL replay |

Metrics are computed on a held-out slice of this **synthetic** book. Treat AUC as
illustrative, not a production validation.
