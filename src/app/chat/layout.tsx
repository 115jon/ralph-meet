"use client";

import CommandMenu from "@/components/CommandMenu";
import { ChatGateway } from "@/components/chat/ChatGateway";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ChatGateway />
      {children}
      <ImageViewerModal />
      <CommandMenu />
    </>
  );
}
