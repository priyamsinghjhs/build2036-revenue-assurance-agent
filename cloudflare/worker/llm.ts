import { MAX_TOKENS, MODEL, TEMPERATURE, type AiBinding } from "./types";

export async function complete(ai: AiBinding, prompt: string): Promise<string> {
  const result = await ai.run(MODEL, {
    messages: [{ role: "user", content: prompt }],
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  });
  const text = extractText(result);
  if (!text) {
    throw new Error("Workers AI returned an empty response");
  }
  return text;
}

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const rec = result as Record<string, unknown>;
  if (typeof rec.response === "string") return rec.response;
  if (typeof rec.result === "string") return rec.result;
  if (rec.response && typeof rec.response === "object") {
    const inner = rec.response as Record<string, unknown>;
    if (typeof inner.response === "string") return inner.response;
  }
  return "";
}
