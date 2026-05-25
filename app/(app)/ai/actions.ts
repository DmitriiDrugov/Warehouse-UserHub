"use server";

import { basename } from "path";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/operator";
import { classifyIntent } from "@/lib/ai/classify";
import { explainAccessQuestion } from "@/lib/ai/access-explain";
import {
  extractWorkerProvisioningFromDocument,
  isSupportedDocumentMime,
} from "@/lib/ai/parse-document";
import { proposeProvision } from "@/lib/ai/provisioning";
import { runNlQuery } from "@/lib/ai/nl-sql";
import { runNlUpdate, UpdateUnsupportedError } from "@/lib/ai/nl-update";
import { dbAdmin } from "@/lib/db/client";
import { workerDocuments } from "@/lib/db/schema";
import { clearAiChatHistory, appendAiChatExchange } from "@/lib/services/ai-chat-history";
import {
  deleteWorkerDocument,
  uploadWorkerDocument,
} from "@/lib/storage/worker-documents";
import { type ChatResult } from "@/lib/ai/chat-types";
import { type DocumentType } from "@/lib/validation/enums";
import { z } from "zod";

export type {
  AccessExplanationResult,
  ChatResult,
  ErrorResult,
  ProposalResult,
  QueryResult,
  UnsupportedResult,
  UpdateResult,
} from "@/lib/ai/chat-types";

// ─── Text chat action ─────────────────────────────────────────────────────────

const ChatInputSchema = z.object({
  text: z.string().min(1).max(2000),
  model: z.string().min(1).default("anthropic/claude-sonnet-4.6"),
});

const DocumentInputSchema = z.object({
  notes: z.string().max(2000).optional(),
  model: z.string().min(1).default("anthropic/claude-sonnet-4.6"),
});

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB

