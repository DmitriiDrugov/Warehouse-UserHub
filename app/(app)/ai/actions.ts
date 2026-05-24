"use server";

import { requireOperator } from "@/lib/auth/operator";
import { classifyIntent } from "@/lib/ai/classify";
import { proposeProvision } from "@/lib/ai/provisioning";
import { extractWorkerDataFromDocument } from "@/lib/ai/parse-document";
import { runNlQuery } from "@/lib/ai/nl-sql";
import { dbAdmin } from "@/lib/db/client";
import { workerDocuments } from "@/lib/db/schema";
import { uploadWorkerDocument } from "@/lib/storage/worker-documents";
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
  fromDocument?: boolean;
};

export type UnsupportedResult = {
  type: "unsupported";
  message: string;
};

export type ErrorResult = {
  type: "error";
  message: string;
};

export type ChatResult = QueryResult | ProposalResult | UnsupportedResult | ErrorResult;

// ─── Text chat action ─────────────────────────────────────────────────────────

const ChatInputSchema = z.object({
  text: z.string().min(1).max(2000),
  model: z.string().min(1).default("claude-sonnet-4-6"),
});

export async function chatAction(formData: FormData): Promise<ChatResult> {
  await requireOperator(["hr", "warehouse_admin"]);

  const parsed = ChatInputSchema.safeParse({
    text: formData.get("text"),
    model: formData.get("model") ?? "claude-sonnet-4-6",
  });
  if (!parsed.success) {
    return { type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { text, model } = parsed.data;
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
      // Note: runNlQuery does not accept a model override — it uses getLLM() default.
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

  // intent === "provision"
  const result = await proposeProvision(text, model);
  if (!result.ok) {
    return { type: "error", message: result.error };
  }
  return {
    type: "provision",
    proposalId: result.proposalId,
    explanation: result.explanation,
  };
}

// ─── Document upload action ───────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function uploadDocAction(formData: FormData): Promise<ChatResult> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

  const file = formData.get("file") as File | null;
  const model = (formData.get("model") as string | null) ?? "claude-sonnet-4-6";

  if (!file || file.size === 0) {
    return { type: "error", message: "No file provided." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { type: "error", message: "File too large. Maximum size is 10 MB." };
  }

  const mimeType = file.type;
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Extract worker data from document via Claude
  let docIntent;
  try {
    docIntent = await extractWorkerDataFromDocument(buffer, mimeType, model);
  } catch (err) {
    return {
      type: "error",
      message: `Could not read document: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Create the provisioning proposal using pre-parsed intent (skips LLM call)
  const provisionResult = await proposeProvision(
    "", // text not used when preParseIntent is provided
    model,
    docIntent,
  );

  if (!provisionResult.ok) {
    return { type: "error", message: provisionResult.error };
  }

  const proposalId = provisionResult.proposalId;

  // 3. Upload file to Supabase Storage staged under the proposal ID
  let storagePath = "";
  try {
    storagePath = await uploadWorkerDocument({
      scope: "proposals",
      scopeId: proposalId,
      documentType: "other",
      fileName: file.name,
      buffer,
      mimeType,
    });
  } catch {
    // Don't fail the whole action if storage upload fails
  }

  // 4. Insert worker_documents row (staged — workerId is null until approval)
  if (storagePath) {
    await dbAdmin.insert(workerDocuments).values({
      workerId: null,
      proposalId,
      documentType: "other",
      fileName: file.name,
      storagePath,
      fileSizeBytes: file.size,
      mimeType,
      uploadedBy: operator.id,
    });
  }

  return {
    type: "provision",
    proposalId,
    explanation: provisionResult.explanation,
    fromDocument: true,
  };
}
