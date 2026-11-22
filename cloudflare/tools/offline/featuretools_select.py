#!/usr/bin/env python3
"""Optional Deep Feature Synthesis explorer. The live feature store is SQL (refresh_ra_features)."""
from pathlib import Path

CHOSEN = [
    "merchant_txn_1d/7d, merchant_amt_1d/7d — velocity windows",
    "merchant_approval_7d, merchant_decline_7d, merch_amt_z — merchant baselines",
    "mcc_approval, mcc_spend_ratio — MCC spend ratios",
    "is_retry, retry_n_30m — decline/retry patterns",
    "fee_ratio_dev, fx_markup_dev — fee and FX markup deviations",
    "acquirer_approval, scheme_approval, method_approval — issuer/route baselines",
    "merchant_cb_rate, graph_risk, shared_device_n, ring_flag, loop_flag — graph + CB history",
]

def main():
    print("Live feature store is cloudflare/postgres/011_model_intelligence.sql (refresh_ra_features).")
    print("Chosen features (exported into the LightGBM / IF models):")
    for line in CHOSEN:
        print(" -", line)
    try:
        import featuretools as ft  # noqa: F401
        print("featuretools is installed. A full DFS run is optional and not required for v9;")
        print("the SQL features above already cover velocity, MCC, baseline, retry, fee and FX.")
    except ImportError:
        print("featuretools is not installed (optional). SQL feature definitions are the source of truth.")
    (Path(__file__).resolve().parent / "chosen_features.txt").write_text("\n".join(CHOSEN) + "\n")

if __name__ == "__main__":
    main()
