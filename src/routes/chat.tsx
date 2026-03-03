import CommandMenu from "@/components/CommandMenu";
import { ChatGateway } from "@/components/chat/ChatGateway";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { isDesktopAuthenticated } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
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

/** Desktop auth guard — checks local token instead of server-side Clerk. */
function desktopAuthGuard() {
  if (!isDesktopAuthenticated()) {
    throw redirect({ to: "/" });
  }
  return { userId: "desktop" };
}

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
  beforeLoad: () => isTauri() ? desktopAuthGuard() : authGuard(),
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
