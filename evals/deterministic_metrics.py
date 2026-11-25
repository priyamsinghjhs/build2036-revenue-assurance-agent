"""Cheap, no-LLM metrics for the local DeepEval suite.

Correct 'insufficient data' refusals pass. Numbers and IDs in the output must
appear in (or be derivable from) the context. Auditor outputs are checked for
schema validity and the presence of suggestions.
"""

from __future__ import annotations

import json
import re
from typing import Any

GENERIC_NUM = {"0", "0.0", "0.00", "0.0000", "1", "2", "3", "4", "5", "10", "100"}
STOP_IDS = {
    "INR", "USD", "EUR", "SQL", "JSON", "HIGH", "LOW", "MEDIUM", "CRITICAL",
    "WATCH", "GOOD", "POOR", "YES", "NO", "THE", "AND", "FOR", "FROM", "WITH",
    "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "TRUE", "FALSE", "NULL",
    "UPI", "CARD", "NEFT", "P2M", "P2P", "PPI", "GST", "TDS", "MDR", "SLA",
    "CFO", "RAG", "LLM", "API", "PASS", "FAIL", "AUDIT", "APPROVED",
    "REJECTED", "NEEDS_REVIEW", "SUGGESTION_ID", "OWNER_TEAM", "EXPECTED_RECOVERY",
    "CFO_ONE_LINER", "AMOUNT_RECONCILIATION", "EVIDENCE_COMPLETENESS",
    "POLICY_COMPLIANCE", "DUPLICATE_PRIOR_CASE", "SEGREGATION_OF_DUTIES",
    "GROUNDING", "REQUEST_FILE", "DISPUTE_DRAFT", "DATA_REQUEST", "ACTION_QUEUE",
    "DRAFT_DISPUTE", "DRAFT_DATA_REQUEST", "WRITE_OFF", "ADJUST_RULE",
    "DATA_REQUEST_DRAFT", "SUG-1", "SUG-2", "SUG-3", "SUG-4", "SUG-5",
}

CHECK_NAMES = {
    "amount_reconciliation",
    "evidence_completeness",
    "policy_compliance",
    "duplicate_prior_case",
    "segregation_of_duties",
    "grounding",
}

# Standalone numbers only — do not pull the digits out of IDs like CAP00216 or MER004.
_NUM_RE = re.compile(r"(?<![A-Za-z0-9])-?\d+(?:,\d{3})*(?:\.\d+)?(?![A-Za-z0-9])")
# IDs must contain a digit (CAP00216, MER004, scheme:…:CAP00216). Ignore JSON keys and English words.
_ID_RE = re.compile(r"\b([A-Za-z]{2,}\d[A-Za-z0-9]*|[A-Za-z]{2,}[-:][A-Za-z0-9:-]*\d[A-Za-z0-9:-]*)\b")


