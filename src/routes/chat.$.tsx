import ChatPageClient from "@/components/chat/ChatPageClient";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat/$")({
  component: ChatPage,
});

function ChatPage() {
  return <ChatPageClient />;
}
