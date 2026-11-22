#!/usr/bin/env python3
"""Train v9 models on the synthetic book and write JSON + Neon scores. Never prints secrets."""
from __future__ import annotations

import json, math, os, sys, warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[2]  # cloudflare/
MODEL_DIR = ROOT / "shared" / "ml" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
VERSION = "v9.0.0"
FEATURES = [
    "amount", "log_amount", "hour", "dow",
    "merchant_txn_1d", "merchant_amt_1d", "merchant_txn_7d", "merchant_amt_7d",
    "merchant_approval_7d", "merchant_decline_7d", "merch_amt_z",
    "mcc_approval", "mcc_spend_ratio",
    "is_retry", "retry_n_30m",
    "acquirer_approval", "scheme_approval", "method_approval",
    "merchant_cb_rate", "graph_risk", "shared_device_n", "ring_flag", "loop_flag",
    "fee_ratio_dev", "fx_markup_dev", "is_emi",
]
SETTLE_FEATURES = ["gross", "interchange_ratio", "scheme_fee_ratio", "net_ratio", "ic_dev", "fee_dev"]
FX_FEATURES = ["amount", "applied_bps", "agreed_bps", "markup_dev"]


def data_dir() -> Path | None:
    raw = os.environ.get("RA_ML_DATA")
    if raw:
        return Path(raw)
    fallback = Path("/tmp/ra-ml-data")
    if (fallback / "ra_feat_auth.csv").exists():
        return fallback
    return None


def out_dir() -> Path:
    raw = os.environ.get("RA_ML_OUT")
    if raw:
        d = Path(raw)
    else:
        base = data_dir()
        d = (base / "out") if base else (MODEL_DIR / "out")
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_table(name: str, query: str, conn=None) -> pd.DataFrame:
    d = data_dir()
    csv = (d / f"{name}.csv") if d else None
    if csv and csv.exists():
        return pd.read_csv(csv)
    if conn is None:
        raise FileNotFoundError(f"CSV {name} not found and no DB connection")
    return pd.read_sql(query, conn)


def load_url() -> str:
    env = os.environ.get("DATABASE_URL") or os.environ.get("REGRESSION_DATABASE_URL")
    if env:
        return env.strip()
    p = Path(os.environ.get("DATABASE_URL_FILE", "/workspace/secrets/neon_database_url"))
    if p.exists():
        return p.read_text().strip()
    return ""


def connect():
    import psycopg2
    url = load_url()
    if not url:
        sys.stderr.write("DATABASE_URL is not set\n")
        sys.exit(1)
    return psycopg2.connect(url, connect_timeout=8)


def flatten_lgb_tree(node: dict) -> list[dict]:
    nodes: list[dict] = []

    def rec(n: dict) -> int:
        i = len(nodes)
        if "leaf_value" in n:
            nodes.append({"leaf": float(n["leaf_value"]), "cover": float(n.get("leaf_count", 1) or 1)})
            return i
        nodes.append({})
        left = rec(n["left_child"])
        right = rec(n["right_child"])
        nodes[i] = {
            "feature": int(n["split_feature"]),
            "threshold": float(n["threshold"]),
            "left": left,
            "right": right,
            "cover": float(n.get("internal_count", 1) or 1),
        }
        return i

    rec(node)
    return nodes


def expected_value(tree: list[dict], i: int = 0) -> float:
    n = tree[i]
    if "leaf" in n:
        return n["leaf"]
    cl, cr = n["left"], n["right"]
    clc = tree[cl].get("cover", 1)
    crc = tree[cr].get("cover", 1)
    tot = clc + crc or 1
    return (expected_value(tree, cl) * clc + expected_value(tree, cr) * crc) / tot


def raw_tree(tree: list[dict], x: np.ndarray) -> float:
    i = 0
    for _ in range(len(tree) + 2):
        n = tree[i]
        if "leaf" in n:
            return n["leaf"]
        i = n["left"] if x[n["feature"]] <= n["threshold"] else n["right"]
    return 0.0


