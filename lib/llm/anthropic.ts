import type { z } from "zod";

import { runCompleteJSON } from "./json-extract";
import {
  type CompleteOptions,
  type LLMMessage,
  type LLMProvider,
  LLMError,
} from "./types";

const DEFAULT_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string; type?: string };
};

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
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
    // Anthropic's /v1/messages takes `system` as a separate top-level field
    // and only allows user|assistant in `messages`. Split accordingly.
    const systemParts: string[] = [];
    const userAssistant: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of messages) {
      if (m.role === "system") systemParts.push(m.content);
      else userAssistant.push({ role: m.role, content: m.content });
    }
    if (userAssistant.length === 0) {
      throw new LLMError("at least one user/assistant message required");
    }

    const body = JSON.stringify({
      model: options.model ?? this.model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.2,
      system: systemParts.join("\n\n") || undefined,
      messages: userAssistant,
      stop_sequences: options.stop,
    });

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 30_000);
    const signal = options.signal ?? timeoutController.signal;

    try {
      const res = await fetch(`${this.#baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body,
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new LLMError(`Anthropic ${res.status}: ${text}`, {
          status: res.status,
          detail: text,
        });
      }
      const json = (await res.json()) as AnthropicResponse;
      if (json.error) {
        throw new LLMError(`Anthropic error: ${json.error.message ?? "unknown"}`);
      }
      const text = (json.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text!)
        .join("");
      if (text.length === 0) {
        throw new LLMError("Anthropic returned empty content", { detail: json });
      }
      return text;
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
