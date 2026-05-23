/**
 * Tolerant JSON extractor for LLM outputs. Models often wrap the JSON in
 * ```json fences``` or add prose; we accept those forms but never anything
 * that would silently evaluate code (no eval). After extraction we hand off
 * to Zod for the actual validation.
 */

import type { z } from "zod";
import type { CompleteOptions, LLMMessage, LLMProvider } from "./types";
import { LLMError } from "./types";

export async function runCompleteJSON<T>(
  provider: LLMProvider,
  messages: LLMMessage[],
  schema: z.ZodType<T>,
  options: CompleteOptions,
): Promise<T> {
  const askJson: LLMMessage = {
    role: "system",
    content:
      "Respond with a single JSON value (no prose, no code fences) matching the schema described in the user message.",
  };
  const augmented = [askJson, ...messages];

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messagesToSend: LLMMessage[] =
      attempt === 0
        ? augmented
        : [
            ...augmented,
            {
              role: "user",
              content:
                `Your previous response was not valid JSON for the schema (error: ${lastError?.message ?? "unknown"}). ` +
                `Respond again with ONLY a single valid JSON value — no fences, no commentary.`,
            },
          ];

    const text = await provider.complete(messagesToSend, options);
    const candidate = extractJsonBlock(text) ?? text;
    try {
      const parsedRaw = JSON.parse(candidate);
      const validated = schema.parse(parsedRaw);
      return validated;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new LLMError(
    `LLM JSON output failed schema validation after 2 attempts: ${lastError?.message ?? "unknown"}`,
    { detail: lastError },
  );
}

export function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Fenced ```json … ``` or ``` … ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // 2. Raw object/array at top level
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  // 3. Find first balanced { ... } region
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) return null;
  let depth = 0;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(firstBrace, i + 1);
    }
  }
  return null;
}
