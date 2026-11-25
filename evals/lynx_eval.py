#!/usr/bin/env python3
"""Run LynxFaithfulness on goldens (expected answers), planted probes, and refusals.

This is the EVAL_LYNX=1 path. It does not call any paid API. Workers AI is not
required; if a prior DeepEval results.json is present, generated actual_output
rows are also scored (once) for agreement with GroundedNumbers.

Usage:
  EVAL_LYNX=1 /workspace/deepeval-venv/bin/python evals/lynx_eval.py
  EVAL_RESULTS_DIR=/workspace/evals-results/<day> ...  # writes lynx_results.json + LYNX_RESULTS.md
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

from deterministic_metrics import expected_is_refusal, is_refusal, number_id_score
from lynx_metric import (
    ensure_lynx_server,
    judge_pair,
    lynx_available,
    lynx_enabled,
    model_path,
)

GOLDENS = Path(__file__).resolve().parent / "goldens"
PROBES = Path(__file__).resolve().parent / "lynx_probes.json"
IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def _context_of(row: dict) -> str:
    # Prefer the full agent context (what the model was asked to stay faithful to).
    if row.get("context"):
        return str(row["context"])
    ctx = row.get("retrieval_context") or []
    if isinstance(ctx, str):
        return ctx
    return "\n".join(str(x) for x in ctx if x)


def _load_goldens() -> list[dict]:
    rows = []
    for path in sorted(GOLDENS.glob("*.json")):
        agent = path.stem
        for row in json.loads(path.read_text()):
            expected = row.get("expected_output") or ""
            kind = "correct_refusal" if expected_is_refusal(expected) else "golden_expected"
            rows.append(
                {
                    "name": row.get("name") or "unnamed",
                    "agent": agent,
                    "kind": kind,
                    "expected_score": "PASS",
                    "input": row.get("input") or "",
                    "context": _context_of(row),
                    "answer": expected,
                    "source": f"goldens/{path.name}",
                }
            )
    return rows


def _load_probes() -> list[dict]:
    if not PROBES.is_file():
        return []
    rows = []
    for row in json.loads(PROBES.read_text()):
        item = dict(row)
        item.setdefault("kind", "planted_hallucination")
        item.setdefault("expected_score", "FAIL")
        item["source"] = "lynx_probes.json"
        rows.append(item)
    return rows


def _load_actuals_from_results() -> list[dict]:
    """Score generated actual_output from a prior suite run, if present."""
    dest = os.environ.get("EVAL_RESULTS_DIR")
    if not dest:
        return []
    path = Path(dest) / "results.json"
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    rows = []
    for row in payload.get("results") or []:
        actual = row.get("actual_output")
        if not actual:
            continue
        ctx = row.get("input")  # placeholder, replaced below
        # Reconstruct context from the matching golden when possible.
        rows.append(
            {
                "name": f"{row.get('name') or 'unnamed'}#actual",
                "agent": row.get("agent") or "unknown",
                "kind": "generated_actual",
                "expected_score": None,
                "input": row.get("input") or "",
                "context": "",
                "answer": actual,
                "source": "results.json",
                "_golden_name": row.get("name"),
            }
        )
    gold_by = {(g["agent"], g["name"].removesuffix("#actual")): g for g in _load_goldens()}
    filled = []
    for item in rows:
        key = (item["agent"], item.get("_golden_name") or item["name"].removesuffix("#actual"))
        golden = gold_by.get(key)
        if golden:
            item["context"] = golden["context"]
            if expected_is_refusal(golden["answer"]) and is_refusal(item["answer"]):
                item["kind"] = "generated_actual_refusal"
        item.pop("_golden_name", None)
        if item["context"]:
            filled.append(item)
    return filled


def _grounded(answer: str, context: str) -> dict:
    rec = number_id_score(answer, context)
    rec["pass"] = rec["score"] >= 0.8
    rec["verdict"] = "PASS" if rec["pass"] else "FAIL"
    return rec


def _score_case(row: dict) -> dict:
    started = datetime.now(IST)
    lynx = judge_pair(row["input"], row["context"], row["answer"])
    grounded = _grounded(row["answer"], row["context"])
    verdict = lynx.get("verdict")
    expected = row.get("expected_score")
    agreed = None
    if verdict and grounded.get("verdict"):
        agreed = verdict == grounded["verdict"]
    expected_hit = None
    if expected and verdict:
        expected_hit = verdict == expected
    return {
        "name": row["name"],
        "agent": row["agent"],
        "kind": row["kind"],
        "source": row.get("source"),
        "expected_score": expected,
        "lynx_verdict": verdict,
        "lynx_score": lynx.get("score"),
        "lynx_success": verdict == "PASS",
        "lynx_ok": lynx.get("ok"),
        "lynx_error": lynx.get("error"),
        "lynx_reason": lynx.get("reason"),
        "lynx_raw": lynx.get("raw"),
        "elapsed_s": lynx.get("elapsed_s"),
        "usage": lynx.get("usage") or {},
        "cost_inr": 0,
        "grounded_numbers_score": grounded["score"],
        "grounded_numbers_verdict": grounded["verdict"],
        "agreement_with_grounded_numbers": agreed,
        "matches_expected": expected_hit,
        "scored_at": started.strftime("%Y-%m-%d %I:%M %p IST"),
    }


def _summarize(results: list[dict]) -> dict:
    by_agent: dict[str, list] = defaultdict(list)
    by_kind: dict[str, list] = defaultdict(list)
    for row in results:
        by_agent[row["agent"]].append(row)
        by_kind[row["kind"]].append(row)

    def pack(rows: list[dict]) -> dict:
        elapsed = [r["elapsed_s"] for r in rows if r.get("elapsed_s") is not None]
        ok = [r for r in rows if r.get("lynx_ok")]
        return {
            "n": len(rows),
            "pass": sum(1 for r in rows if r.get("lynx_verdict") == "PASS"),
            "fail": sum(1 for r in rows if r.get("lynx_verdict") == "FAIL"),
            "error": sum(1 for r in rows if not r.get("lynx_ok")),
            "expected_hits": sum(1 for r in rows if r.get("matches_expected") is True),
            "expected_n": sum(1 for r in rows if r.get("expected_score")),
            "agreement_with_grounded_numbers": sum(
                1 for r in rows if r.get("agreement_with_grounded_numbers") is True
            ),
            "agreement_n": sum(
                1 for r in rows if r.get("agreement_with_grounded_numbers") is not None
            ),
            "elapsed_s_total": round(sum(elapsed), 3) if elapsed else 0,
            "elapsed_s_mean": round(sum(elapsed) / len(elapsed), 3) if elapsed else None,
            "elapsed_s_max": round(max(elapsed), 3) if elapsed else None,
        }

    planted = by_kind.get("planted_hallucination") or []
    planted_caught = sum(1 for r in planted if r.get("lynx_verdict") == "FAIL")
    return {
        "by_agent": {k: pack(v) for k, v in by_agent.items()},
        "by_kind": {k: pack(v) for k, v in by_kind.items()},
        "planted_catch_rate": (
            None if not planted else round(planted_caught / len(planted), 4)
        ),
        "planted_caught": planted_caught,
        "planted_n": len(planted),
        "overall": pack(results),
    }


def _markdown(payload: dict) -> str:
    s = payload["summary"]
    overall = s["overall"]
    catch_pct = "n/a" if s["planted_catch_rate"] is None else f"{s['planted_catch_rate']*100:.0f}%"
    lines = [
        "# Lynx faithfulness results",
        "",
        f"Generated: {payload['generated_at']}",
        "",
        "## How this ran",
        "",
        f"- Judge: local Patronus Lynx 8B GGUF via llama.cpp (`{payload['model']}`)",
        f"- Server: `{payload['server']}`",
        f"- Prompt: official Lynx QUESTION / DOCUMENT / ANSWER → JSON `REASONING`, `SCORE` (PASS/FAIL)",
        f"- Cost: **₹0** (no paid API, no Workers AI neurons for this judge)",
        f"- Cases: {overall['n']}; Lynx PASS {overall['pass']}; FAIL {overall['fail']}; errors {overall['error']}",
        f"- Mean speed: {overall['elapsed_s_mean']} s/case; max {overall['elapsed_s_max']} s; total {overall['elapsed_s_total']} s",
        "",
        payload["note"],
        "",
        "## Planted hallucinations",
        "",
        f"Catch rate: **{s['planted_caught']}/{s['planted_n']}** ({catch_pct}). "
        "A catch is Lynx SCORE=FAIL on a planted unfaithful answer.",
        "",
        "## Per-agent Lynx verdicts",
        "",
        "| Agent | N | PASS | FAIL | Errors | Expected hits | Agree w/ GroundedNumbers | Mean s/case |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for agent, rec in s["by_agent"].items():
        hits = f"{rec['expected_hits']}/{rec['expected_n']}"
        agr = f"{rec['agreement_with_grounded_numbers']}/{rec['agreement_n']}"
        mean = "—" if rec["elapsed_s_mean"] is None else f"{rec['elapsed_s_mean']:.1f}"
        lines.append(
            f"| {agent} | {rec['n']} | {rec['pass']} | {rec['fail']} | {rec['error']} | {hits} | {agr} | {mean} |"
        )
    lines += [
        "",
        "## By kind",
        "",
        "| Kind | N | PASS | FAIL | Errors | Expected hits | Agree w/ GroundedNumbers | Mean s/case |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for kind, rec in s["by_kind"].items():
        hits = f"{rec['expected_hits']}/{rec['expected_n']}"
        agr = f"{rec['agreement_with_grounded_numbers']}/{rec['agreement_n']}"
        mean = "—" if rec["elapsed_s_mean"] is None else f"{rec['elapsed_s_mean']:.1f}"
        lines.append(
            f"| {kind} | {rec['n']} | {rec['pass']} | {rec['fail']} | {rec['error']} | {hits} | {agr} | {mean} |"
        )
    lines += ["", "## Per-case detail", ""]
    for row in payload["results"]:
        status = row.get("lynx_verdict") or ("ERROR" if row.get("lynx_error") else "—")
        exp = row.get("expected_score") or "—"
        agree = row.get("agreement_with_grounded_numbers")
        agree_s = "—" if agree is None else ("yes" if agree else "no")
        lines.append(f"### {row['agent']} / {row['name']} ({row['kind']})")
        lines.append(
            f"- Lynx: **{status}** (expected {exp}); GroundedNumbers: {row['grounded_numbers_verdict']} "
            f"({row['grounded_numbers_score']}); agreement: {agree_s}; {row.get('elapsed_s')} s; ₹0"
        )
        if row.get("lynx_error"):
            lines.append(f"- Error: {row['lynx_error']}")
        reason = (row.get("lynx_reason") or "").replace("\n", " ").strip()
        if len(reason) > 600:
            reason = reason[:600] + "…"
        if reason:
            lines.append(f"- Reasoning: {reason}")
        lines.append("")
    lines += [
        "## Licenses",
        "",
        "Lynx weights are CC-BY-NC-4.0 plus the Llama 3 Community License on the Llama 3 base. "
        "Non-commercial use is the tighter constraint. This run is local evaluation only; "
        "do not ship the weights in a commercial product without a license that allows it.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    os.environ.setdefault("DEEPEVAL_TELEMETRY_ENABLED", "0")

    if not lynx_enabled() and os.environ.get("EVAL_LYNX_FORCE", "0") != "1":
        # Allow direct invocation; run_local.sh sets EVAL_LYNX=1.
        os.environ["EVAL_LYNX"] = "1"

    ok, detail = lynx_available()
    if not ok:
        print(f"Lynx unavailable: {detail}")
        print("Workers AI judges (if configured) remain the fallback. Not pretending Workers AI is Lynx.")
        return 2

    started_ok, started_detail = ensure_lynx_server()
    print(f"LYNX_SERVER {started_detail}")
    if not started_ok:
        print("Workers AI judges (if configured) remain the fallback.")
        return 2

    include_actuals = os.environ.get("EVAL_LYNX_ACTUALS", "1").strip() not in {"0", "false", "no"}
    cases = _load_goldens() + _load_probes()
    if include_actuals:
        cases.extend(_load_actuals_from_results())

    results = []
    for i, row in enumerate(cases, 1):
        print(f"[{i}/{len(cases)}] {row['agent']}/{row['name']} ({row['kind']}) …", flush=True)
        rec = _score_case(row)
        status = rec["lynx_verdict"] or "ERROR"
        print(
            f"  {status} expected={rec['expected_score']} grounded={rec['grounded_numbers_verdict']} "
            f"agree={rec['agreement_with_grounded_numbers']} {rec['elapsed_s']}s",
            flush=True,
        )
        results.append(rec)

    summary = _summarize(results)
    payload = {
        "generated_at": datetime.now(IST).strftime("%Y-%m-%d %I:%M %p IST"),
        "model": str(model_path()),
        "server": started_detail,
        "cost_inr": 0,
        "cost_usd": 0,
        "note": (
            "Lynx 8B (Q4_K_M or the Q3_K_M fallback) ran locally on the box CPU through llama.cpp. "
            "Goldens are scored on their expected_output against the golden context. "
            "Planted probes are unfaithful answers that Lynx should FAIL. "
            "GroundedNumbers is the deterministic number/ID check; disagreement can be valid "
            "when a clause is wrong but every numeral still appears in the document."
        ),
        "summary": summary,
        "results": results,
    }

    out_dir = os.environ.get("EVAL_RESULTS_DIR")
    if out_dir:
        dest = Path(out_dir)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "lynx_results.json").write_text(json.dumps(payload, indent=2))
        (dest / "LYNX_RESULTS.md").write_text(_markdown(payload))
        print(f"RESULTS {dest}")
    else:
        print(json.dumps({"generated_at": payload["generated_at"], "summary": summary, "cost_inr": 0}, indent=2))

    planted = summary["planted_n"]
    caught = summary["planted_caught"]
    print(
        f"DONE lynx cases={len(results)} planted_catch={caught}/{planted} "
        f"mean_s={summary['overall']['elapsed_s_mean']} cost_inr=0"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
