"use server";

import { requireOperator } from "@/lib/auth/operator";
import { NlQueryError, runNlQuery } from "@/lib/ai/nl-sql";
import { NlQueryForm } from "@/lib/validation/forms";

export type NlQueryState = {
  question?: string;
  error?: string;
  result?: {
    sql: string;
    llmSql: string;
    appliedLimit: number;
    tablesUsed: string[];
    columns: string[];
    rows: Record<string, unknown>[];
    durationMs: number;
  };
};

export async function runNlQueryAction(
  _prev: NlQueryState,
  formData: FormData,
): Promise<NlQueryState> {
  await requireOperator();
  const parsed = NlQueryForm.safeParse({ question: formData.get("question") });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    const result = await runNlQuery(parsed.data.question);
    return {
      question: parsed.data.question,
      result: {
        sql: result.sql,
        llmSql: result.llmSql,
        appliedLimit: result.appliedLimit,
        tablesUsed: result.tablesUsed,
        columns: result.columns,
        rows: result.rows,
        durationMs: result.durationMs,
      },
    };
  } catch (err) {
    if (err instanceof NlQueryError) {
      return {
        question: parsed.data.question,
        error: `[${err.code}] ${err.message}`,
        result: err.llmSql
          ? {
              sql: "",
              llmSql: err.llmSql,
              appliedLimit: 0,
              tablesUsed: [],
              columns: [],
              rows: [],
              durationMs: 0,
            }
          : undefined,
      };
    }
    return {
      question: parsed.data.question,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