def path_shap_tree(tree: list[dict], x: np.ndarray, n_f: int) -> np.ndarray:
    phi = np.zeros(n_f)
    i = 0
    for _ in range(len(tree) + 2):
        n = tree[i]
        if "leaf" in n:
            break
        ev = expected_value(tree, i)
        child = n["left"] if x[n["feature"]] <= n["threshold"] else n["right"]
        phi[n["feature"]] += expected_value(tree, child) - ev
        i = child
    return phi


def sigmoid(z: float) -> float:
    if z > 20:
        return 1.0
    if z < -20:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def predict_raw(model: dict, x: np.ndarray) -> float:
    s = float(model.get("base_score") or 0)
    for t in model["trees"]:
        s += raw_tree(t["nodes"], x)
    return s


def explain(model: dict, x: np.ndarray) -> tuple[float, float, np.ndarray]:
    base = float(model.get("base_score") or 0)
    n_f = len(model["features"])
    phi = np.zeros(n_f)
    for t in model["trees"]:
        nodes = t["nodes"]
        base += expected_value(nodes)
        phi += path_shap_tree(nodes, x, n_f)
    raw = predict_raw(model, x)
    return raw, base, phi


def safe_auc(y, p):
    y = np.asarray(y)
    p = np.asarray(p)
    if len(np.unique(y)) < 2:
        return None
    try:
        return float(roc_auc_score(y, p))
    except Exception:
        return None


def safe_pr(y, p):
    y = np.asarray(y)
    p = np.asarray(p)
    if y.sum() == 0:
        return None
    try:
        return float(average_precision_score(y, p))
    except Exception:
        return None


