import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { dbAdmin } from "../db/client";
import { aiChatMessages, workerDocuments } from "../db/schema";
import { type ChatAttachment, type ChatMessage, type ChatResult, type UserChatMessage } from "../ai/chat-types";
import { getWorkerDocumentSignedUrl } from "../storage/worker-documents";

const DEFAULT_HISTORY_LIMIT = 80;

export async function listAiChatHistory(
  operatorId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<ChatMessage[]> {
  const rows = await dbAdmin
    .select({
      id: aiChatMessages.id,
      role: aiChatMessages.role,
      content: aiChatMessages.content,
      result: aiChatMessages.result,
    })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.operatorId, operatorId))
    .orderBy(desc(aiChatMessages.createdAt))
    .limit(limit);

  const messages: ChatMessage[] = [];
  for (const row of rows.reverse()) {
    if (row.role === "user" && row.content) {
      messages.push({ id: row.id, role: "user", ...parseUserContent(row.content) });
      continue;
    }
    if (row.role === "assistant" && row.result) {
      messages.push({
        id: row.id,
        role: "assistant",
        result: row.result as ChatResult,
      });
    }
  }
  await hydrateDocumentAttachments(messages);
  return messages;
}

export async function appendAiChatExchange(input: {
  operatorId: string;
  userText: string;
  result: ChatResult;
}): Promise<void> {
  const now = Date.now();
  await dbAdmin.insert(aiChatMessages).values([
    {
      operatorId: input.operatorId,
      role: "user",
      content: input.userText,
      result: null,
      createdAt: new Date(now),
    },
    {
      operatorId: input.operatorId,
      role: "assistant",
      content: null,
      result: input.result,
      createdAt: new Date(now + 1),
    },
  ]);

  await trimAiChatHistory(input.operatorId);
}

export async function clearAiChatHistory(operatorId: string): Promise<void> {
  await dbAdmin
    .delete(aiChatMessages)
    .where(eq(aiChatMessages.operatorId, operatorId));
}

async function trimAiChatHistory(operatorId: string): Promise<void> {
  const extraRows = await dbAdmin
    .select({ id: aiChatMessages.id })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.operatorId, operatorId))
    .orderBy(desc(aiChatMessages.createdAt))
    .offset(DEFAULT_HISTORY_LIMIT);

  if (extraRows.length === 0) return;

  for (const row of extraRows) {
    await dbAdmin.delete(aiChatMessages).where(eq(aiChatMessages.id, row.id));
  }
}

function parseUserContent(content: string): Pick<UserChatMessage, "text" | "attachment"> {
  const uploadedMatch = content.match(/^Uploaded document:\s*(.+\.(?:pdf|jpe?g|png|webp))\s*$/i);
  if (uploadedMatch?.[1]) {
    return {
      text: "Uploaded document",
      attachment: { name: uploadedMatch[1].trim() },
    };
  }

  const attachedMatch = content.match(/^(.*?)\s*Attached:\s*(.+\.(?:pdf|jpe?g|png|webp))\s*$/is);
  if (attachedMatch?.[2]) {
    return {
      text: attachedMatch[1]?.trimEnd() || "Uploaded document",
      attachment: { name: attachedMatch[2].trim() },
    };
  }

  return { text: content };
}

async function hydrateDocumentAttachments(messages: ChatMessage[]): Promise<void> {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "user" || !message.attachment || message.attachment.previewUrl) continue;

    const nextMessage = messages[index + 1];
    if (
      nextMessage?.role !== "assistant" ||
      nextMessage.result.type !== "provision" ||
      nextMessage.result.documentFileName !== message.attachment.name
    ) {
      continue;
    }

    const hydrated = await getProposalDocumentAttachment(
      nextMessage.result.proposalId,
      message.attachment.name,
    );
    if (hydrated) message.attachment = { ...message.attachment, ...hydrated };
  }
}

async function getProposalDocumentAttachment(
  proposalId: string,
  fileName: string,
): Promise<Partial<ChatAttachment> | null> {
  const [doc] = await dbAdmin
    .select({
      storagePath: workerDocuments.storagePath,
      fileSizeBytes: workerDocuments.fileSizeBytes,
      mimeType: workerDocuments.mimeType,
    })
    .from(workerDocuments)
    .where(
      and(
        eq(workerDocuments.proposalId, proposalId),
        eq(workerDocuments.fileName, fileName),
      ),
    )
    .limit(1);

  if (!doc) return null;

  try {
    return {
      previewUrl: await getWorkerDocumentSignedUrl(doc.storagePath),
      size: doc.fileSizeBytes ?? undefined,
      mimeType: doc.mimeType ?? undefined,
    };
  } catch (err) {
    console.error("[ai-chat-history] failed to sign document preview URL:", err);
    return {
      size: doc.fileSizeBytes ?? undefined,
      mimeType: doc.mimeType ?? undefined,
    };
  }
}
