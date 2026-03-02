import CommandMenu from "@/components/CommandMenu";
import { ChatGateway } from "@/components/chat/ChatGateway";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const authGuard = createServerFn().handler(async () => {
  const { auth } = await import("@clerk/tanstack-react-start/server");
  const { userId } = await auth();
  if (!userId) {
    throw redirect({ to: "/sign-in" });
  }
  return { userId };
});

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
  beforeLoad: () => authGuard(),
  head: () => ({
    meta: [
      { title: "Chat — Ralph Meet" },
      {
        name: "description",
        content:
          "Connect with your communities on Ralph Meet. Real-time messaging, voice, and video in one place.",
      },
    ],
  }),
});

function ChatLayout() {
  return (
    <>
      <ChatGateway />
      <Outlet />
      <ImageViewerModal />
      <CommandMenu />
    </>
  );
}
