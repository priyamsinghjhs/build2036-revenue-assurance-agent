#!/usr/bin/env bash
# Local / CI entry point for the revenue-assurance regression suite.
# Reads REGRESSION_DATABASE_URL from the environment or from
# REGRESSION_DATABASE_URL_FILE (default /workspace/secrets/neon_regression_url).
# Never prints the connection string or API tokens.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DAY="$(TZ=Asia/Calcutta date +%Y-%m-%d_%H%M)"
export RESULTS_DIR="${RESULTS_DIR:-/workspace/verify/regression-${DAY}}"
export BASE_URL="${BASE_URL:-https://build2036-revenue-assurance-agent.kalyanachakram.workers.dev}"
export REGRESSION_DATABASE_URL_FILE="${REGRESSION_DATABASE_URL_FILE:-/workspace/secrets/neon_regression_url}"
if [[ -z "${REGRESSION_DATABASE_URL:-}" && ! -s "$REGRESSION_DATABASE_URL_FILE" ]]; then
  echo "Set REGRESSION_DATABASE_URL or point REGRESSION_DATABASE_URL_FILE at a Neon test-branch URL." >&2
  exit 1
fi
mkdir -p "$RESULTS_DIR"
echo "Running regression. Live app: $BASE_URL. Results: $RESULTS_DIR"
cd "$ROOT"
stdbuf -oL node tests/regression/run_regression.mjs
echo "Done. Scorecard: $RESULTS_DIR/SCORECARD.md"
