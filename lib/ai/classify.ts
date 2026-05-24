/**
 * Classify a free-form warehouse admin message into one of three intent types.
 * Used by the AI chat page to route messages to the correct handler.
 */

import { getLLM } from "../llm";

export type IntentType = "query" | "provision" | "update" | "unsupported";

const VALID_INTENTS = new Set<IntentType>([
  "query",
  "provision",
  "update",
  "unsupported",
]);

const SYSTEM_PROMPT = `You are classifying a warehouse admin request into exactly one of:
- "query"       — user wants to look up, list, search, or export data
- "provision"   — user wants to create a new warehouse worker
- "update"      — user wants to assign or record a certificate for existing worker(s)
- "unsupported" — anything else (bulk delete, role changes, access revocation, off-topic)

Respond with one lowercase word only. No punctuation. No explanation.`;

export async function classifyIntent(
  text: string,
  model?: string,
): Promise<IntentType> {
  try {
    const llm = getLLM();
    const raw = await llm.complete(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 500) }, // cap input for classify call
      ],
      { temperature: 0, maxTokens: 10, model },
    );

    const trimmed = raw.trim().toLowerCase() as IntentType;
    return VALID_INTENTS.has(trimmed) ? trimmed : "unsupported";
  } catch {
    // Network errors, rate limits, etc. — fall back to unsupported
    // so the chat action can handle it gracefully instead of crashing.
    return "unsupported";
  }
}
