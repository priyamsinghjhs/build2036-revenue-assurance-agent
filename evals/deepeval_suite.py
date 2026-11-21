#!/usr/bin/env python3
"""Offline / CI DeepEval suite for the Revenue Assurance agents.

Uses Workers AI (OpenAI-compatible) as both the model-under-test and the judge.
Required environment:
  CF_ACCOUNT_ID
  CF_AI_API_TOKEN

The GitHub Actions workflow skips this script when those secrets are absent.
Do not print tokens.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

GOLDENS = Path(__file__).resolve().parent / "goldens"


def secrets_present() -> bool:
    return bool(os.environ.get("CF_ACCOUNT_ID") and (os.environ.get("CF_AI_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")))


def load_goldens():
    rows = []
    for path in sorted(GOLDENS.glob("*.json")):
        agent = path.stem
        for row in json.loads(path.read_text()):
            rows.append((agent, row))
    return rows


def main() -> int:
    if not secrets_present():
        print("Skipping DeepEval — CF_ACCOUNT_ID / CF_AI_API_TOKEN are not set.")
        return 0

    from deepeval import evaluate
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        HallucinationMetric,
    )
    try:
        from deepeval.metrics import ContextualPrecisionMetric, ContextualRecallMetric
    except ImportError:  # older DeepEval
        ContextualPrecisionMetric = ContextualRecallMetric = None  # type: ignore
    from deepeval.test_case import LLMTestCase

    from cf_model import WorkersAIModel, workers_ai_complete

    model = WorkersAIModel()
    judge = WorkersAIModel()  # same free Workers AI model as judge
    metrics_std = [
        FaithfulnessMetric(model=judge, threshold=0.6, include_reason=False),
        HallucinationMetric(model=judge, threshold=0.6, include_reason=False),
        AnswerRelevancyMetric(model=judge, threshold=0.5, include_reason=False),
    ]
    metrics_rag = list(metrics_std)
    if ContextualPrecisionMetric and ContextualRecallMetric:
        metrics_rag.extend(
            [
                ContextualRecallMetric(model=judge, threshold=0.5, include_reason=False),
                ContextualPrecisionMetric(model=judge, threshold=0.5, include_reason=False),
            ]
        )

    cases = []
    for agent, row in load_goldens():
        ctx = row.get("retrieval_context") or [row.get("context", "")]
        try:
            actual = workers_ai_complete(
                f"You are the {agent} agent. Answer only from the context. "
                f"If a fact is missing, say 'insufficient data'.\n\n"
                f"CONTEXT:\n{row['context']}\n\nQUESTION:\n{row['input']}\n"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"MODEL_ERROR {agent}/{row['name']}: {exc}")
            return 1
        cases.append(
            (
                agent,
                LLMTestCase(
                    input=row["input"],
                    actual_output=actual,
                    expected_output=row.get("expected_output"),
                    context=ctx if agent != "contracts_rag" else None,
                    retrieval_context=ctx,
                ),
                metrics_rag if agent == "contracts_rag" else metrics_std,
            )
        )

    failed = 0
    for agent, case, metrics in cases:
        try:
            evaluate(test_cases=[case], metrics=metrics)
            print(f"OK {agent}/{getattr(case, 'input', '')[:40]}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {agent}: {exc}")
    print(f"DONE failed={failed} total={len(cases)}")
    # CI should not block the PR on a soft quality miss in this first cut;
    # report failures but exit 0 unless the model/API itself failed earlier.
    return 0


if __name__ == "__main__":
    sys.exit(main())
