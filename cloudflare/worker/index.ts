import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AGENT_GRAPH_EDGES, AGENT_ROSTER, RUN_ALL_SEQUENCE, sequenceForDomain, type AgentId } from "./agentRoster";
import { completeRun, latestRun, listActions, runAgentStep, startRun } from "./agentRunner";
import {
  NotFoundError,
  runAnomalyDetector,
  runAuditor,
  runEvidenceSynthesizer,
  runInvestigator,
  runRecommendationAgent,
} from "./agents";
import { listSettlements } from "./db";
import {
  AREA_IDS,
  AREA_META,
  areaSeries,
  getException,
  kpiCounts,
  leakageByCategory,
  leakageTrend,
  listExceptions,
  moneyFlow,
  summarizeAll,
  summarizeArea,
  type AreaId,
} from "./recon";
import type { AgentState, Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, synthetic: true }));

app.get("/api/dashboard/overview", async (c) => {
  const [kpis, areas, byCategory, trend, flow] = await Promise.all([
    kpiCounts(c.env.DB),
    summarizeAll(c.env.DB),
    leakageByCategory(c.env.DB),
    leakageTrend(c.env.DB),
    moneyFlow(c.env.DB),
  ]);
  const totalLeakage = areas.reduce((s, a) => s + a.leakage, 0);
  const recov = areas.filter((a) => a.leakage > 0).reduce((s, a) => s + a.leakage, 0);
  const matched = areas.reduce((s, a) => s + a.matched, 0);
  const total = areas.reduce((s, a) => s + a.matched + a.unmatched + a.variance, 0);
  return c.json({
    synthetic: true,
    kpis: {
      total_leakage: Math.round(totalLeakage * 100) / 100,
      recovery_potential: Math.round(recov * 100) / 100,
      match_rate: total ? matched / total : 1,
      exception_count: kpis.exception_count,
      auth_count: kpis.auth_count,
      merchant_count: kpis.merchant_count,
    },
    areas,
    by_category: byCategory,
    trend,
    flow,
  });
});

app.get("/api/areas", (c) =>
  c.json({
    areas: AREA_IDS.map((id) => ({ id, ...AREA_META[id] })),
  }),
);

app.get("/api/areas/:id", async (c) => {
  const id = c.req.param("id") as AreaId;
  if (!AREA_IDS.includes(id)) throw new HTTPException(404, { message: "Unknown area" });
  const [summary, exceptions, series] = await Promise.all([
    summarizeArea(c.env.DB, id),
    listExceptions(c.env.DB, id, 100),
    areaSeries(c.env.DB, id),
  ]);
  return c.json({ synthetic: true, meta: AREA_META[id], summary, series, exceptions });
});

app.get("/api/exceptions/:id", async (c) => {
  const row = await getException(c.env.DB, c.req.param("id"));
  if (!row) throw new NotFoundError("Exception not found");
  return c.json({ exception: row });
});

app.get("/api/agents/roster", (c) =>
  c.json({ agents: AGENT_ROSTER, edges: AGENT_GRAPH_EDGES, run_all: RUN_ALL_SEQUENCE }),
);

app.get("/api/agents/latest", async (c) => {
  const scope = c.req.query("scope") ?? undefined;
  const latest = await latestRun(c.env.DB, scope);
  return c.json({ latest });
});

app.get("/api/actions", async (c) => {
  const actions = await listActions(c.env.DB);
  return c.json({ actions });
});

app.post("/api/agents/runs", async (c) => {
  const body = await readJson(c);
  const scope = optionalString(body, "scope") || "all";
  const run = await startRun(c.env.DB, scope);
  const domain = optionalString(body, "domain");
  const sequence = scope === "all" ? RUN_ALL_SEQUENCE : sequenceForDomain(domain || scope);
  return c.json({ ...run, sequence });
});

app.post("/api/agents/step", async (c) => {
  const body = await readJson(c);
  const runId = requiredString(body, "run_id");
  const agentId = requiredString(body, "agent_id") as AgentId;
  if (!AGENT_ROSTER.some((a) => a.id === agentId)) {
    throw new HTTPException(400, { message: "Unknown agent_id" });
  }
  const result = await runAgentStep(c.env, {
    runId,
    agentId,
    scope: optionalString(body, "scope") || "all",
    domain: optionalString(body, "domain") || undefined,
    exceptionId: optionalString(body, "exception_id") || undefined,
  });
  return c.json(result);
});

app.post("/api/agents/complete", async (c) => {
  const body = await readJson(c);
  const runId = requiredString(body, "run_id");
  await completeRun(c.env.DB, runId);
  return c.json({ ok: true, run_id: runId, status: "completed" });
});

// Legacy settlement + 5-agent endpoints (still used if a settlement is investigated)
app.get("/api/settlements", async (c) => {
  try {
    const settlements = await listSettlements(c.env.DB);
    return c.json({ settlements });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Could not load settlements: ${message}` }, 500);
  }
});

app.post("/api/legacy/agents/anomaly", async (c) => {
  const body = await readJson(c);
  return c.json(await runAnomalyDetector(c.env, requiredString(body, "settlement_id")));
});
app.post("/api/legacy/agents/investigate", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runInvestigator(c.env, {
      settlement_id: requiredString(body, "settlement_id"),
      anomaly_result: optionalString(body, "anomaly_result"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/evidence", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runEvidenceSynthesizer(c.env, {
      investigation: optionalString(body, "investigation"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/recommend", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runRecommendationAgent(c.env, {
      evidence: optionalString(body, "evidence"),
      audit_trail: optionalTrail(body),
    }),
  );
});
app.post("/api/legacy/agents/audit", async (c) => {
  const body = await readJson(c);
  return c.json(
    await runAuditor(c.env, {
      evidence: optionalString(body, "evidence"),
      recommendation: optionalString(body, "recommendation"),
      audit_trail: optionalTrail(body),
    }),
  );
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HTTPException(400, { message: "JSON object body required" });
    }
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HTTPException(400, { message: `${key} is required` });
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function optionalTrail(body: Record<string, unknown>): string[] {
  const value = body.audit_trail;
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

export type { AgentState, Env };
export default app;
