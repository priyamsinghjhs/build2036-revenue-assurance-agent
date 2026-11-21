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
  systemMap,
  type AreaId,
} from "./recon";
import type { AgentState, Env } from "./types";
import { getDb } from "./pg";
import { cachedJson, invalidateMem } from "./cache";
import { executiveSummary, listFilterOptions } from "./executive";
import { latestAutomation, runDailyAutomation, setActionStatus } from "./automation";
import { traceJourney } from "./trace";
import { networkExportCsv, networkRisk } from "./network";
import { publicErrorMessage } from "../shared/errors";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, synthetic: true }));

app.get("/api/filters", async (c) => c.json(await listFilterOptions(getDb(c.env))));

app.get("/api/executive", async (c) => {
  return cachedJson(
    "executive",
    async () => executiveSummary(getDb(c.env)),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.post("/api/automation/run", async (c) => {
  const result = await runDailyAutomation(c.env, { force: true });
  invalidateMem();
  return c.json(result, result.ok ? 200 : 500);
});

app.get("/api/automation/latest", async (c) => {
  try {
    const latest = await latestAutomation(getDb(c.env));
    return c.json({ latest });
  } catch {
    return c.json({ latest: null });
  }
});

app.post("/api/actions/:id/decision", async (c) => {
  const body = await readJson(c);
  const status = requiredString(body, "status");
  if (!["approved", "rejected", "done"].includes(status)) {
    throw new HTTPException(400, { message: "status must be approved, rejected, or done" });
  }
  const ok = await setActionStatus(
    getDb(c.env),
    c.req.param("id"),
    status as "approved" | "rejected" | "done",
    optionalString(body, "note") || undefined,
  );
  if (!ok) throw new HTTPException(404, { message: "Action not found" });
  invalidateMem();
  return c.json({ ok: true, action_id: c.req.param("id"), status });
});


app.get("/api/dashboard/overview", async (c) => {
  return cachedJson(
    "overview",
    async () => {
      const db = getDb(c.env);
      const [kpis, areas, byCategory, trend, flow] = await Promise.all([
        kpiCounts(db),
        summarizeAll(db),
        leakageByCategory(db),
        leakageTrend(db),
        moneyFlow(db),
      ]);
      return {
        synthetic: true,
        kpis: {
          total_leakage: kpis.total_leakage,
          recovery_potential: kpis.recovery_potential,
          match_rate: kpis.match_rate,
          exception_count: kpis.exception_count,
          auth_count: kpis.auth_count,
          merchant_count: kpis.merchant_count,
        },
        areas,
        by_category: byCategory,
        trend,
        flow,
      };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/system-map", async (c) => {
  return cachedJson(
    "system-map",
    async () => ({ synthetic: true, ...(await systemMap(getDb(c.env))) }),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/areas", (c) =>
  c.json({
    areas: AREA_IDS.map((id) => ({ id, ...AREA_META[id] })),
  }),
);

app.get("/api/areas/:id", async (c) => {
  const id = c.req.param("id") as AreaId;
  if (!AREA_IDS.includes(id)) throw new HTTPException(404, { message: "Unknown area" });
  return cachedJson(
    `area:${id}`,
    async () => {
      const db = getDb(c.env);
      const [summary, exceptions, series] = await Promise.all([
        summarizeArea(db, id),
        listExceptions(db, id, 100),
        areaSeries(db, id),
      ]);
      return { synthetic: true, meta: AREA_META[id], summary, series, exceptions };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/exceptions/:id", async (c) => {
  const row = await getException(getDb(c.env), c.req.param("id"));
  if (!row) throw new NotFoundError("Exception not found");
  return c.json({ exception: row });
});

app.get("/api/agents/roster", (c) =>
  c.json({ agents: AGENT_ROSTER, edges: AGENT_GRAPH_EDGES, run_all: RUN_ALL_SEQUENCE }),
);

app.get("/api/agents/latest", async (c) => {
  const scope = c.req.query("scope") ?? undefined;
  const latest = await latestRun(getDb(c.env), scope);
  return c.json({ latest });
});

app.get("/api/actions", async (c) => {
  const actions = await listActions(getDb(c.env));
  return c.json({ actions });
});

app.post("/api/agents/runs", async (c) => {
  const body = await readJson(c);
  const scope = optionalString(body, "scope") || "all";
  const run = await startRun(getDb(c.env), scope);
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
  await completeRun(getDb(c.env), runId);
  return c.json({ ok: true, run_id: runId, status: "completed" });
});

// Legacy settlement + 5-agent endpoints (still used if a settlement is investigated)
app.get("/api/settlements", async (c) => {
  try {
    const settlements = await listSettlements(getDb(c.env));
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

app.get("/api/controls", async (c) => {
  return cachedJson(
    "controls",
    async () => {
      const db = getDb(c.env);
      const { results: rows } = await db
        .prepare(
          `SELECT c.control_id, c.name, c.objective, c.domain, c.owner, c.frequency, c.threshold,
                  s.last_run, s.status, s.exception_count, s.leakage, s.trend, s.coverage
           FROM ra_controls c
           LEFT JOIN ra_control_status s ON s.control_id = c.control_id
           ORDER BY CASE WHEN s.status = 'fail' THEN 0 ELSE 1 END, s.leakage DESC NULLS LAST, c.domain, c.name`,
        )
        .all<Record<string, unknown>>();
      const { results: byDomain } = await db
        .prepare(
          `SELECT c.domain,
                  COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE s.status = 'pass')::int AS passing,
                  COUNT(*) FILTER (WHERE s.status = 'fail')::int AS failing,
                  COALESCE(SUM(s.leakage),0) AS leakage
           FROM ra_controls c
           LEFT JOIN ra_control_status s ON s.control_id = c.control_id
           GROUP BY c.domain
           ORDER BY c.domain`,
        )
        .all<Record<string, unknown>>();
      const gov = await db.prepare("SELECT * FROM ra_governance_kpi WHERE id = 1").first<Record<string, unknown>>();
      return { synthetic: true, controls: rows ?? [], by_domain: byDomain ?? [], kpis: gov };
    },
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/trace", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ query: "", resolved: null, steps: [] });
  return c.json(await traceJourney(getDb(c.env), q));
});

app.get("/api/network-risk", async (c) => {
  return cachedJson(
    "network-risk",
    async () => networkRisk(getDb(c.env)),
    120_000,
    (p) => c.executionCtx.waitUntil(p),
  );
});

app.get("/api/network-risk/export", async (c) => {
  const kind = c.req.query("kind") === "edges" ? "edges" : "nodes";
  const csv = await networkExportCsv(getDb(c.env), kind);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="network-risk-${kind}.csv"`,
    },
  });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  return c.json({ error: publicErrorMessage(err) }, 500);
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
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runDailyAutomation(env, { force: false }).then(() => invalidateMem()));
}

export default {
  fetch: app.fetch,
  scheduled,
};

