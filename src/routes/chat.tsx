import CommandMenu from "@/components/CommandMenu";
import { ChatGateway } from "@/components/chat/ChatGateway";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
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

/** Desktop auth guard — accepts either a Clerk plugin session or legacy localStorage token. */
function desktopAuthGuard() {
  // With tauri-plugin-clerk, the session is managed by the Clerk plugin.
  // The legacy isDesktopAuthenticated() check is a fallback.
  // We skip the guard entirely on desktop and let Clerk's own
  // auth state handle the redirect in the DesktopLogin component.
  if (!isDesktopAuthenticated()) {
    // Don't redirect — Clerk may still be loading the persisted session.
    // The DesktopLogin component handles the sign-in flow.
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
      <ConnectionOverlay />
      <Outlet />
      <ImageViewerModal />
      <CommandMenu />
    </>
  );
}
