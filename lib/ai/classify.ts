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
- "query"          - user wants to look up, list, search, count, or export data
- "provision"      - user wants to create a new warehouse worker
- "update"         - user wants to modify existing worker data: grant or revoke a certificate,
                     change a worker's status (active / suspended / offboarded / pending),
                     or update a worker's email address
- "access_explain" - user asks to diagnose one worker's access state:
                     why access is missing, what blocks access, what access is missing,
                     whether the worker has WMS/badge/email access, or why the worker
                     cannot log in / enter / use a warehouse system.
                     Examples:
                     "Why does Alina Lange not have access?"
                     "What blocks EMP-022 from WMS?"
                     "Does Alina Lange have badge access?"
                     "Каких прав не хватает Alina Lange?"
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

  const accessTerms =
    /\b(access|permission|permissions|wms|badge|email|mail|login|account|grant|grants)\b/i.test(normalized) ||
    /\u0434\u043e\u0441\u0442\u0443\u043f|\u043f\u0440\u0430\u0432|\u043f\u0440\u043e\u043f\u0443\u0441\u043a|\u0431\u0435\u0439\u0434\u0436|\u0431\u0430\u0434\u0436|\u043f\u043e\u0447\u0442|\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0432\u043e\u0439\u0442\u0438|\u0437\u0430\u0439\u0442\u0438/iu.test(normalized);
  if (!accessTerms) return false;

  const diagnosticTerms =
    /\b(why|does|can|check|verify|diagnose|explain|missing|lack|lacking|block|blocks|blocked|blocking|prevent|prevents|unable|cannot|can't|cant|without)\b/i.test(normalized) ||
    /\u043f\u043e\u0447\u0435\u043c\u0443|\u0435\u0441\u0442\u044c\s+\u043b\u0438|\u043c\u043e\u0436\u0435\u0442\s+\u043b\u0438|\u043f\u0440\u043e\u0432\u0435\u0440|\u043e\u0431\u044a\u044f\u0441\u043d|\u0431\u043b\u043e\u043a|\u043c\u0435\u0448\u0430|\u043d\u0435\s+\u0445\u0432\u0430\u0442|\u043a\u0430\u043a\u0438\u0445|\u043d\u0435\s+\u043c\u043e\u0436/iu.test(normalized);
  if (!diagnosticTerms) return false;

  const aggregateLookup =
    /^\s*(show|list|count|export|how many|who has|who have)\b/i.test(normalized) ||
    /^\s*(\u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u043f\u043e\u043a\u0430\u0436\u0438\s+\u0432\u0441\u0435\u0445|\u0441\u043f\u0438\u0441\u043e\u043a)/iu.test(normalized);

  return !aggregateLookup;
}
