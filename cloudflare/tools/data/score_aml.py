#!/usr/bin/env python3
"""Offline GraphSAGE-lite scores for the IBM AML slice. Numpy + sklearn only. No secrets."""
from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

DATA = Path(os.environ.get("DATA_DIR", "/tmp/ra-open-data"))
SRC = DATA / "aml_30k.csv"
OUT = Path(os.environ.get("AML_SCORES_OUT", str(DATA / "aml_scores.json")))
VERSION = "v10.0.0"
SEED = 2036
HIDDEN = 16


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0)


def sage_layer(h: np.ndarray, neigh: list[list[int]], w: np.ndarray, b: np.ndarray) -> np.ndarray:
    n, d = h.shape
    mean = np.zeros_like(h)
    for i, nbrs in enumerate(neigh):
        if nbrs:
            mean[i] = h[nbrs].mean(axis=0)
        else:
            mean[i] = h[i]
    cat = np.concatenate([h, mean], axis=1)
    return relu(cat @ w + b)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")

    edges: list[tuple] = []
    with SRC.open() as f:
        r = csv.DictReader(f)
        for row in r:
            frm = str(row["from_account"])
            to = str(row["to_account"])
            amt = float(row["amount_received"] or row["amount_paid"] or 0) or 0.0
            fmt = row.get("payment_format") or ""
            flag = 1 if str(row.get("is_laundering") or "0").strip() == "1" else 0
            edges.append((frm, to, amt, fmt, flag))

    nodes = sorted({a for e in edges for a in (e[0], e[1])})
    idx = {a: i for i, a in enumerate(nodes)}
    n = len(nodes)
    out_deg = np.zeros(n)
    in_deg = np.zeros(n)
    out_amt = np.zeros(n)
    in_amt = np.zeros(n)
    formats = [set() for _ in range(n)]
    counterparties = [set() for _ in range(n)]
    labels = np.zeros(n, dtype=int)
    neigh: list[list[int]] = [[] for _ in range(n)]

    for frm, to, amt, fmt, flag in edges:
        i, j = idx[frm], idx[to]
        out_deg[i] += 1
        in_deg[j] += 1
        out_amt[i] += amt
        in_amt[j] += amt
        formats[i].add(fmt)
        formats[j].add(fmt)
        counterparties[i].add(j)
        counterparties[j].add(i)
        neigh[i].append(j)
        neigh[j].append(i)
        if flag:
            labels[i] = 1
            labels[j] = 1

    x = np.column_stack([
        np.log1p(out_deg),
        np.log1p(in_deg),
        np.log1p(out_amt),
        np.log1p(in_amt),
        np.log1p(np.array([len(s) for s in counterparties], dtype=float)),
        np.array([len(s) for s in formats], dtype=float),
        np.log1p((out_amt + in_amt) / np.maximum(out_deg + in_deg, 1)),
        (out_amt - in_amt) / np.maximum(out_amt + in_amt, 1),
    ]).astype(np.float64)

    rng = np.random.default_rng(SEED)
    d = x.shape[1]
    # Deterministic "learned" projection (fixed seed) then a trained logistic head.
    w1 = rng.normal(0, 0.4, size=(2 * d, HIDDEN))
    b1 = rng.normal(0, 0.05, size=(HIDDEN,))
    w2 = rng.normal(0, 0.4, size=(2 * HIDDEN, HIDDEN))
    b2 = rng.normal(0, 0.05, size=(HIDDEN,))
    h0 = StandardScaler().fit_transform(x)
    h1 = sage_layer(h0, neigh, w1, b1)
    h2 = sage_layer(h1, neigh, w2, b2)

    # Hold out 25% of accounts for a honest-ish head metric.
    strat = labels if labels.sum() and labels.sum() < n else None
    xtr, xte, ytr, yte = train_test_split(h2, labels, test_size=0.25, random_state=SEED, stratify=strat)
    clf = LogisticRegression(max_iter=400, class_weight="balanced", random_state=SEED)
    clf.fit(xtr, ytr)
    pte = clf.predict_proba(xte)[:, 1]
    pall = clf.predict_proba(h2)[:, 1]
    auc = float(roc_auc_score(yte, pte)) if len(set(yte)) == 2 else None
    pr = float(average_precision_score(yte, pte)) if len(set(yte)) == 2 else None

    rows = [
        {
            "account_id": nodes[i],
            "sage_score": float(pall[i]),
            "is_laundering_label": int(labels[i]),
            "version": VERSION,
        }
        for i in range(n)
    ]
    payload = {
        "version": VERSION,
        "algorithm": "graphsage_lite_numpy",
        "n_accounts": n,
        "n_edges": len(edges),
        "n_labelled": int(labels.sum()),
        "auc": auc,
        "pr_auc": pr,
        "note": (
            "Two-layer mean-aggregation GraphSAGE-lite (numpy) with a logistic head. "
            "Features are structural (degree, amounts, counterparties, formats) and do not include the laundering flag. "
            "Account label is 1 if the account appears on any laundering edge. Scores are exposure only, not INR book leakage."
        ),
        "scores": rows,
    }
    OUT.write_text(json.dumps(payload))
    print(
        "aml_scores",
        "accounts", n,
        "edges", len(edges),
        "labelled", int(labels.sum()),
        "auc", None if auc is None else round(auc, 3),
        "pr_auc", None if pr is None else round(pr, 3),
        "out", str(OUT),
    )


if __name__ == "__main__":
    main()
