import type { AppDb } from "./pg";

export async function networkRisk(db: AppDb) {
  const { results: nodes } = await db
    .prepare(
      "SELECT entity_id AS id, entity_type AS kind, label, merchant_id, risk_score, is_known_bad FROM ra_risk_entities ORDER BY risk_score DESC",
    )
    .all<Record<string, unknown>>();
  const { results: edges } = await db
    .prepare("SELECT edge_id AS id, src, dst, rel, weight FROM ra_risk_edges")
    .all<Record<string, unknown>>();
  const { results: proximity } = await db
    .prepare(
      `WITH RECURSIVE walk AS (
         SELECT entity_id, 0 AS dist FROM ra_risk_entities WHERE is_known_bad = 1
         UNION
         SELECT CASE WHEN e.src = w.entity_id THEN e.dst ELSE e.src END AS entity_id, w.dist + 1
         FROM ra_risk_edges e
         JOIN walk w ON e.src = w.entity_id OR e.dst = w.entity_id
         WHERE w.dist < 3
       )
       SELECT entity_id, MIN(dist) AS dist
       FROM walk
       WHERE dist > 0
       GROUP BY entity_id
       ORDER BY dist, entity_id`,
    )
    .all<{ entity_id: string; dist: number }>()
    .catch(() => ({ results: [] as { entity_id: string; dist: number }[] }));
  return {
    synthetic: true,
    note: "A GNN can be trained offline (for example PyTorch Geometric in Colab) on real production data later. This graph is scored with Postgres recursive CTEs only — no paid ML infra.",
    nodes: nodes ?? [],
    edges: edges ?? [],
    proximity: proximity ?? [],
  };
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function networkExportCsv(db: AppDb, kind: "nodes" | "edges"): Promise<string> {
  const graph = await networkRisk(db);
  if (kind === "edges") {
    const rows = graph.edges as Record<string, unknown>[];
    const header = "id,src,dst,rel,weight";
    const body = rows.map((r) => [r.id, r.src, r.dst, r.rel, r.weight].map(csvEscape).join(","));
    return [header, ...body].join("\n") + "\n";
  }
  const rows = graph.nodes as Record<string, unknown>[];
  const header = "id,kind,label,merchant_id,risk_score,is_known_bad";
  const body = rows.map((r) => [r.id, r.kind, r.label, r.merchant_id, r.risk_score, r.is_known_bad].map(csvEscape).join(","));
  return [header, ...body].join("\n") + "\n";
}
