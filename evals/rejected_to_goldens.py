#!/usr/bin/env python3
"""Turn reviewer-rejected or unverified agent outputs into new DeepEval goldens.

Reads a JSON array (from a review export or a query of ra_review_decisions /
ra_eval_scores) with objects:

  {
    "agent": "investigator",
    "input": "...",
    "context": "...",
    "rejected_output": "...",
    "comment": "human reason",
    "expected_output": "optional correction"
  }

Appends goldens to evals/goldens/<agent>.json. Does not call the network.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

GOLDENS = Path(__file__).resolve().parent / "goldens"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", help="JSON file of rejected/unverified outputs")
    args = p.parse_args(argv)
    rows = json.loads(Path(args.source).read_text())
    if not isinstance(rows, list):
        print("Source must be a JSON array", file=sys.stderr)
        return 1
    added = 0
    for row in rows:
        agent = str(row.get("agent") or "investigator")
        path = GOLDENS / f"{agent}.json"
        existing = json.loads(path.read_text()) if path.exists() else []
        name = str(row.get("name") or f"rejected-{added+1}")
        golden = {
            "name": name,
            "context": row.get("context") or "",
            "input": row.get("input") or "Revise this output so it only uses the provided context.",
            "expected_output": row.get("expected_output")
            or "insufficient data"
            or "",
            "retrieval_context": row.get("retrieval_context") or [row.get("context") or ""],
            "source_comment": row.get("comment") or "Converted from a reviewer rejection / unverified output.",
            "rejected_output": row.get("rejected_output"),
        }
        existing.append(golden)
        path.write_text(json.dumps(existing, indent=2))
        added += 1
        print(f"appended {name} -> {path.name}")
    print(f"added {added}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
