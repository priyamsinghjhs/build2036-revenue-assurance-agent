/**
 * Cloudflare Containers Worker for the Streamlit revenue-assurance app.
 *
 * Uses the current Durable Object Container API (the @cloudflare/containers
 * package is deprecated). All HTTP and WebSocket traffic is forwarded to a
 * single named container instance so Streamlit sessions stick.
 */
import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const INSTANCE_NAME = "app";

export interface Env {
  REVENUE_ASSURANCE: DurableObjectNamespace;
  LLM_PROVIDER: string;
  CLOUDFLARE_MODEL: string;
  CF_ACCOUNT_ID: string;
  CF_AI_API_TOKEN: string;
}

export class RevenueAssuranceContainer extends DurableObject<Env> {
  starting?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Container binding is not available on this Durable Object");
    }

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env: {
          LLM_PROVIDER: this.env.LLM_PROVIDER ?? "cloudflare",
          CLOUDFLARE_MODEL:
            this.env.CLOUDFLARE_MODEL ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
          CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID ?? "",
          CF_AI_API_TOKEN: this.env.CF_AI_API_TOKEN ?? "",
        },
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch("http://container/_stcore/health", {
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) {
          return;
        }
        lastError = new Error(`Health check returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(200);
    }
    throw new Error("Container did not become ready on port 8080", {
      cause: lastError,
    });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // One named instance so Streamlit WebSocket sessions stay sticky.
    return env.REVENUE_ASSURANCE.getByName(INSTANCE_NAME).fetch(request);
  },
};
