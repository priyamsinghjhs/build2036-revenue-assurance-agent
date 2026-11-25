/**
 * Combined investigation: gather evidence once, stream step results, cache per case.
 */
import type { AgentId } from "./agentRoster";
import { completeRun, runAgentStep, startRun, getCachedExceptionInput } from "./agentRunner";
import { getDb } from "./pg";
import type { Env } from "./types";

export const INVESTIGATE_STEPS = ["investigator", "action", "auditor"] as const;
export type InvestigateStepId = (typeof INVESTIGATE_STEPS)[number];

export type InvestigateEvent =
  | { type: "evidence"; cache_hit: boolean; exception: unknown; timing_ms: number }
  | { type: "step"; agent_id: InvestigateStepId; output: Record<string, unknown>; timing?: unknown }
  | { type: "done"; run_id: string; timing_ms: number }
  | { type: "error"; message: string; agent_id?: string };

export async function prefetchEvidence(env: Env, exceptionId: string) {
  const t0 = Date.now();
  const { input, cache_hit } = await getCachedExceptionInput(env, exceptionId);
  const rec = input as Record<string, unknown>;
  return {
    exception_id: exceptionId,
    cache_hit,
    exception: rec.exception ?? null,
    network_links: rec.network_links ?? rec.graph_tools ?? null,
    policy: rec.policy ?? null,
    timing_ms: Date.now() - t0,
  };
}

export async function runInvestigation(
  env: Env,
  opts: {
    exceptionId: string;
    domain?: string;
    runId?: string;
    mode?: "llm" | "deterministic";
    resume?: boolean;
    onEvent?: (ev: InvestigateEvent) => void | Promise<void>;
  },
) {
  const t0 = Date.now();
  const db = getDb(env);
  const [ev, started] = await Promise.all([
    prefetchEvidence(env, opts.exceptionId),
    opts.runId ? Promise.resolve(null) : startRun(db, `exception:${opts.exceptionId}`),
  ]);
  await opts.onEvent?.({ type: "evidence", cache_hit: ev.cache_hit, exception: ev.exception, timing_ms: ev.timing_ms });
  const runId = opts.runId || started?.run_id || "";

  const outputs: Record<string, Record<string, unknown>> = {};
  const timings: Record<string, unknown> = {};
  const runStep = async (agentId: InvestigateStepId) => {
    const step = await runAgentStep(env, {
      runId,
      agentId: agentId as AgentId,
      scope: `exception:${opts.exceptionId}`,
      domain: opts.domain,
      exceptionId: opts.exceptionId,
      mode: opts.mode,
    });
    const output = (step.output ?? {}) as Record<string, unknown>;
    outputs[agentId] = output;
    timings[agentId] = output.timing ?? null;
    await opts.onEvent?.({ type: "step", agent_id: agentId, output, timing: output.timing });
  };
  if (opts.mode === "deterministic") {
    // Deterministic investigator and action read only the exception facts, not each
    // other's output, so they run together; the auditor still runs last over both.
    await Promise.all([runStep("investigator"), runStep("action")]);
    await runStep("auditor");
  } else {
    for (const agentId of INVESTIGATE_STEPS) await runStep(agentId);
  }
  await completeRun(db, runId);
  const timing_ms = Date.now() - t0;
  await opts.onEvent?.({ type: "done", run_id: runId, timing_ms });
  return { run_id: runId, outputs, timings, timing_ms, cache_hit: ev.cache_hit };
}

export function sseResponse(work: (send: (event: string, data: unknown) => Promise<void>) => Promise<void>): Response {
  const g = globalThis as unknown as {
    TransformStream: new () => {
      readable: unknown;
      writable: { getWriter: () => { write: (c: Uint8Array) => Promise<void>; close: () => Promise<void> } };
    };
    TextEncoder: new () => { encode: (s: string) => Uint8Array };
  };
  const { readable, writable } = new g.TransformStream();
  const writer = writable.getWriter();
  const enc = new g.TextEncoder();
  const send = async (event: string, data: unknown) => {
    await writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  void work(send)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await send("error", { message });
      } catch {
        /* stream already closed */
      }
    })
    .finally(async () => {
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    });
  return new Response(readable as never, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