export async function chatAction(formData: FormData): Promise<ChatResult> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

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
    return await persistChatResult(operator.id, text, {
      type: "unsupported",
      message:
        "This action isn't supported via AI chat yet. Use the specific management pages for bulk edits, deletions, or access changes.",
    });
  }

  if (intent === "query") {
    try {
      const result = await runNlQuery(text, {
        context: context || undefined,
        model,
      });
      return await persistChatResult(operator.id, text, {
        type: "query",
        columns: result.columns,
        rows: result.rows,
        sql: result.sql,
        durationMs: result.durationMs,
      });
    } catch (err) {
      return await persistChatResult(operator.id, text, {
        type: "error",
        message: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (intent === "access_explain") {
    try {
      const result = await explainAccessQuestion(text, operator.id, model);
      return await persistChatResult(operator.id, text, result);
    } catch (err) {
      return await persistChatResult(operator.id, text, {
        type: "error",
        message: `Access explanation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (intent === "update") {
    try {
      const result = await runNlUpdate(text, model, context || undefined);
      return await persistChatResult(operator.id, text, {
        type: "update",
        operation: result.operation,
        affected: result.affected,
        summary: result.summary,
      });
    } catch (err) {
      if (err instanceof UpdateUnsupportedError) {
        return await persistChatResult(operator.id, text, {
          type: "unsupported",
          message: err.message,
        });
      }
      return await persistChatResult(operator.id, text, {
        type: "error",
        message: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // intent === "provision"
  try {
    const result = await proposeProvision(text, model);
    if (!result.ok) {
      return await persistChatResult(operator.id, text, {
        type: "error",
        message: result.error,
      });
    }
    return await persistChatResult(operator.id, text, {
      type: "provision",
      proposalId: result.proposalId,
      explanation: result.explanation,
    });
  } catch (err) {
    return await persistChatResult(operator.id, text, {
      type: "error",
      message: `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ─── Document upload → proposal action ─────────────────────────────────────

export async function uploadDocumentProposalAction(formData: FormData): Promise<ChatResult> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

  const parsed = DocumentInputSchema.safeParse({
    notes: formData.get("notes") ?? undefined,
    model: formData.get("model"),
  });
  if (!parsed.success) {
    return { type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: "No document file provided." };
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return { type: "error", message: "Document is too large (max 10 MB)." };
  }

  const mimeType = detectDocumentMimeType(file);
  if (!isSupportedDocumentMime(mimeType)) {
    return {
      type: "error",
      message: "Unsupported document type. Upload a PDF, JPG, PNG, or WEBP file.",
    };
  }

  const fileName = basename(file.name || "document");
  const { model, notes } = parsed.data;
  const userText = notes?.trim()
    ? `${notes.trim()}\n\nAttached: ${fileName}`
    : `Uploaded document: ${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  let result: Awaited<ReturnType<typeof proposeProvision>>;
  const warnings: string[] = [];
  try {
    const extraction = await extractWorkerProvisioningFromDocument({
      buffer,
      mimeType,
      fileName,
      model,
      notes,
    });
    warnings.push(...extraction.warnings);
    result = await proposeProvision(
      `Parsed worker provisioning request from uploaded document ${fileName}.`,
      model,
      extraction.intent,
    );
  } catch (err) {
    return await persistChatResult(operator.id, userText, {
      type: "error",
      message: `Document parsing failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (!result.ok) {
    return await persistChatResult(operator.id, userText, {
      type: "error",
      message: result.error,
    });
  }

  let documentFileName: string | undefined;
  let documentWarning = warnings.join(" ");
  let storagePath: string | undefined;
  const documentType = inferDocumentType(fileName, notes);

  try {
    storagePath = await uploadWorkerDocument({
      scope: "proposals",
      scopeId: result.proposalId,
      documentType,
      fileName,
      buffer,
      mimeType,
    });

    await dbAdmin.insert(workerDocuments).values({
      workerId: null,
      proposalId: result.proposalId,
      documentType,
      fileName,
      storagePath,
      fileSizeBytes: file.size,
      mimeType,
      uploadedBy: operator.id,
    });
    documentFileName = fileName;
  } catch (err) {
    if (storagePath) {
      deleteWorkerDocument(storagePath).catch((cleanupErr) =>
        console.error("[uploadDocumentProposalAction] staged document cleanup failed:", cleanupErr),
      );
    }
    console.error("[uploadDocumentProposalAction] proposal created but document staging failed:", err);
    documentWarning = [
      documentWarning,
      "Proposal was created, but the uploaded document could not be staged. Upload it from the worker profile after approval.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  revalidatePath("/proposals");
  revalidatePath(`/proposals/${result.proposalId}`);

  return await persistChatResult(operator.id, userText, {
    type: "provision",
    proposalId: result.proposalId,
    explanation: result.explanation,
    documentFileName,
    documentWarning: documentWarning || undefined,
  });
}

export async function clearChatHistoryAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  try {
    await clearAiChatHistory(operator.id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function persistChatResult(
  operatorId: string,
  userText: string,
  result: ChatResult,
): Promise<ChatResult> {
  try {
    await appendAiChatExchange({ operatorId, userText, result });
  } catch (err) {
    console.error("[ai-chat] failed to persist chat exchange:", err);
  }
  return result;
}

function detectDocumentMimeType(file: File): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function inferDocumentType(fileName: string, notes?: string): DocumentType {
  const text = `${fileName} ${notes ?? ""}`.toLowerCase();
  if (/\b(passport|identity|national[-_\s]?id|id[-_\s]?card)\b/.test(text)) {
    return "passport";
  }
  if (/\b(work[-_\s]?permit|visa|residence)\b/.test(text)) {
    return "work_permit";
  }
  if (/\b(forklift|lift[-_\s]?truck|certificate|licen[cs]e)\b/.test(text)) {
    return "forklift_certificate";
  }
  if (/\b(health|medical|clearance)\b/.test(text)) {
    return "health_clearance";
  }
  if (/\b(contract|agreement|employment)\b/.test(text)) {
    return "contract";
  }
  return "contract";
}
