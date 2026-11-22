"""DeepEval custom model: Workers AI via the OpenAI-compatible endpoint.

Tracks token and neuron usage from the API so a local run can stay under the
Workers Free 10,000 neuron/day cap. Does not print tokens.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
TOKEN = os.environ.get("CF_AI_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN", "")
DEFAULT_MODEL = os.environ.get(
    "CF_EVAL_MODEL", "@cf/meta/llama-4-scout-17b-16e-instruct"
)
MAX_TOKENS = int(os.environ.get("CF_EVAL_MAX_TOKENS", "256"))
NEURON_BUDGET = float(os.environ.get("CF_EVAL_NEURON_BUDGET", "4000"))
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/v1"


class NeuronBudgetExceeded(RuntimeError):
    """Raised when the local eval would exceed the configured neuron budget."""


class UsageTracker:
    def __init__(self) -> None:
        self.calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.neurons = 0.0
        self.errors = 0

    def add(self, usage: dict[str, Any] | None) -> None:
        self.calls += 1
        if not usage:
            return
        self.prompt_tokens += int(usage.get("prompt_tokens") or 0)
        self.completion_tokens += int(usage.get("completion_tokens") or 0)
        if usage.get("neurons") is not None:
            self.neurons += float(usage["neurons"])

    def as_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
            "neurons": round(self.neurons, 3),
            "neuron_budget": NEURON_BUDGET,
            "errors": self.errors,
            "model": DEFAULT_MODEL,
            "max_tokens": MAX_TOKENS,
        }


USAGE = UsageTracker()


def _extract_content(data: dict[str, Any]) -> str:
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


def workers_ai_complete(
    prompt: str,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> str:
    if not ACCOUNT or not TOKEN:
        raise RuntimeError("CF_ACCOUNT_ID and CF_AI_API_TOKEN (or CLOUDFLARE_API_TOKEN) are required")
    if USAGE.neurons >= NEURON_BUDGET:
        raise NeuronBudgetExceeded(
            f"Neuron budget reached ({USAGE.neurons:.1f} >= {NEURON_BUDGET}). Stopping to protect the free 10k/day cap."
        )
    r = httpx.post(
        f"{BASE}/chat/completions",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens or MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=90.0,
    )
    if r.status_code >= 400:
        USAGE.errors += 1
        # Do not include request headers or tokens in the message.
        try:
            body = r.json()
            errs = body.get("errors") or []
            msg = errs[0].get("message", r.text[:200]) if errs else r.text[:200]
        except Exception:
            msg = r.text[:200]
        raise RuntimeError(f"Workers AI HTTP {r.status_code}: {msg}")
    data = r.json()
    usage = data.get("usage") or (data.get("result") or {}).get("usage") or {}
    USAGE.add(usage)
    return _extract_content(data)


def _parse_json_payload(text: str) -> Any:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    else:
        a, b = cleaned.find("["), cleaned.rfind("]")
        if a != -1 and b != -1 and b > a:
            cleaned = cleaned[a : b + 1]
    return json.loads(cleaned)


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
        if schema is None:
            return workers_ai_complete(prompt, self.model), 0.0
        schema_json = ""
        try:
            schema_json = json.dumps(schema.model_json_schema(), indent=2)
        except Exception:
            schema_json = str(schema)
        guided = (
            f"{prompt}\n\n"
            "Return ONLY valid JSON that matches this schema. No markdown, no commentary.\n"
            f"{schema_json}\n"
        )
        text = workers_ai_complete(guided, self.model)
        try:
            parsed = schema.model_validate(_parse_json_payload(text))
        except Exception:
            retry = workers_ai_complete(
                "Your previous reply was not valid JSON. "
                "Return ONLY a JSON object matching this schema, nothing else.\n"
                f"{schema_json}\n\nPrevious reply:\n{text[:800]}\n",
                self.model,
            )
            parsed = schema.model_validate(_parse_json_payload(retry))
        return parsed, 0.0

    async def a_generate(self, prompt: str, schema: Any | None = None) -> Any:  # noqa: ANN401
        return self.generate(prompt, schema)

    def generate_with_schema(self, prompt: str, schema: Any | None = None, **kwargs: Any) -> Any:  # noqa: ANN401
        # DeepEval 4.x treats custom models as non-native and, on the sync path,
        # does not unpack a (result, cost) tuple before trimAndLoadJson. Return
        # the schema instance (or raw text) only.
        result, _cost = self.generate(prompt, schema=schema)
        return result

    async def a_generate_with_schema(self, prompt: str, schema: Any | None = None, **kwargs: Any) -> Any:  # noqa: ANN401
        return self.generate_with_schema(prompt, schema=schema)

    def get_model_name(self) -> str:
        return self.model
