"use server";

import { requireOperator } from "@/lib/auth/operator";
import { classifyIntent } from "@/lib/ai/classify";
import { proposeProvision } from "@/lib/ai/provisioning";
import { runNlQuery } from "@/lib/ai/nl-sql";
import { runNlUpdate, UpdateUnsupportedError } from "@/lib/ai/nl-update";
import { z } from "zod";

// ─── Types returned to the chat interface ────────────────────────────────────

export type QueryResult = {
  type: "query";
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  durationMs: number;
};

export type ProposalResult = {
  type: "provision";
  proposalId: string;
  explanation: string;
};

export type UpdateResult = {
  type: "update";
  operation: string;
  affected: Array<{ employeeId: string; fullName: string }>;
  summary: string;
};

export type UnsupportedResult = {
  type: "unsupported";
  message: string;
};

export type ErrorResult = {
  type: "error";
  message: string;
};

export type ChatResult = QueryResult | ProposalResult | UpdateResult | UnsupportedResult | ErrorResult;

// ─── Text chat action ─────────────────────────────────────────────────────────

const ChatInputSchema = z.object({
  text: z.string().min(1).max(2000),
  model: z.string().min(1).default("anthropic/claude-sonnet-4.6"),
});

export async function chatAction(formData: FormData): Promise<ChatResult> {
  await requireOperator(["hr", "warehouse_admin"]);

  const parsed = ChatInputSchema.safeParse({
    text: formData.get("text"),
    model: formData.get("model"),
  });
  if (!parsed.success) {
    return { type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { text, model } = parsed.data;
  // Conversation context: serialized recent messages from the client so the
  // LLM can resolve references like "them" / "those workers" across turns.
  const context = ((formData.get("context") as string | null) ?? "").slice(0, 4000);
  const intent = await classifyIntent(text, model);

  if (intent === "unsupported") {
    return {
      type: "unsupported",
      message:
        "This action isn't supported via AI chat yet. Use the specific management pages for bulk edits, deletions, or access changes.",
    };
  }

  if (intent === "query") {
    try {
      const result = await runNlQuery(text);
      return {
        type: "query",
        columns: result.columns,
        rows: result.rows,
        sql: result.sql,
        durationMs: result.durationMs,
      };
    } catch (err) {
      return {
        type: "error",
        message: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (intent === "update") {
    try {
      const result = await runNlUpdate(text, model, context || undefined);
      return {
        type: "update",
        operation: result.operation,
        affected: result.affected,
        summary: result.summary,
      };
    } catch (err) {
      if (err instanceof UpdateUnsupportedError) {
        return { type: "unsupported", message: err.message };
      }
      return {
        type: "error",
        message: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // intent === "provision"
  try {
    const result = await proposeProvision(text, model);
    if (!result.ok) {
      return { type: "error", message: result.error };
    }
    return {
      type: "provision",
      proposalId: result.proposalId,
      explanation: result.explanation,
    };
  } catch (err) {
    return {
      type: "error",
      message: `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
