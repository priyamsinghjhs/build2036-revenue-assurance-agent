#!/usr/bin/env bash
# Download the official Patronus Lynx 8B Q4_K_M GGUF and a prebuilt llama.cpp
# CPU binary. Free, local, no paid API. Writes outside the git repo.
#
# Weights: https://huggingface.co/PatronusAI/Llama-3-Patronus-Lynx-8B-Instruct-Q4_K_M-GGUF
# License: CC-BY-NC-4.0 + Llama 3 Community License (non-commercial is the tighter term).
set -euo pipefail

MODEL_DIR="${LYNX_MODEL_DIR:-/workspace/models/lynx}"
BIN_DIR="${LYNX_BIN_DIR:-/workspace/tools-bin/llama.cpp}"
MODEL_URL="${LYNX_MODEL_URL:-https://huggingface.co/PatronusAI/Llama-3-Patronus-Lynx-8B-Instruct-Q4_K_M-GGUF/resolve/main/patronus-lynx-8b-instruct-q4_k_m.gguf}"
LLAMA_URL="${LYNX_LLAMA_URL:-https://github.com/ggml-org/llama.cpp/releases/download/b12716/llama-b12716-bin-ubuntu-x64.tar.gz}"
FALLBACK_URL="${LYNX_FALLBACK_URL:-https://huggingface.co/QuantFactory/Llama-3-Patronus-Lynx-8B-Instruct-GGUF/resolve/main/Llama-3-Patronus-Lynx-8B-Instruct.Q3_K_M.gguf}"

mkdir -p "$MODEL_DIR" "$BIN_DIR"
if [[ ! -x "$BIN_DIR/llama-b12716/llama-server" ]]; then
  echo "Downloading llama.cpp CPU build b12716…"
  tmp="$(mktemp)"
  curl -L --retry 5 --retry-delay 3 -o "$tmp" "$LLAMA_URL"
  tar -xzf "$tmp" -C "$BIN_DIR"
  rm -f "$tmp"
fi

MODEL="$MODEL_DIR/patronus-lynx-8b-instruct-q4_k_m.gguf"
if [[ ! -s "$MODEL" ]]; then
  echo "Downloading official Lynx 8B Q4_K_M GGUF (about 4.9 GB)…"
  curl -L --retry 5 --retry-delay 3 -C - -o "$MODEL" "$MODEL_URL"
fi

if [[ "${LYNX_ALSO_Q3:-0}" == "1" ]]; then
  Q3="$MODEL_DIR/Llama-3-Patronus-Lynx-8B-Instruct.Q3_K_M.gguf"
  if [[ ! -s "$Q3" ]]; then
    echo "Downloading QuantFactory Q3_K_M fallback (smaller, if Q4 cannot fit in RAM)…"
    curl -L --retry 5 --retry-delay 3 -C - -o "$Q3" "$FALLBACK_URL"
  fi
  echo "Fallback GGUF: $Q3"
fi

echo "Model: $MODEL"
echo "Server: $BIN_DIR/llama-b12716/llama-server"
ls -lh "$MODEL" "$BIN_DIR/llama-b12716/llama-server"
