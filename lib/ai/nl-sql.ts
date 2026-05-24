/**
 * §6.1 — Natural-language SQL pipeline.
 *
 *   runNlQuery(text, options?) → { sql, rows, columns, appliedLimit, tablesUsed }
 *
 * Strict ordering (any failure short-circuits, raising NlQueryError):
 *
 *   1. Build prompt from `nl-sql-views.ts` definitions + few-shot examples.
 *   2. LLM generates one SELECT.
 *   3. `validateAndCanonicalize` rejects anything that is not a single
 *      SELECT over allowed views; injects/clamps LIMIT.
 *   4. Execute on `dbReadonly` (the `nl_query_reader` Postgres role —
 *      SELECT-only on the views) inside a transaction that sets
 *      `statement_timeout` from env.
 *   5. Return result + the canonical SQL that ran (NOT the raw LLM string).
 *
 * Read-only by design. No mutation, no proposal creation.
 */

import { sql as sqlTag } from "drizzle-orm";

import { dbReadonly } from "../db/client";
import { serverEnv } from "../env";
import { getLLM, type LLMMessage } from "../llm";
import { describeViewsForPrompt } from "./nl-sql-views";
import { validateAndCanonicalize } from "./nl-sql-validate";

export class NlQueryError extends Error {
  readonly code: string;
  readonly llmSql?: string;
  constructor(code: string, message: string, llmSql?: string) {
    super(message);
    this.name = "NlQueryError";
    this.code = code;
    this.llmSql = llmSql;
  }
}

export type NlQueryResult = {
  question: string;
  sql: string;
  llmSql: string;
  appliedLimit: number;
  tablesUsed: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
};

const FEWSHOTS: { q: string; sql: string }[] = [
  {
    q: "Which warehouse users have certificates that have expired?",
    sql: "SELECT employee_id, full_name, certificate_code, expires_at FROM v_user_certificates WHERE status <> 'valid' OR is_expired = true",
  },
  {
    q: "List all currently active access grants at warehouse WH-A.",
    sql: "SELECT employee_id, full_name, system_code, permission_code FROM v_user_access WHERE warehouse_code = 'WH-A' AND status = 'active'",
  },
  {
    q: "Who has active floor access but an expired or revoked forklift certificate?",
    sql: `SELECT DISTINCT a.employee_id, a.full_name, a.warehouse_code
FROM v_user_access a
JOIN v_user_certificates c ON c.warehouse_user_id = a.warehouse_user_id
WHERE a.status = 'active'
  AND c.certificate_code = 'forklift'
  AND c.status <> 'valid'`,
  },
  {
    q: "How many users at each warehouse are currently offboarded?",
    sql: "SELECT warehouse_code, COUNT(*) AS offboarded_count FROM v_warehouse_users WHERE status = 'offboarded' GROUP BY warehouse_code ORDER BY offboarded_count DESC",
  },
  // ── Absence / NOT EXISTS patterns ─────────────────────────────────────────
  // IMPORTANT: "doesn't have", "lacks", "is missing", "no certificate" queries
  // MUST use NOT EXISTS against the relevant view — never query the view directly.
  {
    q: "Which workers do not have a valid first aid certificate?",
    sql: `SELECT wu.employee_id, wu.full_name, wu.warehouse_code
FROM v_warehouse_users wu
WHERE NOT EXISTS (
  SELECT 1 FROM v_user_certificates vc
  WHERE vc.warehouse_user_id = wu.warehouse_user_id
    AND vc.certificate_code = 'first_aid'
    AND vc.status = 'valid'
    AND vc.is_expired = false
)
ORDER BY wu.full_name`,
  },
  {
    q: "Show workers who have no active access to the WMS system.",
    sql: `SELECT wu.employee_id, wu.full_name, wu.warehouse_code
FROM v_warehouse_users wu
WHERE NOT EXISTS (
  SELECT 1 FROM v_user_access ua
  WHERE ua.warehouse_user_id = wu.warehouse_user_id
    AND ua.system_code = 'wms'
    AND ua.status = 'active'
)
ORDER BY wu.full_name`,
  },
  {
    q: "Follow-up after asking about Berlin warehouse workers: How many of them have first aid certificate, and show me who",
    sql: `SELECT DISTINCT wu.employee_id, wu.full_name, wu.warehouse_code
FROM v_warehouse_users wu
JOIN v_user_certificates c ON c.warehouse_user_id = wu.warehouse_user_id
WHERE wu.warehouse_name ILIKE '%Berlin%'
  AND c.certificate_code = 'first_aid'
  AND c.status = 'valid'
  AND c.is_expired = false
ORDER BY wu.full_name`,
  },
];

