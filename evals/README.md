# Offline / CI agent evaluations (DeepEval)

Runtime quality checks in the live Worker are **deterministic grounding tests** (no extra LLM judge, so they stay within the Workers AI free neuron budget). This folder is the optional offline and CI complement, using [DeepEval](https://github.com/confident-ai/deepeval) with Workers AI as both the model-under-test and the judge.

## Required secrets

The suite calls the Workers AI OpenAI-compatible endpoint and therefore needs:

- `CF_ACCOUNT_ID` — Cloudflare account ID
- `CF_AI_API_TOKEN` — API token with Workers AI permission

These must be added by a human as GitHub Actions secrets (or in your local environment). **Do not commit tokens.** The workflow skips cleanly when the secrets are absent.


## Local free run (recommended)

Run the suite on a machine that already has a Workers AI token. This does **not** use GitHub Actions, OpenAI, or Confident AI, and it stays on the Workers Free neuron allocation (10,000/day).

```bash
python3 -m venv /workspace/deepeval-venv
/workspace/deepeval-venv/bin/pip install -r evals/requirements.txt
export CF_ACCOUNT_ID=...          # npx wrangler whoami
export CF_AI_API_TOKEN=...        # API token with Workers AI permission
# Optional: CF_EVAL_MAX_TOKENS=256 CF_EVAL_NEURON_BUDGET=4000
# Optional: EVAL_LYNX=1  (local Patronus Lynx 8B judge, ₹0)
evals/run_local.sh
```

Results are written to `/workspace/evals-results/<date>/` as `results.json` and `RESULTS.md`. The script also runs `rejected_to_goldens.py` into that folder only (it does not change `evals/goldens/`).

Telemetry is disabled (`DEEPEVAL_TELEMETRY_OPT_OUT=YES`). The judge and the model-under-test are both Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct` by default) through `cf_model.py`. `max_tokens` defaults to 256 and the run stops if estimated neurons would exceed `CF_EVAL_NEURON_BUDGET` (default 4,000), leaving headroom under the 10,000/day cap for the live app.

**Token note:** a Wrangler `CLOUDFLARE_API_TOKEN` (used to deploy) may not have Workers AI permission and will return HTTP 401 on `ai/v1/chat/completions`. Use a token that includes Workers AI (`CF_AI_API_TOKEN`). Do not commit tokens.

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
- RefusalAlignment — a correct `insufficient data` answer on a missing-context golden is a pass (and the LLM judge is skipped)
- GroundedNumbers — every number and ID in the answer must appear in (or be derivable from) the context
- LynxFaithfulness — optional (`EVAL_LYNX=1`): local Patronus Lynx 8B PASS/FAIL faithfulness judge
- AuditorSchema and SuggestionPresence — auditor goldens must be valid structured JSON with checks and at least one suggestion

Hallucination is not re-judged by the LLM when GroundedNumbers is a perfect match, which keeps the judge cheaper and less brittle.


## Local Lynx judge (optional, free)

[Patronus Lynx](https://github.com/patronus-ai/Lynx-hallucination-detection) (`Llama-3-Patronus-Lynx-8B-Instruct`) is a hallucination detector. Cloudflare Workers AI does not host it. This suite runs the official Q4_K_M GGUF on the box CPU through [llama.cpp](https://github.com/ggml-org/llama.cpp) (`EVAL_LYNX=1`). There is no paid inference and no extra Workers AI neurons for the judge (₹0).

```bash
# One-time: official GGUF (~4.9 GB) + llama.cpp CPU binary, written outside the repo
evals/download_lynx.sh
# Score goldens (expected answers), planted probes, and correct-refusal cases
EVAL_LYNX=1 evals/run_local.sh
```

`LynxFaithfulness` (`evals/lynx_metric.py`) is a DeepEval `BaseMetric`. It sends the official Lynx prompt (QUESTION / DOCUMENT / ANSWER) and parses JSON `{REASONING, SCORE: PASS|FAIL}`. `evals/lynx_probes.json` holds planted unfaithful answers (wrong ₹ amount, wrong ID, fabricated 12 vs 14 bps clause, wrong fee cap). Results are written next to the usual DeepEval files as `lynx_results.json` and `LYNX_RESULTS.md`.

If the GGUF or llama-server is missing, the suite prints a warning and keeps the Workers AI judge as the fallback. It does not pretend Workers AI is Lynx. GroundedNumbers still runs alongside Lynx; they can disagree when a clause is wrong but every numeral still appears in the document.

On a CPU-only 16 GiB box the 8B Q4_K_M weights are tight (no swap). If llama-server cannot start, set `LYNX_FALLBACK_GGUF` to the QuantFactory Q3_K_M file (`LYNX_ALSO_Q3=1 evals/download_lynx.sh`). The 70B Lynx model will not run here.

**License:** the Lynx weights are [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc-4.0/) plus the [Llama 3 Community License](https://www.llama.com/llama3/license/) on the base model. Non-commercial use is the tighter constraint. Use this judge for local evaluation; do not ship the weights in a commercial product without a license that allows it.

Environment: `LYNX_MODEL_PATH`, `LYNX_LLAMA_SERVER`, `LYNX_SERVER_PORT` (default 8088), `LYNX_CTX` (default 2048), `LYNX_MAX_TOKENS` (default 320), `LYNX_THREADS` (default 8).

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
