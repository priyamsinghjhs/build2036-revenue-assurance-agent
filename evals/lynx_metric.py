#!/usr/bin/env python3
"""LynxFaithfulness: DeepEval BaseMetric that judges faithfulness with Patronus Lynx.

Runs the official Llama-3-Patronus-Lynx-8B-Instruct prompt against a local
llama.cpp server (CPU, quantized GGUF). No paid inference. Cost is always 0.

The prompt template is the one published on the Patronus Lynx model card
(QUESTION / DOCUMENT / ANSWER -> JSON {REASONING, SCORE: PASS|FAIL}).

Environment (all optional):
  LYNX_MODEL_PATH     default /workspace/models/lynx/patronus-lynx-8b-instruct-q4_k_m.gguf
  LYNX_LLAMA_SERVER   default /workspace/tools-bin/llama.cpp/llama-b12716/llama-server
  LYNX_SERVER_HOST    default 127.0.0.1
  LYNX_SERVER_PORT    default 8088
  LYNX_SERVER_URL     default http://{host}:{port}
  LYNX_CTX            default 2048
  LYNX_MAX_TOKENS     default 320
  LYNX_THREADS        default 8
  LYNX_TEMPERATURE    default 0
  LYNX_FALLBACK_GGUF  optional smaller quant if the official Q4 cannot be loaded

Licenses of the weights (not this file): CC-BY-NC-4.0 + Llama 3 Community License.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

from deepeval.metrics.base_metric import BaseMetric
from deepeval.test_case import LLMTestCase

# Official Patronus Lynx user-message template (model card / README). Do not edit.
LYNX_PROMPT_TEMPLATE = """Given the following QUESTION, DOCUMENT and ANSWER you must analyze the provided answer and determine whether it is faithful to the contents of the DOCUMENT. The ANSWER must not offer new information beyond the context provided in the DOCUMENT. The ANSWER also must not contradict information provided in the DOCUMENT. Output your final verdict by strictly following this format: "PASS" if the answer is faithful to the DOCUMENT and "FAIL" if the answer is not faithful to the DOCUMENT. Show your reasoning.

--
QUESTION (THIS DOES NOT COUNT AS BACKGROUND INFORMATION):
{question}

--
DOCUMENT:
{context}

--
ANSWER:
{answer}

--

