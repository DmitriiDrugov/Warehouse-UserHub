import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/operator";

export const metadata = { title: "AI Assistant — UserHub" };

export default async function AiAssistantPage() {
  const operator = await requireOperator();
  if (operator.operatorRole === "viewer") {
    redirect("/warehouse-users");
  }
  // Lazy import to keep the bundle small — ChatInterface is a large client component
  const { ChatInterface } = await import("./chat-interface");
  return <ChatInterface />;
}