export type RunNlQueryOptions = {
  context?: string;
  model?: string;
};

function buildPrompt(
  question: string,
  maxRows: number,
  context?: string,
): LLMMessage[] {
  const viewBlock = describeViewsForPrompt();
  const fewshotBlock = FEWSHOTS.map(
    (s, i) => `Example ${i + 1}\nQ: ${s.q}\nSQL:\n${s.sql}`,
  ).join("\n\n");
  const contextBlock = context
    ? [
        "Conversation context for follow-up resolution:",
        "---",
        context,
        "---",
        "",
        "Use this context only to resolve references such as 'them', 'those workers', 'that warehouse', 'same group', or 'the previous result'.",
        "When the previous assistant message includes SQL, preserve its WHERE filters unless the new question changes them.",
        "Do not answer from a previous aggregate count; generate a fresh SELECT for the current question.",
        "",
      ].join("\n")
    : "";

  const system = [
    "You translate one English question into one PostgreSQL SELECT against the reporting views listed below.",
    "Hard rules — violating any of these will cause your output to be rejected:",
    "  1. EXACTLY ONE SELECT. No semicolons inside, no trailing ';', no multiple statements.",
    "  2. Reference ONLY the listed views by their exact names. Never reference the underlying tables.",
    "  3. No WITH / CTEs, no UNION/INTERSECT/EXCEPT, no INTO, no FOR UPDATE/SHARE, no DDL.",
    "  4. Do not call functions that touch sessions, privileges, files, or sleep.",
    `  5. Include a LIMIT clause ≤ ${maxRows}. If unsure, use LIMIT ${maxRows}.`,
    "  6. Output ONLY the SQL — no explanation, no markdown fences.",
    "  7. For 'doesn\\'t have', 'lacks', 'missing', 'no certificate/access' questions: use NOT EXISTS",
    "     with a correlated subquery against v_user_certificates or v_user_access.",
    "     NEVER query those views directly to answer an absence question — that returns the OPPOSITE set.",
    "  8. If a question asks 'how many' AND also asks to show/list/who, return the matching people rows, not a single aggregate-only COUNT row.",
    "     The app displays the returned row count above the table.",
    "  9. For certificate questions, use certificate_code and require status = 'valid' and is_expired = false unless the user asks for expired/revoked certificates.",
  ].join("\n");

  const user = [
    "Available views (schema and column notes):",
    viewBlock,
    "",
    "Few-shot examples:",
    fewshotBlock,
    "",
    contextBlock,
    `Question: ${question}`,
    "SQL:",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function stripFences(s: string): string {
  const fence = s.match(/```(?:sql|postgres|postgresql)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  return s.trim();
}

export async function runNlQuery(
  question: string,
  options: RunNlQueryOptions = {},
): Promise<NlQueryResult> {
  const start = Date.now();
  const env = serverEnv();
  const trimmed = question.trim();
  if (!trimmed) throw new NlQueryError("empty_question", "Question is empty");

  const llm = getLLM();
  const messages = buildPrompt(trimmed, env.NL_SQL_MAX_ROWS, options.context);

  let llmText: string;
  try {
    llmText = await llm.complete(messages, {
      temperature: 0,
      maxTokens: 600,
      model: options.model,
    });
  } catch (err) {
    throw new NlQueryError(
      "llm_failed",
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const llmSql = stripFences(llmText);

  const validated = validateAndCanonicalize(llmSql, {
    maxRows: env.NL_SQL_MAX_ROWS,
  });
  if (!validated.ok) {
    throw new NlQueryError(validated.error.code, validated.error.message, llmSql);
  }

  const timeoutMs = env.NL_SQL_STATEMENT_TIMEOUT_MS;

  // Execute on the read-only role inside a TX so SET LOCAL applies.
  const rawRows = await dbReadonly.transaction(async (tx) => {
    await tx.execute(
      sqlTag.raw(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`),
    );
    const result = await tx.execute(sqlTag.raw(validated.sql));
    // drizzle's `execute` for postgres-js returns the row array directly.
    return result as unknown as Record<string, unknown>[];
  });

  const columns = rawRows[0] ? Object.keys(rawRows[0]) : [];
  return {
    question: trimmed,
    sql: validated.sql,
    llmSql,
    appliedLimit: validated.appliedLimit,
    tablesUsed: validated.tablesUsed,
    columns,
    rows: rawRows,
    durationMs: Date.now() - start,
  };
}
