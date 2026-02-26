"use client";

import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { ChatProvider } from "@/lib/chat-context";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatProvider>
      {children}
      <ImageViewerModal />
    </ChatProvider>
  );
}
