# Offline / CI agent evaluations (DeepEval)

Runtime quality checks in the live Worker are **deterministic grounding tests** (no extra LLM judge, so they stay within the Workers AI free neuron budget). This folder is the optional offline and CI complement, using [DeepEval](https://github.com/confident-ai/deepeval) with Workers AI as both the model-under-test and the judge.

## Required secrets

The suite calls the Workers AI OpenAI-compatible endpoint and therefore needs:

- `CF_ACCOUNT_ID` — Cloudflare account ID
- `CF_AI_API_TOKEN` — API token with Workers AI permission

These must be added by a human as GitHub Actions secrets (or in your local environment). **Do not commit tokens.** The workflow skips cleanly when the secrets are absent.

## Local run

```bash
pip install -r evals/requirements.txt
export CF_ACCOUNT_ID=...
export CF_AI_API_TOKEN=...
python evals/deepeval_suite.py
```

Metrics:

- Faithfulness, Hallucination, Answer Relevancy — all goldens
- Contextual Recall and Contextual Precision — contract RAG goldens (`goldens/contracts_rag.json`)

## Benchmark other Workers AI models

```bash
python evals/benchmark_models.py
```

Writes `evals/benchmark_results.json`. Models the account cannot run are skipped.

## New goldens from reviewer rejections

Export rejected or unverified outputs (for example from the review queue) as a JSON array and run:

```bash
python evals/rejected_to_goldens.py path/to/rejected.json
```

Each row should include `agent`, `context`, `input`, and optionally `expected_output` and `comment`.

## GitHub Actions

The intended workflow lives at `.github/workflows/evals.yml` (a copy is kept in `evals/github-actions-evals.yml`). It runs on pull requests and skips cleanly when `CF_ACCOUNT_ID` and `CF_AI_API_TOKEN` are not set. Do not store those secrets in the repo; a maintainer must add them in the repository settings.

The first v7 push could not include `.github/workflows/evals.yml` because the `priyamsinghjhs` GitHub token used for the push does not have the `workflow` scope. To enable CI, copy `evals/github-actions-evals.yml` to `.github/workflows/evals.yml` and push with a token that has the `workflow` scope.
