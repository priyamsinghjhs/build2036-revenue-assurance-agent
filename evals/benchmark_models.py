#!/usr/bin/env python3
"""Benchmark alternative Workers AI models on the same DeepEval goldens.

Usage:
  CF_ACCOUNT_ID=... CF_AI_API_TOKEN=... python evals/benchmark_models.py

Does not print secrets. Writes evals/benchmark_results.json.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Candidate instruct models commonly on Workers AI. The script skips a model
# that the account cannot run.
CANDIDATES = [
    "@cf/meta/llama-4-scout-17b-16e-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/qwen/qwen2.5-coder-32b-instruct",
    "@cf/google/gemma-3-12b-it",
]

ROOT = Path(__file__).resolve().parent


def main() -> int:
    if not (os.environ.get("CF_ACCOUNT_ID") and (os.environ.get("CF_AI_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN"))):
        print("Skipping benchmark — CF_ACCOUNT_ID / CF_AI_API_TOKEN are not set.")
        return 0
    from cf_model import workers_ai_complete

    goldens = []
    for path in sorted((ROOT / "goldens").glob("*.json")):
        for row in json.loads(path.read_text()):
            goldens.append((path.stem, row))

    results = []
    for model in CANDIDATES:
        print(f"MODEL {model}")
        for agent, row in goldens:
            try:
                out = workers_ai_complete(
                    f"You are the {agent} agent. Answer only from the context. "
                    f"If a fact is missing, say 'insufficient data'.\n\nCONTEXT:\n{row['context']}\n\nQUESTION:\n{row['input']}\n",
                    model=model,
                )
                results.append({"model": model, "agent": agent, "name": row["name"], "ok": True, "output": out[:500]})
            except Exception as exc:  # noqa: BLE001
                results.append({"model": model, "agent": agent, "name": row["name"], "ok": False, "error": str(exc)[:300]})
                print(f"  skip/error {agent}/{row['name']}: {type(exc).__name__}")
                break
    out = ROOT / "benchmark_results.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"Wrote {out} ({len(results)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
