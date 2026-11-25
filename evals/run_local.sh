#!/usr/bin/env bash
# Local, free DeepEval run against Workers AI.
# Reads credentials from the environment only — this file contains no secrets.
#
# Required (unless EVAL_LYNX=1, in which case Workers AI tokens are optional):
#   CF_ACCOUNT_ID
#   CF_AI_API_TOKEN   (token with Workers AI permission; preferred)
#     or CLOUDFLARE_API_TOKEN as a fallback (the wrangler User API Token may
#     lack Workers AI permission and will return HTTP 401).
#
# Optional:
#   EVAL_RESULTS_DIR, CF_EVAL_MODEL, CF_EVAL_MAX_TOKENS, CF_EVAL_NEURON_BUDGET
#   DEEPEVAL_VENV     (default /workspace/deepeval-venv)
#   EVAL_LYNX=1       also run the local Patronus Lynx 8B judge (llama.cpp, ₹0)
#                     When EVAL_LYNX=1, Workers AI tokens are optional: the script
#                     can score goldens + planted probes with Lynx only.
#
# Does not call OpenAI or Confident AI. Does not print tokens.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${DEEPEVAL_VENV:-/workspace/deepeval-venv}"
# Date folder in Asia/Calcutta
DAY="$(TZ=Asia/Calcutta date +%Y-%m-%d_%H%M)"
OUT="${EVAL_RESULTS_DIR:-/workspace/evals-results/${DAY}}"

export DEEPEVAL_TELEMETRY_OPT_OUT="${DEEPEVAL_TELEMETRY_OPT_OUT:-YES}"
export DEEPEVAL_TELEMETRY_ENABLED="${DEEPEVAL_TELEMETRY_ENABLED:-0}"
export CONFIDENT_OPEN_BROWSER="${CONFIDENT_OPEN_BROWSER:-0}"
export CONFIDENT_TRACE_FLUSH="${CONFIDENT_TRACE_FLUSH:-NO}"
export CF_EVAL_MAX_TOKENS="${CF_EVAL_MAX_TOKENS:-256}"
export CF_EVAL_NEURON_BUDGET="${CF_EVAL_NEURON_BUDGET:-4000}"
export CF_EVAL_MODEL="${CF_EVAL_MODEL:-@cf/meta/llama-4-scout-17b-16e-instruct}"
export EVAL_RESULTS_DIR="$OUT"
# Keep DeepEval from trying to open a browser or write a home telemetry file if possible
export PYTHONUNBUFFERED=1

LYNX_ON=0
if [[ "${EVAL_LYNX:-0}" == "1" || "${EVAL_LYNX:-}" == "true" || "${EVAL_LYNX:-}" == "yes" ]]; then
  LYNX_ON=1
  export EVAL_LYNX=1
fi

HAVE_CF=1
if [[ -z "${CF_ACCOUNT_ID:-}" || ( -z "${CF_AI_API_TOKEN:-}" && -z "${CLOUDFLARE_API_TOKEN:-}" ) ]]; then
  HAVE_CF=0
fi

if [[ "$HAVE_CF" -eq 0 && "$LYNX_ON" -eq 0 ]]; then
  if [[ -z "${CF_ACCOUNT_ID:-}" ]]; then
    echo "CF_ACCOUNT_ID is not set. Get the account id with: npx wrangler whoami" >&2
  fi
  if [[ -z "${CF_AI_API_TOKEN:-}" && -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "Set CF_AI_API_TOKEN (Workers AI permission) or CLOUDFLARE_API_TOKEN." >&2
  fi
  echo "Or set EVAL_LYNX=1 to run the free local Lynx judge only (no Workers AI required)." >&2
  exit 1
fi
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Python venv not found at $VENV. Create it with:" >&2
  echo "  python3 -m venv $VENV && $VENV/bin/pip install -r $ROOT/evals/requirements.txt" >&2
  exit 1
fi

mkdir -p "$OUT"
echo "Results will be written to $OUT"
cd "$ROOT/evals"
if [[ "$HAVE_CF" -eq 1 ]]; then
  echo "Running DeepEval suite (Workers AI model + judges${LYNX_ON:+, plus LynxFaithfulness})."
  "$VENV/bin/python" deepeval_suite.py
elif [[ "$LYNX_ON" -eq 1 ]]; then
  echo "Running local Lynx judge only (goldens expected_output + planted probes + refusals)."
  "$VENV/bin/python" lynx_eval.py
fi

# Cheap, no-LLM conversion demo: write into the results folder, not repo goldens.
SAMPLE="$OUT/sample_rejected.json"
cat > "$SAMPLE" << 'JSON'
[
  {
    "agent": "investigator",
    "name": "local-demo-rejected",
    "context": "Exception CAP00216 leakage 18450.00 merchant MER004",
    "input": "What leakage amount should be recovered?",
    "rejected_output": "Recover 50000 from merchant MER999.",
    "expected_output": "Recover 18450.00 from merchant MER004.",
    "comment": "Demo row for rejected_to_goldens; amounts must come from the context."
  }
]
JSON
"$VENV/bin/python" rejected_to_goldens.py "$SAMPLE" --output-dir "$OUT/goldens_from_rejected"
echo "rejected_to_goldens wrote $OUT/goldens_from_rejected (demo only; repo goldens were not changed)"
echo "Done. Results: $OUT"
