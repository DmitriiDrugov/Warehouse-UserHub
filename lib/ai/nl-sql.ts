/**
 * §6.1 — Natural-language SQL pipeline.
 *
 *   runNlQuery(text) → { sql, rows, columns, appliedLimit, tablesUsed }
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
];

function buildPrompt(question: string, maxRows: number): LLMMessage[] {
  const viewBlock = describeViewsForPrompt();
  const fewshotBlock = FEWSHOTS.map(
    (s, i) => `Example ${i + 1}\nQ: ${s.q}\nSQL:\n${s.sql}`,
  ).join("\n\n");

  const system = [
    "You translate one English question into one PostgreSQL SELECT against the reporting views listed below.",
    "Hard rules — violating any of these will cause your output to be rejected:",
    "  1. EXACTLY ONE SELECT. No semicolons inside, no trailing ';', no multiple statements.",
    "  2. Reference ONLY the listed views by their exact names. Never reference the underlying tables.",
    "  3. No WITH / CTEs, no UNION/INTERSECT/EXCEPT, no INTO, no FOR UPDATE/SHARE, no DDL.",
    "  4. Do not call functions that touch sessions, privileges, files, or sleep.",
    `  5. Include a LIMIT clause ≤ ${maxRows}. If unsure, use LIMIT ${maxRows}.`,
    "  6. Output ONLY the SQL — no explanation, no markdown fences.",
  ].join("\n");

  const user = [
    "Available views (schema and column notes):",
    viewBlock,
    "",
    "Few-shot examples:",
    fewshotBlock,
    "",
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

export async function runNlQuery(question: string): Promise<NlQueryResult> {
  const start = Date.now();
  const env = serverEnv();
  const trimmed = question.trim();
  if (!trimmed) throw new NlQueryError("empty_question", "Question is empty");

  const llm = getLLM();
  const messages = buildPrompt(trimmed, env.NL_SQL_MAX_ROWS);

  let llmText: string;
  try {
    llmText = await llm.complete(messages, { temperature: 0, maxTokens: 600 });
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
