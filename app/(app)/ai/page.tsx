import dynamic from "next/dynamic";
import { requireOperator } from "@/lib/auth/operator";

export const metadata = { title: "AI Assistant — UserHub" };

// Dynamic import creates a proper Next.js split point; ssr: false because
// ChatInterface reads localStorage for the model preference on mount.
const ChatInterface = dynamic(
  () => import("./chat-interface").then((m) => ({ default: m.ChatInterface })),
  { ssr: false },
);

export default async function AiAssistantPage() {
  // Enforces hr|warehouse_admin at the auth helper level — consistent with the
  // server actions. Viewers are redirected by the requireOperator call.
  await requireOperator(["hr", "warehouse_admin"]);
  return <ChatInterface />;
}
