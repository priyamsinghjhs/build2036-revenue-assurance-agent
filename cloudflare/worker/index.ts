import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  NotFoundError,
  runAnomalyDetector,
  runAuditor,
  runEvidenceSynthesizer,
  runInvestigator,
  runRecommendationAgent,
} from "./agents";
import { listSettlements } from "./db";
import type { AgentState, Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/settlements", async (c) => {
  try {
    const settlements = await listSettlements(c.env.DB);
    return c.json({ settlements });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Could not load settlements: ${message}` }, 500);
  }
});

app.post("/api/agents/anomaly", async (c) => {
  const body = await readJson(c);
  const settlementId = requiredString(body, "settlement_id");
  const result = await runAnomalyDetector(c.env, settlementId);
  return c.json(result);
});

app.post("/api/agents/investigate", async (c) => {
  const body = await readJson(c);
  const result = await runInvestigator(c.env, {
    settlement_id: requiredString(body, "settlement_id"),
    anomaly_result: optionalString(body, "anomaly_result"),
    audit_trail: optionalTrail(body),
  });
  return c.json(result);
});

app.post("/api/agents/evidence", async (c) => {
  const body = await readJson(c);
  const result = await runEvidenceSynthesizer(c.env, {
    investigation: optionalString(body, "investigation"),
    audit_trail: optionalTrail(body),
  });
  return c.json(result);
});

app.post("/api/agents/recommend", async (c) => {
  const body = await readJson(c);
  const result = await runRecommendationAgent(c.env, {
    evidence: optionalString(body, "evidence"),
    audit_trail: optionalTrail(body),
  });
  return c.json(result);
});

app.post("/api/agents/audit", async (c) => {
  const body = await readJson(c);
  const result = await runAuditor(c.env, {
    evidence: optionalString(body, "evidence"),
    recommendation: optionalString(body, "recommendation"),
    audit_trail: optionalTrail(body),
  });
  return c.json(result);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404);
  }
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
