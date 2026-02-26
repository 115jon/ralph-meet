import ChatPageClient from "@/components/chat/ChatPageClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat — Ralph Meet",
  description: "Connect with your communities on Ralph Meet. Real-time messaging, voice, and video in one place.",
};

export default function Page() {
  return <ChatPageClient />;
}
