"""DeepEval custom model: Workers AI via the OpenAI-compatible endpoint."""

from __future__ import annotations

import os
from typing import Any

import httpx

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
TOKEN = os.environ.get("CF_AI_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN", "")
DEFAULT_MODEL = os.environ.get(
    "CF_EVAL_MODEL", "@cf/meta/llama-4-scout-17b-16e-instruct"
)
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/v1"


def workers_ai_complete(prompt: str, model: str = DEFAULT_MODEL, temperature: float = 0.0) -> str:
    if not ACCOUNT or not TOKEN:
        raise RuntimeError("CF_ACCOUNT_ID and CF_AI_API_TOKEN are required")
    r = httpx.post(
        f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={
            "model": model,
            "temperature": temperature,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=90.0,
    )
    r.raise_for_status()
    data = r.json()
    # OpenAI-compatible or Workers wrapper
    choices = data.get("choices") or data.get("result", {}).get("choices") or []
    if choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content") or choices[0].get("text") or ""
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )
        return str(content).strip()
    return str(data.get("result") or data.get("response") or "").strip()


try:
    from deepeval.models import DeepEvalBaseLLM
except ImportError:  # pragma: no cover
    DeepEvalBaseLLM = object  # type: ignore


class WorkersAIModel(DeepEvalBaseLLM):  # type: ignore[misc]
    def __init__(self, model: str = DEFAULT_MODEL):
        self.model = model

    def load_model(self) -> Any:
        return self

    def generate(self, prompt: str, schema: Any | None = None) -> Any:  # noqa: ANN401
        return workers_ai_complete(prompt, self.model)

    async def a_generate(self, prompt: str, schema: Any | None = None) -> Any:  # noqa: ANN401
        return self.generate(prompt, schema)

    def get_model_name(self) -> str:
        return self.model
