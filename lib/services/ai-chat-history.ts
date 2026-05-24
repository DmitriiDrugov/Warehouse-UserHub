import "server-only";

import { desc, eq } from "drizzle-orm";

import { dbAdmin } from "../db/client";
import { aiChatMessages } from "../db/schema";
import { type ChatMessage, type ChatResult } from "../ai/chat-types";

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
      messages.push({ id: row.id, role: "user", text: row.content });
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
