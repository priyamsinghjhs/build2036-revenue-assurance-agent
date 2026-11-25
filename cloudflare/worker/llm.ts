import { MAX_TOKENS, MODEL, TEMPERATURE, type AiBinding } from "./types";

export type CompleteOpts = { json?: boolean; max_tokens?: number; timeout_ms?: number };

export const DEFAULT_AI_TIMEOUT_MS = 12_000;

export class WorkersAIError extends Error {
  readonly kind: "timeout" | "empty" | "cap" | "failed";
  constructor(message: string, kind: "timeout" | "empty" | "cap" | "failed" = "failed") {
    super(message);
    this.name = "WorkersAIError";
    this.kind = kind;
  }
}

export function isWorkersAIError(err: unknown): err is WorkersAIError {
  return err instanceof WorkersAIError;
}

export function classifyAIError(err: unknown): WorkersAIError {
  if (err instanceof WorkersAIError) return err;
  const raw = err instanceof Error ? err.message : String(err ?? "Workers AI failed");
  if (/timed out|timeout|aborted/i.test(raw)) return new WorkersAIError(raw, "timeout");
  if (/neuron|quota|rate limit|capacity|exceeded|throttl/i.test(raw)) return new WorkersAIError(raw, "cap");
  return new WorkersAIError(raw, "failed");
}

type TimerFn = {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "Workers AI"): Promise<T> {
  const timers = globalThis as unknown as TimerFn;
  return new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => {
      reject(new WorkersAIError(`${label} timed out after ${ms}ms`, "timeout"));
    }, ms);
    promise.then(
      (value) => {
        timers.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        timers.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function complete(ai: AiBinding, prompt: string, opts: CompleteOpts = {}): Promise<string> {
  const inputs: Record<string, unknown> = {
    messages: [{ role: "user", content: prompt }],
    temperature: TEMPERATURE,
    max_tokens: opts.max_tokens ?? MAX_TOKENS,
  };
  if (opts.json) {
    inputs.response_format = { type: "json_object" };
  }
  const timeoutMs = opts.timeout_ms ?? DEFAULT_AI_TIMEOUT_MS;
  let result: unknown;
  try {
    result = await withTimeout(Promise.resolve(ai.run(MODEL, inputs)), timeoutMs, "Workers AI");
  } catch (err) {
    const classified = classifyAIError(err);
    if (opts.json && classified.kind !== "timeout" && classified.kind !== "cap") {
      // Some Workers AI accounts/models reject response_format; retry without it.
      delete inputs.response_format;
      try {
        result = await withTimeout(Promise.resolve(ai.run(MODEL, inputs)), timeoutMs, "Workers AI");
      } catch (retryErr) {
        throw classifyAIError(retryErr);
      }
    } else {
      throw classified;
    }
  }
  const text = extractText(result);
  if (!text) {
    throw new WorkersAIError(describeEmpty(result), "empty");
  }
  return text;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in (part as object)) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        if (part && typeof part === "object" && "content" in (part as object)) {
          const content = (part as { content?: unknown }).content;
          return typeof content === "string" ? content : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const rec = result as Record<string, unknown>;

  const direct = textFromUnknown(rec.response) || textFromUnknown(rec.result) || textFromUnknown(rec.content);
  if (direct.trim()) return direct;

  if (rec.response && typeof rec.response === "object") {
    const inner = rec.response as Record<string, unknown>;
    const text = textFromUnknown(inner.response) || textFromUnknown(inner.content);
    if (text.trim()) return text;
  }
  if (rec.result && typeof rec.result === "object") {
    const inner = rec.result as Record<string, unknown>;
    const text = textFromUnknown(inner.response) || textFromUnknown(inner.content);
    if (text.trim()) return text;
  }

  if (Array.isArray(rec.choices) && rec.choices.length) {
    for (const raw of rec.choices) {
      if (!raw || typeof raw !== "object") continue;
      const choice = raw as Record<string, unknown>;
      const fromChoice =
        textFromUnknown(choice.text) ||
        textFromUnknown(choice.content) ||
        (choice.message && typeof choice.message === "object"
          ? textFromUnknown((choice.message as Record<string, unknown>).content)
          : "") ||
        (choice.delta && typeof choice.delta === "object"
          ? textFromUnknown((choice.delta as Record<string, unknown>).content)
          : "");
      if (fromChoice.trim()) return fromChoice;
    }
  }
  return "";
}

function describeEmpty(result: unknown): string {
  if (result == null) return "Workers AI returned an empty response";
  if (typeof result !== "object") return `Workers AI returned ${typeof result}`;
  const rec = result as Record<string, unknown>;
  const bits: string[] = [];
  bits.push(`keys=${Object.keys(rec).join(",")}`);
  bits.push(`response_type=${rec.response === null ? "null" : typeof rec.response}`);
  if (Array.isArray(rec.choices)) {
    bits.push(`choices=${rec.choices.length}`);
    const first = rec.choices[0];
    if (first && typeof first === "object") {
      const c = first as Record<string, unknown>;
      bits.push(`choice_keys=${Object.keys(c).join(",")}`);
      if (c.finish_reason) bits.push(`finish_reason=${String(c.finish_reason)}`);
      if (c.message && typeof c.message === "object") {
        bits.push(`message_keys=${Object.keys(c.message as object).join(",")}`);
      }
    }
  }
  if (rec.usage && typeof rec.usage === "object") {
    bits.push(`usage=${JSON.stringify(rec.usage).slice(0, 200)}`);
  }
  if (rec.error) bits.push(`error=${JSON.stringify(rec.error).slice(0, 300)}`);
  if (rec.errors) bits.push(`errors=${JSON.stringify(rec.errors).slice(0, 300)}`);
  return `Workers AI empty response (${bits.join("; ")})`;
}
