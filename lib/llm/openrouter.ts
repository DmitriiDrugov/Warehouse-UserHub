import type { z } from "zod";

import { extractJsonBlock, runCompleteJSON } from "./json-extract";
import {
  type CompleteOptions,
  type LLMMessage,
  type LLMProvider,
  LLMError,
} from "./types";

const DEFAULT_URL = "https://openrouter.ai/api/v1";

type ChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(opts: { apiKey: string; model: string; baseUrl?: string }) {
    this.#apiKey = opts.apiKey;
    this.model = opts.model;
    this.#baseUrl = (opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, "");
  }

  async complete(
    messages: LLMMessage[],
    options: CompleteOptions = {},
  ): Promise<string> {
    const url = `${this.#baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: options.model ?? this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1024,
      stop: options.stop,
    });

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 30_000);
    const signal = options.signal ?? timeoutController.signal;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/warehouse-userhub",
          "X-Title": "Warehouse UserHub",
        },
        body,
        signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new LLMError(`OpenRouter ${res.status}: ${text}`, {
          status: res.status,
          detail: text,
        });
      }
      const json = (await res.json()) as ChatResponse;
      if (json.error) {
        throw new LLMError(`OpenRouter error: ${json.error.message ?? "unknown"}`);
      }
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new LLMError("OpenRouter returned empty content", { detail: json });
      }
      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async completeJSON<T>(
    messages: LLMMessage[],
    schema: z.ZodType<T>,
    options: CompleteOptions = {},
  ): Promise<T> {
    return await runCompleteJSON(this, messages, schema, options);
  }
}


