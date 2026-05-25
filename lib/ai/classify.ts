/**
 * Classify a free-form warehouse admin message into one of the chat intent types.
 * Used by the AI chat page to route messages to the correct handler.
 */

import { getLLM } from "../llm";

export type IntentType =
  | "query"
  | "provision"
  | "update"
  | "access_explain"
  | "unsupported";

const VALID_INTENTS = new Set<IntentType>([
  "query",
  "provision",
  "update",
  "access_explain",
  "unsupported",
]);

const SYSTEM_PROMPT = `You are classifying a warehouse admin request into exactly one of:
- "query"          - user wants to look up, list, search, or export data
- "provision"      - user wants to create a new warehouse worker
- "update"         - user wants to modify existing worker data: grant or revoke a certificate,
                     change a worker's status (active / suspended / offboarded / pending),
                     or update a worker's email address
- "access_explain" - user asks why a specific worker has no access, missing access,
                     blocked access, or asks to explain a worker's access state.
                     Examples: "Why does Alina Lange not have access?" or
                     "Почему у Alina Lange нет доступа?"
- "unsupported"    - anything else (bulk delete, access changes, role changes, off-topic)

Respond with one lowercase word only. No punctuation. No explanation.`;

export async function classifyIntent(
  text: string,
  model?: string,
): Promise<IntentType> {
  if (looksLikeAccessExplanationRequest(text)) {
    return "access_explain";
  }

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
    // Network errors, rate limits, etc. fall back to unsupported
    // so the chat action can handle it gracefully instead of crashing.
    return "unsupported";
  }
}

export function looksLikeAccessExplanationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const mentionsAccess =
    /\baccess\b/i.test(normalized) ||
    /доступ/iu.test(normalized) ||
    /\b(wms|badge|email)\b/i.test(normalized);
  if (!mentionsAccess) return false;

  return (
    /\bwhy\b.{0,80}\b(no|not|without|missing|blocked)\b.{0,80}\baccess\b/i.test(normalized) ||
    /\bwhy\b.{0,80}\bdoes(?:\s+not|n't|nt)?\b.{0,80}\bhave\b.{0,40}\baccess\b/i.test(normalized) ||
    /\bexplain\b.{0,80}\baccess\b/i.test(normalized) ||
    /почему.{0,80}(?:нет|не|отсутствует).{0,80}доступ/iu.test(normalized) ||
    /у\s+.+?(?:нет|не)\s+доступ/iu.test(normalized)
  );
}
