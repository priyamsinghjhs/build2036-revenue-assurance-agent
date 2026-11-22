#!/usr/bin/env python3
"""Offline / local DeepEval suite for the Revenue Assurance agents.

Uses Workers AI (OpenAI-compatible) as both the model-under-test and the judge.
No OpenAI, no Confident AI cloud, no GitHub Actions required.

Required environment:
  CF_ACCOUNT_ID
  CF_AI_API_TOKEN   (preferred; must have Workers AI permission)
  or CLOUDFLARE_API_TOKEN as a fallback

Optional:
  EVAL_RESULTS_DIR     where to write JSON + markdown (default: stdout only)
  CF_EVAL_MODEL        default @cf/meta/llama-4-scout-17b-16e-instruct
  CF_EVAL_MAX_TOKENS   default 256
  CF_EVAL_NEURON_BUDGET default 4000 (leave headroom under the 10k/day free cap)

Do not print tokens.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

GOLDENS = Path(__file__).resolve().parent / "goldens"
IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def secrets_present() -> bool:
    return bool(os.environ.get("CF_ACCOUNT_ID") and (os.environ.get("CF_AI_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")))


def load_goldens():
    rows = []
    for path in sorted(GOLDENS.glob("*.json")):
        agent = path.stem
        for row in json.loads(path.read_text()):
            rows.append((agent, row))
    return rows


def main() -> int:
    if not secrets_present():
        print("Skipping DeepEval — CF_ACCOUNT_ID and CF_AI_API_TOKEN (or CLOUDFLARE_API_TOKEN) are not set.")
        return 0

    # Telemetry / Confident AI off (also set in run_local.sh).
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    os.environ.setdefault("DEEPEVAL_TELEMETRY_ENABLED", "0")
    os.environ.setdefault("CONFIDENT_OPEN_BROWSER", "0")
    os.environ.setdefault("CONFIDENT_TRACE_FLUSH", "NO")

    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        HallucinationMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
    )
    from deepeval.test_case import LLMTestCase

    from cf_model import USAGE, NeuronBudgetExceeded, WorkersAIModel, workers_ai_complete
    from deterministic_metrics import (
        auditor_schema_score,
        expected_is_refusal,
        is_refusal,
        number_id_score,
        suggestion_presence_score,
    )

    judge = WorkersAIModel()
    metric_kwargs = dict(
        model=judge,
        include_reason=False,
        async_mode=False,
        verbose_mode=False,
    )
    metrics_std = [
        ("Faithfulness", FaithfulnessMetric(threshold=0.6, **metric_kwargs)),
        ("Hallucination", HallucinationMetric(threshold=0.6, **metric_kwargs)),
        ("AnswerRelevancy", AnswerRelevancyMetric(threshold=0.5, **metric_kwargs)),
    ]
    metrics_rag = metrics_std + [
        ("ContextualRecall", ContextualRecallMetric(threshold=0.5, **metric_kwargs)),
        ("ContextualPrecision", ContextualPrecisionMetric(threshold=0.5, **metric_kwargs)),
    ]

    results = []
    fatal = 0
    quality_fail = 0

    for agent, row in load_goldens():
        ctx = row.get("retrieval_context") or [row.get("context", "")]
        name = row.get("name") or "unnamed"
        entry = {
            "agent": agent,
            "name": name,
            "input": row["input"],
            "expected_output": row.get("expected_output"),
            "actual_output": None,
            "metrics": [],
            "error": None,
        }
        try:
            schema_hint = ""
            max_tokens = None
            if agent == "auditor":
                max_tokens = 512
                schema_hint = (
                    " Reply with one JSON object only, no prose, matching this schema: "
                    '{"verdict":"approved|needs_review|rejected",'
                    '"checks":[{"name":"amount_reconciliation|evidence_completeness|policy_compliance|duplicate_prior_case|segregation_of_duties|grounding","result":"pass|fail","evidence":"cite IDs and amounts from CONTEXT only","source":"query or rule"}],'
                    '"findings":[{"issue":"short","severity":"high|medium|low","impact":0}],'
                    '"suggestions":[{"suggestion_id":"sug-1","action":"request_file|recover|dispute_draft|data_request_draft|adjust_rule|escalate|write_off","title":"concrete next step","owner_team":"Scheme|Finance|Tax|Ops|Compliance","priority":"high|medium|low","expected_recovery":0,"maps_to":"action_queue|draft_dispute|draft_data_request|case","rationale":"short"}],'
                    '"confidence":80,"rationale":"one short paragraph","cfo_one_liner":"one sentence"}.'
                    " Every number and ID must appear in the context. Suggestions are in-app proposals only."
                )
            actual = workers_ai_complete(
                f"You are the {agent} agent. Answer only from the context. "
                f"If a fact is missing, say 'insufficient data'. Keep the answer short.{schema_hint}\n\n"
                f"CONTEXT:\n{row['context']}\n\nQUESTION:\n{row['input']}\n",
                max_tokens=max_tokens,
            )
            entry["actual_output"] = actual
        except NeuronBudgetExceeded as exc:
            entry["error"] = str(exc)
            results.append(entry)
            print(f"BUDGET {agent}/{name}: {exc}")
            break
        except Exception as exc:  # noqa: BLE001
            fatal += 1
            entry["error"] = f"MODEL_ERROR: {exc}"
            results.append(entry)
            print(f"MODEL_ERROR {agent}/{name}: {exc}")
            continue

        context_text = "\n".join(ctx) if isinstance(ctx, list) else str(ctx or row.get("context") or "")
        det_num = number_id_score(actual, context_text)
        refusal_ok = expected_is_refusal(row.get("expected_output")) and is_refusal(actual)
        refusal_wrong = expected_is_refusal(row.get("expected_output")) and not is_refusal(actual)
        case_fail = False
        def add_metric(name, score, threshold, success, error=None, kind="deterministic"):
            nonlocal case_fail
            rec = {"name": name, "threshold": threshold, "score": score, "success": success, "error": error, "kind": kind}
            entry["metrics"].append(rec)
            if error or success is False:
                case_fail = True
            status = "PASS" if success else ("ERROR" if error else "FAIL")
            print(f"  {status} {agent}/{name} score={score} threshold={threshold}")

        # Correct refusals pass alignment; invented answers on those goldens fail.
        if expected_is_refusal(row.get("expected_output")):
            add_metric("RefusalAlignment", 1.0 if refusal_ok else 0.0, 1.0, bool(refusal_ok))
        add_metric("GroundedNumbers", det_num["score"], 0.8, det_num["score"] >= 0.8)
        if agent == "auditor":
            sch = auditor_schema_score(actual)
            sug = suggestion_presence_score(actual)
            add_metric("AuditorSchema", sch["score"], 0.7, sch["score"] >= 0.7, None if sch["ok"] or sch["score"] >= 0.7 else sch.get("reason"))
            add_metric("SuggestionPresence", sug["score"], 0.5, sug["score"] >= 0.5)

        skip_llm = refusal_ok  # do not spend neurons or apply a brittle judge to a correct refusal
        skip_hallucination_llm = skip_llm or det_num["score"] >= 0.8
        case = LLMTestCase(
            input=row["input"],
            actual_output=actual,
            expected_output=row.get("expected_output"),
            context=list(ctx),
            retrieval_context=list(ctx),
        )
        bundle = metrics_rag if agent == "contracts_rag" else metrics_std
        for metric_name, metric in bundle:
            if skip_llm:
                # Align LLM-named metrics with the refusal pass so the table stays complete.
                add_metric(metric_name, 1.0, metric.threshold, True, kind="refusal-alignment")
                continue
            if metric_name == "Hallucination" and skip_hallucination_llm:
                add_metric(metric_name, det_num["score"], metric.threshold, det_num["score"] >= metric.threshold, kind="deterministic-grounding")
                continue
            rec = {"name": metric_name, "threshold": metric.threshold, "score": None, "success": None, "error": None}
            try:
                metric.measure(case, _show_indicator=False)
                rec["score"] = None if metric.score is None else float(metric.score)
                rec["success"] = bool(metric.success) if metric.success is not None else None
                if metric.error:
                    rec["error"] = str(metric.error)
                    case_fail = True
                elif rec["success"] is False:
                    case_fail = True
            except NeuronBudgetExceeded as exc:
                rec["error"] = str(exc)
                case_fail = True
                entry["metrics"].append(rec)
                results.append(entry)
                print(f"BUDGET {agent}/{name}/{metric_name}: {exc}")
                # stop the run
                _write_results(results, quality_fail + 1, fatal, incomplete=True)
                return 1
            except Exception as exc:  # noqa: BLE001
                rec["error"] = str(exc)
                case_fail = True
            entry["metrics"].append(rec)
            status = "PASS" if rec["success"] else ("ERROR" if rec["error"] else "FAIL")
            print(f"  {status} {agent}/{name}/{metric_name} score={rec['score']} threshold={rec['threshold']}")
        if case_fail:
            quality_fail += 1
        results.append(entry)

    out = _write_results(results, quality_fail, fatal, incomplete=False)
    print(f"DONE quality_fail={quality_fail} api_fail={fatal} total={len(results)} neurons={USAGE.neurons:.2f}")
    if out:
        print(f"RESULTS {out}")
    # Soft quality misses do not fail the process; API/budget issues do.
    return 1 if fatal else 0


def _write_results(results, quality_fail, fatal, incomplete: bool):
    from cf_model import USAGE

    now = datetime.now(IST)
    by_agent: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for row in results:
        for m in row["metrics"]:
            if m["score"] is not None:
                by_agent[row["agent"]][m["name"]].append(m)

    summary = {}
    for agent, metrics in by_agent.items():
        summary[agent] = {}
        for name, recs in metrics.items():
            scores = [r["score"] for r in recs]
            summary[agent][name] = {
                "n": len(scores),
                "mean": round(sum(scores) / len(scores), 4) if scores else None,
                "scores": scores,
                "passes": sum(1 for r in recs if r["success"]),
                "fails": sum(1 for r in recs if r["success"] is False),
                "errors": sum(1 for r in recs if r["error"]),
                "threshold": recs[0]["threshold"] if recs else None,
            }

    payload = {
        "generated_at": now.strftime("%Y-%m-%d %I:%M %p IST"),
        "incomplete": incomplete,
        "quality_fail": quality_fail,
        "api_fail": fatal,
        "cases": len(results),
        "usage": USAGE.as_dict(),
        "note": (
            "DeepEval 4.x scores Faithfulness, Hallucination, AnswerRelevancy, "
            "ContextualRecall and ContextualPrecision as higher-is-better fractions. "
            "Hallucination is the share of claims judged supported (not a raw hallucination rate). "
            "Workers AI is the model-under-test and the judge. No OpenAI or Confident AI was used."
        ),
        "summary": summary,
        "results": results,
    }

    out_dir = os.environ.get("EVAL_RESULTS_DIR")
    if not out_dir:
        print(json.dumps({k: payload[k] for k in ("generated_at", "usage", "summary", "quality_fail", "api_fail")}, indent=2))
        return None

    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "results.json").write_text(json.dumps(payload, indent=2))
    (dest / "RESULTS.md").write_text(_markdown(payload))
    return str(dest)


def _markdown(payload: dict) -> str:
    u = payload["usage"]
    lines = [
        "# Local DeepEval results",
        "",
        f"Generated: {payload['generated_at']}",
        "",
        "## Usage (Workers AI free neurons)",
        "",
        f"- Model: `{u['model']}`",
        f"- Calls: {u['calls']}",
        f"- Tokens: {u['prompt_tokens']} prompt + {u['completion_tokens']} completion",
        f"- Neurons: **{u['neurons']}** / budget {u['neuron_budget']} (daily free cap is 10,000)",
        f"- API errors: {u['errors']}",
        f"- Cases: {payload['cases']}; quality misses: {payload['quality_fail']}; API failures: {payload['api_fail']}",
        "",
        payload["note"],
        "",
        "## Scores by agent",
        "",
        "| Agent | Metric | Mean | Passes | Fails | Errors | Threshold |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for agent, metrics in payload["summary"].items():
        for name, rec in metrics.items():
            mean = "—" if rec["mean"] is None else f"{rec['mean']:.3f}"
            lines.append(
                f"| {agent} | {name} | {mean} | {rec['passes']} | {rec['fails']} | {rec['errors']} | {rec['threshold']} |"
            )
    lines += ["", "## Per-case detail", ""]
    for row in payload["results"]:
        lines.append(f"### {row['agent']} / {row['name']}")
        if row.get("error"):
            lines.append(f"- Error: {row['error']}")
        if row.get("actual_output"):
            out = row["actual_output"].replace("\n", " ").strip()
            if len(out) > 400:
                out = out[:400] + "…"
            lines.append(f"- Actual output: {out}")
        for m in row["metrics"]:
            status = "PASS" if m["success"] else ("ERROR" if m["error"] else "FAIL")
            extra = f" error={m['error']}" if m["error"] else ""
            lines.append(f"- {m['name']}: {status} score={m['score']} threshold={m['threshold']}{extra}")
        lines.append("")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    sys.exit(main())
