/**
 * Pure TypeScript GBDT / isolation-forest evaluator + path-attribution SHAP.
 * No WASM. Trees come from tools/offline/train_models.py.
 */

export type TreeNode = {
  feature?: number;
  threshold?: number;
  left?: number;
  right?: number;
  leaf?: number;
  cover?: number;
};

export type Tree = { nodes: TreeNode[] };

export type GbdtModel = {
  model_id: string;
  version: string;
  algorithm: string;
  objective: "binary" | "raw" | "iforest";
  base_score: number;
  features: string[];
  trees: Tree[];
  n_samples?: number;
  metrics?: Record<string, unknown>;
  self_check?: { x: Record<string, number>; pred: number; shap_sum?: number };
};

export type ShapFactor = { feature: string; value: number; shap: number };

function expectedValue(tree: Tree, i = 0): number {
  const n = tree.nodes[i];
  if (!n) return 0;
  if (n.leaf != null) return n.leaf;
  const cl = n.left ?? -1, cr = n.right ?? -1;
  const left = tree.nodes[cl], right = tree.nodes[cr];
  const clc = left?.cover ?? 1, crc = right?.cover ?? 1;
  const tot = clc + crc || 1;
  return (expectedValue(tree, cl) * clc + expectedValue(tree, cr) * crc) / tot;
}

export function rawPredictTree(tree: Tree, x: number[]): number {
  let i = 0;
  for (let step = 0; step < tree.nodes.length + 2; step++) {
    const n = tree.nodes[i];
    if (!n) return 0;
    if (n.leaf != null) return n.leaf;
    const v = x[n.feature ?? 0] ?? 0;
    i = v <= (n.threshold ?? 0) ? (n.left ?? 0) : (n.right ?? 0);
  }
  return 0;
}

export function rawPredict(model: GbdtModel, x: number[]): number {
  let s = model.base_score || 0;
  for (const t of model.trees) s += rawPredictTree(t, x);
  return s;
}

export function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function harmonic(n: number): number {
  return n <= 0 ? 0 : Math.log(n) + 0.5772156649;
}

export function iforestScore(model: GbdtModel, x: number[]): number {
  const n = model.n_samples || 256;
  const c = Math.max(2 * harmonic(n - 1) - (2 * (n - 1)) / n, 1e-6);
  const avg = model.trees.length ? rawPredict(model, x) / model.trees.length : 0;
  return Math.pow(2, -avg / c);
}

export function predictProba(model: GbdtModel, x: number[]): number {
  if (model.objective === "iforest") return iforestScore(model, x);
  const raw = rawPredict(model, x);
  return model.objective === "binary" ? sigmoid(raw) : raw;
}

/** Path-attribution: at each split on the taken path, credit (child expected − node expected). Sums to leaf − E[tree]. */
export function pathShapTree(tree: Tree, x: number[]): number[] {
  const maxF = tree.nodes.reduce((m, n) => Math.max(m, n.feature ?? -1), -1) + 1;
  const phi = new Array(Math.max(maxF, 1)).fill(0);
  let i = 0;
  for (let step = 0; step < tree.nodes.length + 2; step++) {
    const n = tree.nodes[i];
    if (!n || n.leaf != null) break;
    const ev = expectedValue(tree, i);
    const v = x[n.feature ?? 0] ?? 0;
    const child = v <= (n.threshold ?? 0) ? (n.left ?? 0) : (n.right ?? 0);
    const childEv = expectedValue(tree, child);
    const f = n.feature ?? 0;
    if (f >= 0) {
      if (f >= phi.length) {
        phi.length = f + 1;
        phi[f] = 0;
      }
      phi[f] += childEv - ev;
    }
    i = child;
  }
  return phi;
}

export function explain(model: GbdtModel, x: number[]): {
  raw: number;
  score: number;
  base: number;
  shap: ShapFactor[];
  top: ShapFactor[];
  shapSum: number;
} {
  const nF = model.features.length;
  const phi = new Array(nF).fill(0);
  let base = model.base_score || 0;
  if (model.objective === "iforest") {
    const score = iforestScore(model, x);
    return { raw: score, score, base: 0, shap: [], top: [], shapSum: 0 };
  }
  for (const t of model.trees) {
    base += expectedValue(t);
    const s = pathShapTree(t, x);
    for (let i = 0; i < nF; i++) phi[i] += s[i] ?? 0;
  }
  const raw = rawPredict(model, x);
  const shap: ShapFactor[] = model.features.map((feature, i) => ({
    feature,
    value: x[i] ?? 0,
    shap: phi[i] ?? 0,
  }));
  const shapSum = shap.reduce((a, b) => a + b.shap, 0);
  const top = [...shap].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)).slice(0, 5);
  return { raw, score: model.objective === "binary" ? sigmoid(raw) : raw, base, shap, top, shapSum };
}

export function vectorize(model: GbdtModel, row: Record<string, unknown>): number[] {
  return model.features.map((f) => {
    const v = row[f];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  });
}

export function scoreRow(model: GbdtModel, row: Record<string, unknown>) {
  const x = vectorize(model, row);
  const exp = explain(model, x);
  return {
    model_id: model.model_id,
    version: model.version,
    score: exp.score,
    raw_score: exp.raw,
    base_value: exp.base,
    shap: exp.shap,
    top_factors: exp.top,
    shap_sum: exp.shapSum,
    check: model.objective === "iforest" ? true : Math.abs(exp.shapSum + exp.base - exp.raw) < 1e-5,
  };
}

export const FEATURES = [
  "amount", "log_amount", "hour", "dow",
  "merchant_txn_1d", "merchant_amt_1d", "merchant_txn_7d", "merchant_amt_7d",
  "merchant_approval_7d", "merchant_decline_7d", "merch_amt_z",
  "mcc_approval", "mcc_spend_ratio",
  "is_retry", "retry_n_30m",
  "acquirer_approval", "scheme_approval", "method_approval",
  "merchant_cb_rate", "graph_risk", "shared_device_n", "ring_flag", "loop_flag",
  "fee_ratio_dev", "fx_markup_dev", "is_emi",
] as const;