def train_lgb(X: np.ndarray, y: np.ndarray, model_id: str, seed: int = 42,
              n_estimators=40, max_depth=3, num_leaves=8, min_child=20) -> tuple[dict, np.ndarray]:
    import lightgbm as lgb
    pos = max(int(y.sum()), 1)
    neg = max(int(len(y) - y.sum()), 1)
    params = dict(
        objective="binary",
        learning_rate=0.08,
        n_estimators=n_estimators,
        max_depth=max_depth,
        num_leaves=num_leaves,
        min_child_samples=min_child,
        scale_pos_weight=neg / pos,
        verbosity=-1,
        seed=seed,
    )
    # Honest hold-out when both classes exist in a 20% slice; otherwise OOF.
    oof = np.zeros(len(y))
    auc = pr = None
    n_train = n_test = len(y)
    if y.sum() >= 8 and (len(y) - y.sum()) >= 8:
        try:
            Xtr, Xte, ytr, yte, itr, ite = train_test_split(
                X, y, np.arange(len(y)), test_size=0.25, random_state=seed, stratify=y
            )
            clf = lgb.LGBMClassifier(**params)
            clf.fit(Xtr, ytr)
            pte = clf.predict_proba(Xte)[:, 1]
            auc, pr = safe_auc(yte, pte), safe_pr(yte, pte)
            n_train, n_test = len(ytr), len(yte)
            # Refit on all data for the exported model
            clf.fit(X, y)
        except ValueError:
            clf = lgb.LGBMClassifier(**params)
            clf.fit(X, y)
    else:
        # Leave-one-out style 5-fold when the minority is tiny
        clf = lgb.LGBMClassifier(**params)
        if y.sum() >= 3 and len(y) >= 8:
            skf = StratifiedKFold(n_splits=min(5, int(y.sum())), shuffle=True, random_state=seed)
            for tr, te in skf.split(X, y):
                fold = lgb.LGBMClassifier(**params)
                fold.fit(X[tr], y[tr])
                oof[te] = fold.predict_proba(X[te])[:, 1]
            auc, pr = safe_auc(y, oof), safe_pr(y, oof)
            n_test = len(y)
        clf.fit(X, y)

    dump = clf.booster_.dump_model()
    trees = [{"nodes": flatten_lgb_tree(t["tree_structure"])} for t in dump["tree_info"]]
    model = {
        "model_id": model_id,
        "version": VERSION,
        "algorithm": "lightgbm",
        "objective": "binary",
        "base_score": 0.0,
        "features": FEATURES,
        "trees": trees,
        "metrics": {
            "auc": auc,
            "pr_auc": pr,
            "n_train": int(n_train),
            "n_test": int(n_test),
            "n_pos": int(y.sum()),
            "n": int(len(y)),
            "synthetic": True,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    # Global path-SHAP on the training matrix (cap 800 rows)
    idx = np.arange(len(X))
    if len(idx) > 800:
        rng = np.random.default_rng(seed)
        idx = rng.choice(idx, 800, replace=False)
    acc = np.zeros(len(FEATURES))
    for i in idx:
        _, _, phi = explain(model, X[i])
        acc += np.abs(phi)
    acc /= max(len(idx), 1)
    model["global_shap"] = [
        {"feature": f, "mean_abs_shap": float(v), "rank": i + 1}
        for i, (f, v) in enumerate(sorted(zip(FEATURES, acc), key=lambda kv: -kv[1]))
    ]
    # Self-check on the first row
    raw, base, phi = explain(model, X[0])
    model["self_check"] = {
        "x": {f: float(X[0][j]) for j, f in enumerate(FEATURES)},
        "pred": float(sigmoid(raw)),
        "raw": float(raw),
        "base": float(base),
        "shap_sum": float(phi.sum()),
    }
    proba = np.array([sigmoid(predict_raw(model, X[i])) for i in range(len(X))])
    return model, proba


def export_iforest(clf: IsolationForest, features: list[str], model_id: str, X: np.ndarray) -> dict:
    trees = []
    for est in clf.estimators_:
        t = est.tree_
        nodes = []
        def rec(i, depth):
            idx = len(nodes)
            if t.children_left[i] == -1:
                nodes.append({"leaf": float(depth), "cover": float(t.n_node_samples[i])})
                return idx
            nodes.append({})
            L = rec(t.children_left[i], depth + 1)
            R = rec(t.children_right[i], depth + 1)
            nodes[idx] = {
                "feature": int(t.feature[i]),
                "threshold": float(t.threshold[i]),
                "left": L,
                "right": R,
                "cover": float(t.n_node_samples[i]),
            }
            return idx
        rec(0, 1)
        trees.append({"nodes": nodes})
    model = {
        "model_id": model_id,
        "version": VERSION,
        "algorithm": "isolation_forest",
        "objective": "iforest",
        "base_score": 0.0,
        "features": features,
        "trees": trees,
        "n_samples": int(clf.max_samples_ if not isinstance(clf.max_samples_, float) else max(int(clf.max_samples_ * len(X)), 2)),
        "metrics": {"synthetic": True, "contamination": 0.02, "n": int(len(X))},
    }
    return model


def iforest_score_one(model: dict, x: np.ndarray) -> float:
    n = model.get("n_samples") or 256
    c = max(2 * (math.log(max(n - 1, 1)) + 0.5772156649) - 2 * (n - 1) / n, 1e-6)
    avg = sum(raw_tree(t["nodes"], x) for t in model["trees"]) / max(len(model["trees"]), 1)
    return 2 ** (-avg / c)


def graphsage_lite(nodes: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    """Two-layer mean-aggregation GraphSAGE in numpy. Offline only."""
    ids = nodes["entity_id"].tolist()
    index = {e: i for i, e in enumerate(ids)}
    n = len(ids)
    types = sorted(nodes["entity_type"].fillna("unk").unique())
    type_ix = {t: i for i, t in enumerate(types)}
    feat = np.zeros((n, 3 + len(types)))
    feat[:, 0] = nodes["risk_score"].fillna(0).to_numpy() / 100.0
    feat[:, 1] = nodes["is_known_bad"].fillna(0).to_numpy()
    deg = np.zeros(n)
    adj = [[] for _ in range(n)]
    for _, r in edges.iterrows():
        a, b = index.get(r["src"]), index.get(r["dst"])
        if a is None or b is None:
            continue
        adj[a].append(b)
        adj[b].append(a)
        deg[a] += 1
        deg[b] += 1
    feat[:, 2] = np.log1p(deg)
    for i, t in enumerate(nodes["entity_type"].fillna("unk")):
        feat[i, 3 + type_ix[t]] = 1.0

    def mean_agg(H):
        out = np.zeros_like(H)
        for i in range(n):
            if adj[i]:
                out[i] = H[adj[i]].mean(axis=0)
            else:
                out[i] = H[i]
        return np.concatenate([H, out], axis=1)

    H1 = np.tanh(mean_agg(feat))
    H2 = np.tanh(mean_agg(H1))
    # Distance to known-bad centroid in the embedding (0 if none)
    bad = nodes["is_known_bad"].fillna(0).to_numpy() > 0
    if bad.any():
        centroid = H2[bad].mean(axis=0)
        dist = np.linalg.norm(H2 - centroid, axis=1)
        # Invert & scale: closer to known-bad → higher score
        score = 1 / (1 + dist)
        score = (score - score.min()) / (score.max() - score.min() + 1e-9)
        score[bad] = np.maximum(score[bad], 0.85)
    else:
        score = 1 / (1 + np.exp(-H2[:, 0]))
    out = nodes[["entity_id", "entity_type", "merchant_id"]].copy()
    out["sage_score"] = score
    return out


def upsert_json_scores(cur, rows, model_id, version):
    # rows: list of dicts with subject_type, subject_id, score, raw, base, shap, top
    cur.execute("DELETE FROM ra_model_scores WHERE model_id = %s", (model_id,))
    for r in rows:
        cur.execute(
            """INSERT INTO ra_model_scores
               (subject_type, subject_id, model_id, version, score, raw_score, base_value, shap, top_factors, scored_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb, now())""",
            (
                r["subject_type"], r["subject_id"], model_id, version,
                float(r["score"]), float(r["raw"]), float(r["base"]),
                json.dumps(r.get("shap") or []),
                json.dumps(r.get("top") or []),
            ),
        )


def write_card(cur, model: dict, notes: str):
    m = model.get("metrics") or {}
    cur.execute(
        """INSERT INTO ra_model_cards
           (model_id, version, trained_at, algorithm, n_train, n_test, auc, pr_auc, notes, metrics, is_synthetic)
           VALUES (%s,%s, now(), %s,%s,%s,%s,%s,%s,%s::jsonb, 1)
           ON CONFLICT (model_id) DO UPDATE SET
             version=EXCLUDED.version, trained_at=now(), algorithm=EXCLUDED.algorithm,
             n_train=EXCLUDED.n_train, n_test=EXCLUDED.n_test, auc=EXCLUDED.auc, pr_auc=EXCLUDED.pr_auc,
             notes=EXCLUDED.notes, metrics=EXCLUDED.metrics""",
        (
            model["model_id"], model["version"], model["algorithm"],
            m.get("n_train"), m.get("n_test"), m.get("auc"), m.get("pr_auc"),
            notes, json.dumps(m),
        ),
    )
    if model.get("global_shap"):
        cur.execute("DELETE FROM ra_shap_global WHERE model_id = %s", (model["model_id"],))
        for g in model["global_shap"]:
            cur.execute(
                "INSERT INTO ra_shap_global (model_id, feature, mean_abs_shap, rank) VALUES (%s,%s,%s,%s)",
                (model["model_id"], g["feature"], g["mean_abs_shap"], g["rank"]),
            )


def dump_outputs(payload: dict) -> Path:
    dest = out_dir() / "neon_writeback.json"
    dest.write_text(json.dumps(payload))
    print(f"wrote writeback {dest} bytes={dest.stat().st_size}")
    return dest


def main():
    print("v9 offline train starting (URL not printed)", flush=True)
    d = data_dir()
    conn = None
    if d and (d / "ra_feat_auth.csv").exists():
        print(f"loading feature tables from CSV dir (no secrets)", flush=True)
    else:
        try:
            conn = connect()
        except Exception as e:
            sys.stderr.write(f"DB connect failed ({type(e).__name__}); place CSVs in RA_ML_DATA and retry\n")
            sys.exit(1)

    auth = load_table("ra_feat_auth", "SELECT * FROM ra_feat_auth", conn)
    settle = load_table("ra_feat_settlement", "SELECT * FROM ra_feat_settlement", conn)
    fx = load_table("ra_feat_fx", "SELECT * FROM ra_feat_fx", conn)
    cb = load_table(
        "ra_chargebacks",
        """SELECT cb.cb_id, cb.capture_id, cb.amount AS cb_amount, cb.recovered, cb.reason,
                  c.auth_id
           FROM ra_chargebacks cb
           JOIN ra_captures c ON c.capture_id = cb.capture_id""",
        conn,
    )
    entities = load_table(
        "ra_risk_entities",
        "SELECT entity_id, entity_type, merchant_id, risk_score, is_known_bad FROM ra_risk_entities",
        conn,
    )
    edges = load_table("ra_risk_edges", "SELECT src, dst, rel, weight FROM ra_risk_edges", conn)
    cap = load_table("ra_captures", "SELECT capture_id, auth_id FROM ra_captures", conn)
    print(f"rows auth={len(auth)} settle={len(settle)} fx={len(fx)} cb={len(cb)} entities={len(entities)}", flush=True)


    for c in FEATURES:
        if c not in auth.columns:
            auth[c] = 0
    X = auth[FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(dtype=float)
    y_fd = auth["label_false_decline"].fillna(0).astype(int).to_numpy()
    y_cb_auth = auth["label_chargeback"].fillna(0).astype(int).to_numpy()

    fd_model, fd_proba = train_lgb(X, y_fd, "false_decline", n_estimators=45, max_depth=3, min_child=15)
    cb_model, cb_proba = train_lgb(X, y_cb_auth, "chargeback", n_estimators=30, max_depth=3, min_child=5, num_leaves=6)

    # Dispute-win on the 12 chargebacks, joined to auth features (tiny, OOF AUC).
    disp = cb.merge(auth, left_on="auth_id", right_on="auth_id", how="left")
    for c in FEATURES:
        if c not in disp.columns:
            disp[c] = 0
    Xd = disp[FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(dtype=float)
    yd = (disp["recovered"].fillna(0) / disp["cb_amount"].replace(0, np.nan).fillna(1) >= 0.5).astype(int).to_numpy()
    dw_model, dw_proba = train_lgb(Xd if len(Xd) else X[:12], yd if len(yd) else np.zeros(min(12, len(X))),
                                   "dispute_win", n_estimators=20, max_depth=2, min_child=2, num_leaves=4)

    # Isolation forest on settlement + fx (separate feature spaces, one model each, plus a stacked fee view)
    Xs = settle[SETTLE_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(dtype=float)
    if_s = IsolationForest(n_estimators=40, max_samples=min(256, len(Xs)), contamination=0.02, random_state=42)
    if_s.fit(Xs)
    if_settle = export_iforest(if_s, SETTLE_FEATURES, "iforest_settlement", Xs)
    if_settle_scores = np.array([iforest_score_one(if_settle, Xs[i]) for i in range(len(Xs))])

    Xf = fx[FX_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(dtype=float)
    if_f = IsolationForest(n_estimators=30, max_samples=min(64, max(len(Xf), 2)), contamination=0.05, random_state=42)
    if_f.fit(Xf)
    if_fx = export_iforest(if_f, FX_FEATURES, "iforest_fx", Xf)
    if_fx_scores = np.array([iforest_score_one(if_fx, Xf[i]) for i in range(len(Xf))])

    # Combined IF model used by the Worker for settlement (primary)
    if_model = if_settle

    # Tiny autoencoder (sklearn MLP) on standardised settlement features; reconstruction error.
    scaler = StandardScaler()
    Z = scaler.fit_transform(Xs)
    h = min(8, Z.shape[1])
    ae = MLPRegressor(hidden_layer_sizes=(h, max(2, h // 2), h), max_iter=400, random_state=42, solver="adam")
    ae.fit(Z, Z)
    recon = ((ae.predict(Z) - Z) ** 2).mean(axis=1)
    recon_n = (recon - recon.min()) / (recon.max() - recon.min() + 1e-9)

    sage = graphsage_lite(entities, edges)

    # Persist JSON (no secrets)
    for m in (fd_model, cb_model, dw_model, if_settle, if_fx):
        path = MODEL_DIR / f"{m['model_id']}.json"
        path.write_text(json.dumps(m))
        print(f"wrote {path.name} trees={len(m['trees'])} auc={m.get('metrics',{}).get('auc')}")


    def shap_payload(model, x):
        raw, base, phi = explain(model, x)
        shap = [{"feature": f, "value": float(x[i]), "shap": float(phi[i])} for i, f in enumerate(model["features"])]
        top = sorted(shap, key=lambda d: abs(d["shap"]), reverse=True)[:5]
        return float(raw), float(base), shap, top, float(sigmoid(raw))

    fd_rows = []
    for i, row in auth.iterrows():
        raw, base, shap, top, score = shap_payload(fd_model, X[i])
        fd_rows.append({
            "subject_type": "auth", "subject_id": str(row["auth_id"]),
            "score": score, "raw": raw, "base": base, "shap": shap, "top": top,
        })

    cb_rows = []
    for i, row in auth.iterrows():
        raw, base, shap, top, score = shap_payload(cb_model, X[i])
        cb_rows.append({
            "subject_type": "auth", "subject_id": str(row["auth_id"]),
            "score": score, "raw": raw, "base": base, "shap": shap, "top": top,
        })
    by_auth = {r["subject_id"]: r for r in cb_rows}
    cap_rows = []
    for _, r in cap.iterrows():
        src = by_auth.get(str(r["auth_id"]))
        if not src:
            continue
        cap_rows.append({**src, "subject_type": "capture", "subject_id": str(r["capture_id"])})

    dw_rows = []
    for i, row in disp.iterrows():
        if i >= len(Xd):
            break
        raw, base, shap, top, score = shap_payload(dw_model, Xd[i])
        dw_rows.append({
            "subject_type": "chargeback", "subject_id": str(row["cb_id"]),
            "score": score, "raw": raw, "base": base, "shap": shap, "top": top,
        })

    def pack_if(ids, scores, subject_type, threshold):
        out = []
        for sid, sc in zip(ids, scores):
            if sc >= threshold:
                out.append({
                    "subject_type": subject_type, "subject_id": str(sid),
                    "score": float(sc), "raw": float(sc), "base": 0, "shap": [], "top": [],
                })
        return out

    s_thr = max(0.62, float(np.quantile(if_settle_scores, 0.992)))
    f_thr = max(0.62, float(np.quantile(if_fx_scores, 0.97)))
    if_rows = pack_if(settle["scheme_id"].tolist(), if_settle_scores, "settlement", s_thr)
    if_rows += pack_if(fx["fx_id"].tolist(), if_fx_scores, "fx", f_thr)
    if_settle["metrics"]["threshold"] = s_thr
    if_fx["metrics"]["threshold"] = f_thr
    # rewrite JSON now that thresholds are known
    (MODEL_DIR / "iforest_settlement.json").write_text(json.dumps(if_settle))
    (MODEL_DIR / "iforest_fx.json").write_text(json.dumps(if_fx))
    print(f"iforest flags settlement={sum(s>=s_thr for s in if_settle_scores)} fx={sum(s>=f_thr for s in if_fx_scores)} s_thr={s_thr:.3f} f_thr={f_thr:.3f}", flush=True)

    ae_rows = []
    for sid, sc in zip(settle["scheme_id"].tolist(), recon_n):
        if sc >= 0.85:
            ae_rows.append({
                "subject_type": "settlement", "subject_id": str(sid),
                "score": float(sc), "raw": float(sc), "base": 0, "shap": [], "top": [],
            })

    notes = {
        "false_decline": "Weakly supervised on this synthetic book: positives are declines with do_not_honour or issuer_timeout. Decline reason is not a model feature. AUC is a held-out / OOF figure on synthetic data only.",
        "chargeback": "Auth-level chargeback risk. Only a handful of labelled chargebacks exist in the synthetic October book; metrics are therefore noisy and illustrative.",
        "dispute_win": "Trained on recovered/amount >= 0.5 for the 12 synthetic chargebacks. Treat metrics as illustrative only.",
        "iforest_settlement": "Unsupervised isolation forest over settlement fee ratios. Offline-trained, scored into ra_model_scores (model_id=iforest).",
        "iforest_fx": "Unsupervised isolation forest over FX markup deviations.",
    }

    def card_row(model, note):
        m = model.get("metrics") or {}
        return {
            "model_id": model["model_id"],
            "version": model["version"],
            "algorithm": model["algorithm"],
            "n_train": m.get("n_train"),
            "n_test": m.get("n_test"),
            "auc": m.get("auc"),
            "pr_auc": m.get("pr_auc"),
            "notes": note,
            "metrics": m,
            "global_shap": model.get("global_shap") or [],
        }

    cards = [
        card_row(fd_model, notes["false_decline"]),
        card_row(cb_model, notes["chargeback"]),
        card_row(dw_model, notes["dispute_win"]),
        card_row(if_settle, notes["iforest_settlement"]),
        card_row(if_fx, notes["iforest_fx"]),
        {
            "model_id": "autoencoder",
            "version": VERSION,
            "algorithm": "sklearn_mlp",
            "n_train": int(len(Xs)),
            "n_test": 0,
            "auc": None,
            "pr_auc": None,
            "notes": "Offline sklearn MLP autoencoder on settlement features. Reconstruction error is stored; the model is not shipped to the Worker.",
            "metrics": {"n": int(len(Xs)), "flagged": int((recon_n >= 0.85).sum()), "synthetic": True},
            "global_shap": [],
        },
        {
            "model_id": "graphsage",
            "version": VERSION,
            "algorithm": "graphsage_lite_numpy",
            "n_train": int(len(entities)),
            "n_test": 0,
            "auc": None,
            "pr_auc": None,
            "notes": "Offline GraphSAGE-lite (numpy mean-aggregation, two layers). Scores are an optional enrichment and are not computed in the Worker.",
            "metrics": {"n_nodes": int(len(entities)), "n_edges": int(len(edges)), "synthetic": True},
            "global_shap": [],
        },
    ]

    sage_rows = [
        {
            "entity_id": str(r["entity_id"]),
            "entity_type": None if pd.isna(r["entity_type"]) else str(r["entity_type"]),
            "merchant_id": None if pd.isna(r["merchant_id"]) else str(r["merchant_id"]),
            "sage_score": float(r["sage_score"]),
        }
        for _, r in sage.iterrows()
    ]

    payload = {
        "version": VERSION,
        "scores": {
            "false_decline": fd_rows,
            "chargeback": cb_rows + cap_rows,
            "dispute_win": dw_rows,
            "iforest": if_rows,
            "autoencoder": ae_rows,
        },
        "cards": cards,
        "graph_sage": sage_rows,
    }
    dump_outputs(payload)
    print("v9 offline train complete (writeback JSON ready)", flush=True)

    if conn is None:
        return

    cur = conn.cursor()
    upsert_json_scores(cur, fd_rows, "false_decline", VERSION)
    upsert_json_scores(cur, cb_rows + cap_rows, "chargeback", VERSION)
    upsert_json_scores(cur, dw_rows, "dispute_win", VERSION)
    upsert_json_scores(cur, if_rows, "iforest", VERSION)
    upsert_json_scores(cur, ae_rows, "autoencoder", VERSION)
    for r in sage_rows:
        cur.execute(
            """INSERT INTO ra_graph_enrichment
               (entity_id, entity_type, merchant_id, sage_score, ring_flag, shared_device_n,
                shared_account_n, loop_flag, hops, note, source, updated_at)
               VALUES (%s,%s,%s,%s, COALESCE((SELECT ring_flag FROM ra_graph_enrichment e WHERE e.entity_id=%s),0),
                       COALESCE((SELECT shared_device_n FROM ra_graph_enrichment e WHERE e.entity_id=%s),0),
                       COALESCE((SELECT shared_account_n FROM ra_graph_enrichment e WHERE e.entity_id=%s),0),
                       COALESCE((SELECT loop_flag FROM ra_graph_enrichment e WHERE e.entity_id=%s),0),
                       COALESCE((SELECT hops FROM ra_graph_enrichment e WHERE e.entity_id=%s),0),
                       'Offline GraphSAGE-lite (numpy) enrichment. Not scored in the Worker.',
                       'graphsage_offline', now())
               ON CONFLICT (entity_id) DO UPDATE SET
                 sage_score=EXCLUDED.sage_score, source='graphsage_offline',
                 note=EXCLUDED.note, updated_at=now()""",
            (r["entity_id"], r["entity_type"], r["merchant_id"], float(r["sage_score"]),
             r["entity_id"], r["entity_id"], r["entity_id"], r["entity_id"], r["entity_id"]),
        )
    write_card(cur, fd_model, notes["false_decline"])
    write_card(cur, cb_model, notes["chargeback"])
    write_card(cur, dw_model, notes["dispute_win"])
    write_card(cur, if_settle, notes["iforest_settlement"])
    write_card(cur, if_fx, notes["iforest_fx"])
    cur.execute(
        """INSERT INTO ra_model_cards (model_id, version, trained_at, algorithm, n_train, n_test, auc, pr_auc, notes, metrics, is_synthetic)
           VALUES ('autoencoder', %s, now(), 'sklearn_mlp', %s, 0, NULL, NULL,
                   'Offline sklearn MLP autoencoder on settlement features. Reconstruction error is stored; the model is not shipped to the Worker.',
                   %s::jsonb, 1)
           ON CONFLICT (model_id) DO UPDATE SET version=EXCLUDED.version, trained_at=now(), notes=EXCLUDED.notes, metrics=EXCLUDED.metrics""",
        (VERSION, int(len(Xs)), json.dumps({"n": int(len(Xs)), "flagged": int((recon_n>=0.85).sum()), "synthetic": True})),
    )
    cur.execute(
        """INSERT INTO ra_model_cards (model_id, version, trained_at, algorithm, n_train, n_test, auc, pr_auc, notes, metrics, is_synthetic)
           VALUES ('graphsage', %s, now(), 'graphsage_lite_numpy', %s, 0, NULL, NULL,
                   'Offline GraphSAGE-lite (numpy mean-aggregation, two layers). Scores are an optional enrichment and are not computed in the Worker.',
                   %s::jsonb, 1)
           ON CONFLICT (model_id) DO UPDATE SET version=EXCLUDED.version, trained_at=now(), notes=EXCLUDED.notes, metrics=EXCLUDED.metrics""",
        (VERSION, int(len(entities)), json.dumps({"n_nodes": int(len(entities)), "n_edges": int(len(edges)), "synthetic": True})),
    )
    conn.commit()
    cur.execute("SELECT public.refresh_ra_v9()")
    conn.commit()
    cur.execute("SELECT false_decline_n, false_decline_recovery, chargeback_exposure, iforest_open, retry_recovered, models_version FROM ra_ml_kpi WHERE id=1")
    print("ml_kpi", cur.fetchone(), flush=True)
    cur.execute("SELECT total_leakage, exception_count FROM ra_kpi_summary WHERE id=1")
    print("book_kpi", cur.fetchone(), flush=True)
    cur.close()
    conn.close()
    print("v9 offline train complete", flush=True)


if __name__ == "__main__":
    main()
