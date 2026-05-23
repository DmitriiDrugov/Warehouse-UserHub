/**
 * Provider-agnostic LLM interface.
 *
 *   complete(input)            → plain text completion
 *   completeJSON<T>(input, s)  → Zod-validated structured output
 *
 * Implementations live in lib/llm/openrouter.ts and lib/llm/anthropic.ts.
 * `getLLM()` in lib/llm/index.ts picks one based on env var LLM_PROVIDER.
 *
 * Treat every LLM response as untrusted (§0.3, §8). `completeJSON` is
 * the safe path — it validates against the supplied Zod schema and
 * retries once on parse failure with an explicit "fix your JSON" message.
 */

import type { z } from "zod";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompleteOptions = {
  /** Override the configured LLM_MODEL for this call. */
  model?: string;
  /** Stop sequences. */
  stop?: string[];
  /** Sampling temperature. Default 0.2 — we generally want deterministic-ish output. */
  temperature?: number;
  /** Max tokens to generate. Default 1024. */
  maxTokens?: number;
  /** Abort signal — cancels the HTTP request. */
  signal?: AbortSignal;
};

export interface LLMProvider {
  readonly name: "openrouter" | "anthropic";
  readonly model: string;

  complete(
    messages: LLMMessage[],
    options?: CompleteOptions,
  ): Promise<string>;

  completeJSON<T>(
    messages: LLMMessage[],
    schema: z.ZodType<T>,
    options?: CompleteOptions,
  ): Promise<T>;
}

export class LLMError extends Error {
  readonly status?: number;
  readonly detail?: unknown;

  constructor(message: string, opts?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = "LLMError";
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}