Your output should be in JSON FORMAT with the keys "REASONING" and "SCORE":
{{"REASONING": <your reasoning as bullet points>, "SCORE": <your final score>}}
"""

DEFAULT_MODEL = "/workspace/models/lynx/patronus-lynx-8b-instruct-q4_k_m.gguf"
DEFAULT_SERVER = "/workspace/tools-bin/llama.cpp/llama-b12716/llama-server"
PID_PATH = Path("/tmp/lynx-llama-server.pid")
LOG_PATH = Path("/tmp/lynx-llama-server.log")


def lynx_enabled() -> bool:
    return os.environ.get("EVAL_LYNX", "0").strip() in {"1", "true", "TRUE", "yes", "YES"}


def model_path() -> Path:
    fallback = os.environ.get("LYNX_FALLBACK_GGUF", "").strip()
    primary = Path(os.environ.get("LYNX_MODEL_PATH", DEFAULT_MODEL))
    if primary.is_file() and primary.stat().st_size > 1_000_000:
        return primary
    if fallback:
        alt = Path(fallback)
        if alt.is_file() and alt.stat().st_size > 1_000_000:
            return alt
    return primary


def server_bin() -> Path:
    return Path(os.environ.get("LYNX_LLAMA_SERVER", DEFAULT_SERVER))


def server_host() -> str:
    return os.environ.get("LYNX_SERVER_HOST", "127.0.0.1")


def server_port() -> int:
    return int(os.environ.get("LYNX_SERVER_PORT", "8088"))


def server_url() -> str:
    return os.environ.get("LYNX_SERVER_URL", f"http://{server_host()}:{server_port()}").rstrip("/")


def build_lynx_prompt(question: str, document: str, answer: str) -> str:
    return LYNX_PROMPT_TEMPLATE.format(
        question=question or "",
        context=document or "",
        answer=answer or "",
    )


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        stripped = fence.group(1)
    decoder = json.JSONDecoder()
    start = stripped.find("{")
    while start != -1:
        try:
            obj, _ = decoder.raw_decode(stripped[start:])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
        start = stripped.find("{", start + 1)
    # Sometimes the model emits a nearly-JSON blob with trailing commas or single quotes.
    relaxed = re.search(
        r"\{[^{}]*[\"']SCORE[\"']\s*:\s*[\"']?(PASS|FAIL)[\"']?[^{}]*\}",
        stripped,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if relaxed:
        blob = relaxed.group(0).replace("'", '"')
        try:
            obj = json.loads(blob)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    return None


def parse_lynx_output(text: str) -> dict[str, Any]:
    """Parse PASS/FAIL + reasoning from a Lynx completion."""
    raw = text or ""
    obj = _extract_json_object(raw)
    score_token = None
    reasoning: Any = None
    if obj:
        for key, val in obj.items():
            if str(key).strip().upper() == "SCORE":
                score_token = val
            elif str(key).strip().upper() == "REASONING":
                reasoning = val
    if score_token is None:
        m = re.search(r"\b(PASS|FAIL)\b", raw, flags=re.IGNORECASE)
        if m:
            score_token = m.group(1)
    if isinstance(score_token, bool):
        # A model that emits true/false is not following the card; treat as unparsable.
        score_token = None
    token = str(score_token).strip().upper() if score_token is not None else ""
    if token in {"PASS", "FAIL"}:
        if isinstance(reasoning, list):
            reason_text = "\n".join(str(x) for x in reasoning)
        elif reasoning is None:
            reason_text = raw.strip()
        else:
            reason_text = str(reasoning).strip()
        return {
            "ok": True,
            "verdict": token,
            "score": 1.0 if token == "PASS" else 0.0,
            "reason": reason_text,
            "raw": raw,
            "error": None,
        }
    return {
        "ok": False,
        "verdict": None,
        "score": 0.0,
        "reason": raw.strip()[:2000],
        "raw": raw,
        "error": "parse_error: Lynx output had no PASS/FAIL SCORE",
    }


def lynx_available() -> tuple[bool, str]:
    path = model_path()
    binary = server_bin()
    if not path.is_file() or path.stat().st_size < 1_000_000:
        return False, (
            f"Lynx GGUF not found at {path}. Download the official Q4_K_M weights with "
            "evals/download_lynx.sh (free, local, no paid API)."
        )
    if not binary.is_file() or not os.access(binary, os.X_OK):
        return False, f"llama-server binary not found or not executable at {binary}."
    return True, f"model={path} server={binary}"


def _port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        try:
            return sock.connect_ex((host, port)) == 0
        except OSError:
            return False


def _http_json(url: str, payload: Optional[dict] = None, timeout: int = 30) -> tuple[int, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = body
        return resp.status, parsed


def server_healthy(url: Optional[str] = None) -> bool:
    base = url or server_url()
    for path in ("/health", "/v1/models"):
        try:
            status, _ = _http_json(base + path, timeout=3)
            if 200 <= status < 300:
                return True
        except (URLError, TimeoutError, OSError):
            continue
    return False


def ensure_lynx_server(timeout_s: int = 180) -> tuple[bool, str]:
    """Reuse a healthy local server or start llama-server. Never prints secrets."""
    ok, detail = lynx_available()
    if not ok:
        return False, detail
    if server_healthy():
        return True, f"reused {server_url()} ({detail})"
    host, port = server_host(), server_port()
    if _port_open(host, port) and not server_healthy():
        return False, f"{host}:{port} is occupied by a non-Lynx process."

    binary = server_bin()
    libdir = str(binary.parent)
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = libdir + ((":" + env["LD_LIBRARY_PATH"]) if env.get("LD_LIBRARY_PATH") else "")
    ctx = os.environ.get("LYNX_CTX", "2048")
    threads = os.environ.get("LYNX_THREADS", "8")
    cmd = [
        str(binary),
        "-m",
        str(model_path()),
        "--host",
        host,
        "--port",
        str(port),
        "-c",
        str(ctx),
        "-t",
        str(threads),
        "-ngl",
        "0",
        "--no-warmup",
        "--parallel",
        "1",
    ]
    LOG_PATH.write_text("")
    log_f = open(LOG_PATH, "ab")
    proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT, env=env)
    PID_PATH.write_text(str(proc.pid))
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = LOG_PATH.read_text(errors="replace")[-2000:]
            return False, f"llama-server exited with code {proc.returncode}. Log tail:\n{tail}"
        if server_healthy():
            return True, f"started pid={proc.pid} {server_url()} ({detail})"
        time.sleep(0.5)
    tail = LOG_PATH.read_text(errors="replace")[-2000:]
    return False, f"llama-server did not become healthy within {timeout_s}s. Log tail:\n{tail}"


# Official Llama 3 Instruct wrap (user turn only). Used because this llama.cpp
# build treated `--chat-template llama3` as a literal 4-token prompt.
LLAMA3_USER_PREFIX = "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
LLAMA3_USER_SUFFIX = "<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"


def wrap_llama3_user(prompt: str) -> str:
    return f"{LLAMA3_USER_PREFIX}{prompt}{LLAMA3_USER_SUFFIX}"


def lynx_complete(prompt: str, max_tokens: Optional[int] = None, timeout_s: int = 600) -> dict[str, Any]:
    """One Lynx completion via llama.cpp /completion with an explicit Llama 3 wrap."""
    started = time.perf_counter()
    payload = {
        "prompt": wrap_llama3_user(prompt),
        "n_predict": int(max_tokens or os.environ.get("LYNX_MAX_TOKENS", "320")),
        "temperature": float(os.environ.get("LYNX_TEMPERATURE", "0")),
        "cache_prompt": True,
        "stop": ["<|eot_id|>", "<|end_of_text|>"],
    }
    try:
        status, body = _http_json(server_url() + "/completion", payload, timeout=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return {
            "text": "",
            "error": f"lynx_http_error: {exc}",
            "elapsed_s": round(time.perf_counter() - started, 3),
            "usage": {},
        }
    if status >= 300:
        return {
            "text": "",
            "error": f"lynx_http_{status}: {body}",
            "elapsed_s": round(time.perf_counter() - started, 3),
            "usage": {},
        }
    if not isinstance(body, dict):
        return {
            "text": "",
            "error": f"lynx_bad_response: {body}",
            "elapsed_s": round(time.perf_counter() - started, 3),
            "usage": {},
        }
    text = body.get("content") or ""
    timings = body.get("timings") or {}
    usage = {
        "prompt_tokens": body.get("tokens_evaluated") or timings.get("prompt_n"),
        "completion_tokens": body.get("tokens_predicted") or timings.get("predicted_n"),
    }
    return {
        "text": text,
        "error": None,
        "elapsed_s": round(time.perf_counter() - started, 3),
        "usage": usage,
    }


class LynxFaithfulness(BaseMetric):
    """Binary faithfulness metric backed by a local Patronus Lynx 8B GGUF."""

    def __init__(self, threshold: float = 1.0, include_reason: bool = True):
        self.threshold = threshold
        self.include_reason = include_reason
        self.async_mode = False
        self.verbose_mode = False
        self.evaluation_model = "PatronusAI/Llama-3-Patronus-Lynx-8B-Instruct-Q4_K_M-GGUF"
        self.evaluation_cost = 0.0
        self.score = None
        self.success = None
        self.reason = None
        self.error = None
        self.last_verdict = None
        self.last_elapsed_s = None
        self.last_raw = None

    @property
    def __name__(self):
        return "LynxFaithfulness"

    def measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        self.evaluation_cost = 0.0
        self.error = None
        self.score = 0.0
        self.success = False
        self.last_verdict = None
        document = _document_from_case(test_case)
        prompt = build_lynx_prompt(test_case.input or "", document, test_case.actual_output or "")
        result = lynx_complete(prompt)
        self.last_elapsed_s = result["elapsed_s"]
        self.last_raw = result.get("text") or ""
        usage = result.get("usage") or {}
        self._accrue_tokens(usage.get("prompt_tokens"), usage.get("completion_tokens"))
        self._accrue_cost(0.0)
        if result.get("error"):
            self.error = str(result["error"])
            self.reason = self.error
            self.success = False
            self.score = 0.0
            return self.score
        parsed = parse_lynx_output(self.last_raw)
        self.last_verdict = parsed["verdict"]
        self.reason = parsed["reason"] if self.include_reason else None
        if not parsed["ok"]:
            self.error = parsed["error"]
            self.score = 0.0
            self.success = False
            return self.score
        self.score = float(parsed["score"])
        self.success = self.score >= self.threshold
        return self.score

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        return self.measure(test_case, *args, **kwargs)


def _document_from_case(test_case: LLMTestCase) -> str:
    parts = []
    ctx = getattr(test_case, "retrieval_context", None) or getattr(test_case, "context", None) or []
    if isinstance(ctx, str):
        parts.append(ctx)
    else:
        parts.extend(str(x) for x in ctx if x)
    return "\n".join(parts).strip()


def judge_pair(question: str, document: str, answer: str) -> dict[str, Any]:
    """Score one (question, document, answer) triple. Server must already be up."""
    prompt = build_lynx_prompt(question, document, answer)
    result = lynx_complete(prompt)
    parsed = parse_lynx_output(result.get("text") or "")
    if result.get("error"):
        parsed = {
            "ok": False,
            "verdict": None,
            "score": 0.0,
            "reason": result["error"],
            "raw": result.get("text") or "",
            "error": result["error"],
        }
    parsed["elapsed_s"] = result.get("elapsed_s")
    parsed["usage"] = result.get("usage") or {}
    parsed["cost_inr"] = 0
    parsed["cost_usd"] = 0
    return parsed