def is_refusal(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return "insufficient data" in t or t in {"insufficient data.", "insufficient data"}


def expected_is_refusal(expected: str | None) -> bool:
    """True only when the gold answer itself is a refusal, not when the phrase appears inside a larger payload."""
    if not expected:
        return False
    t = expected.strip().lower().rstrip(".")
    return t == "insufficient data"


def close_to(n: float, pool: list[float]) -> bool:
    for p in pool:
        if abs(p - n) <= 0.015:
            return True
        if p != 0 and abs(p - n) / abs(p) <= 0.002:
            return True
        if abs(p * 100 - n) <= 0.05 or abs(p * 10000 - n) <= 0.5:
            return True
        if abs(n * 100 - p) <= 0.05 or abs(n * 10000 - p) <= 0.5:
            return True
    return False


def context_pool(context: str) -> tuple[str, list[float]]:
    numbers = [float(m.replace(",", "")) for m in _NUM_RE.findall(context or "")]
    derived = list(numbers)
    cap = min(len(numbers), 24)
    for i in range(cap):
        for j in range(i + 1, cap):
            a, b = numbers[i], numbers[j]
            derived.extend([a + b, abs(a - b), a * b])
            if b != 0:
                derived.append(a / b)
            if a != 0:
                derived.append(b / a)
    return (context or "").upper(), derived


def extract_numbers_and_ids(text: str) -> tuple[list[float], list[str]]:
    nums = []
    for raw in _NUM_RE.findall(text or ""):
        if raw in GENERIC_NUM:
            continue
        try:
            n = float(raw.replace(",", ""))
        except ValueError:
            continue
        if 2020 <= n <= 2035 and raw.isdigit() and len(raw) == 4:
            continue
        nums.append(n)
    ids = []
    for m in _ID_RE.findall((text or "").upper()):
        if m in STOP_IDS or m.isdigit() and len(m) < 5:
            continue
        ids.append(m)
    return nums, ids


def number_id_score(actual: str, context: str) -> dict[str, Any]:
    if is_refusal(actual):
        # A correct refusal introduces no unsupported numbers/IDs.
        return {"score": 1.0, "claims": 0, "supported": 0, "unsupported": []}
    ctx, pool = context_pool(context)
    nums, ids = extract_numbers_and_ids(actual)
    unsupported = []
    supported = 0
    claims = 0
    for n in nums:
        claims += 1
        if close_to(n, pool):
            supported += 1
        else:
            unsupported.append(f"number:{n}")
    for i in ids:
        claims += 1
        if i in ctx:
            supported += 1
        else:
            unsupported.append(f"id:{i}")
    score = 1.0 if claims == 0 else supported / claims
    return {"score": round(score, 4), "claims": claims, "supported": supported, "unsupported": unsupported}


def parse_json_maybe(text: str) -> dict[str, Any] | None:
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(s[start : end + 1])
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def auditor_schema_score(actual: str) -> dict[str, Any]:
    obj = parse_json_maybe(actual)
    if not obj:
        # Some model answers are prose plus implicit structure; fail schema.
        return {"score": 0.0, "ok": False, "reason": "not JSON"}
    verdict = str(obj.get("verdict") or obj.get("signoff") or "").lower().replace(" ", "_")
    if verdict in {"ready", "approve", "approved", "pass"}:
        verdict = "approved"
    if verdict in {"reject", "rejected"}:
        verdict = "rejected"
    if verdict not in {"approved", "needs_review", "rejected"}:
        return {"score": 0.0, "ok": False, "reason": f"bad verdict {verdict or 'missing'}"}
    checks = obj.get("checks")
    if not isinstance(checks, list) or len(checks) < 3:
        return {"score": 0.25, "ok": False, "reason": "checks missing"}
    names = {str((c or {}).get("name") if isinstance(c, dict) else "").lower() for c in checks}
    overlap = len(CHECK_NAMES & {n.replace(" ", "_") for n in names})
    sugg = obj.get("suggestions")
    has_sugg = isinstance(sugg, list) and len(sugg) > 0
    # 0.4 for verdict, 0.4 for checks coverage, 0.2 reserved for suggestions (scored separately)
    score = 0.4 + 0.4 * (overlap / max(len(CHECK_NAMES), 1))
    if overlap >= 5 and verdict:
        ok = True
    else:
        ok = overlap >= 3
    return {"score": round(score, 4), "ok": ok, "checks_matched": overlap, "has_suggestions": has_sugg, "verdict": verdict}


def suggestion_presence_score(actual: str) -> dict[str, Any]:
    obj = parse_json_maybe(actual)
    if not obj or not isinstance(obj.get("suggestions"), list) or not obj["suggestions"]:
        return {"score": 0.0, "ok": False, "n": 0}
    required = {"action", "title"}
    ok_n = 0
    for s in obj["suggestions"]:
        if not isinstance(s, dict):
            continue
        keys = {k.lower() for k in s}
        # accept type as action alias, summary as title
        if ("action" in keys or "type" in keys) and ("title" in keys or "summary" in keys or "action" in keys):
            if s.get("owner_team") or s.get("owner") or s.get("maps_to") or s.get("expected_recovery") is not None or s.get("amount") is not None:
                ok_n += 1
            else:
                ok_n += 0.5
    n = len(obj["suggestions"])
    score = 0.0 if n == 0 else min(1.0, ok_n / n)
    return {"score": round(float(score), 4), "ok": score >= 0.5, "n": n}
