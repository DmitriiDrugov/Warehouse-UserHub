/**
 * LLM provider dispatcher (§1). Picks an implementation based on env:
 *
 *   LLM_PROVIDER=openrouter → OpenRouterProvider
 *   LLM_PROVIDER=anthropic  → AnthropicProvider
 *
 * The single instance is cached for the process lifetime — fetch reuses
 * keepalive sockets per origin so no extra pool is needed.
 */

import { serverEnv } from "../env";
import { AnthropicProvider } from "./anthropic";
import { OpenRouterProvider } from "./openrouter";
import type { LLMProvider } from "./types";

let cached: LLMProvider | undefined;

export function getLLM(): LLMProvider {
  if (cached) return cached;
  const env = serverEnv();
  switch (env.LLM_PROVIDER) {
    case "openrouter":
      cached = new OpenRouterProvider({
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL,
        baseUrl: env.LLM_BASE_URL,
      });
      break;
    case "anthropic":
      cached = new AnthropicProvider({
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL,
        baseUrl: env.LLM_BASE_URL,
      });
      break;
    default: {
      const _exhaust: never = env.LLM_PROVIDER;
      throw new Error(`unknown LLM_PROVIDER: ${String(_exhaust)}`);
    }
  }
  return cached;
}

export type { LLMProvider, LLMMessage, CompleteOptions } from "./types";
export { LLMError } from "./types";
