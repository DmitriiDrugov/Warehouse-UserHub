import { requireOperator } from "@/lib/auth/operator";
import { listAiChatHistory } from "@/lib/services/ai-chat-history";
import { ChatInterface } from "./chat-interface";

export const metadata = { title: "AI Assistant — UserHub" };

export default async function AiAssistantPage() {
  // Enforces hr|warehouse_admin at the auth helper level — consistent with the
  // server actions. Viewers are redirected by the requireOperator call.
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const initialMessages = await listAiChatHistory(operator.id);
  return <ChatInterface initialMessages={initialMessages} />;
}
