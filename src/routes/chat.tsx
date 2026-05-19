import CommandMenu from "@/components/CommandMenu";
import { UpdateChecker } from "@/components/UpdateChecker";
import { ChatGateway } from "@/components/chat/ChatGateway";
import ChatPageClient from "@/components/chat/ChatPageClient";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { getDesktopToken, getStoredRalphAuthSessionToken, isDesktopAuthenticated } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const authGuard = createServerFn().handler(async () => {
  const { auth } = await import("@/lib/ralph-auth-server");
  const { userId } = await auth();
  if (!userId) {
    throw redirect({ to: "/sign-in" });
  }
  return { userId };
});

/** Native auth guard accepts the persisted Ralph Auth app token. */
function desktopAuthGuard() {
  if (!isDesktopAuthenticated()) {
    throw redirect({ to: "/" });
  }
  return { userId: "desktop" };
}

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const hasAuthTransferCode =
      typeof search?.ralph_auth_code === "string" ||
      location.searchStr.includes("ralph_auth_code=");
    if (hasAuthTransferCode) return { userId: "oauth-callback" };
    if (isTauri()) return desktopAuthGuard();
    if (typeof window !== "undefined" && (getDesktopToken() || getStoredRalphAuthSessionToken())) {
      return { userId: "web" };
    }
    return authGuard();
  },
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
  const { userId } = Route.useRouteContext();
  const location = useLocation();
  const isChatLanding = location.pathname === "/chat" || location.pathname === "/chat/";

  return (
    <>
      <ChatGateway authenticatedUserId={userId} />
      <ConnectionOverlay />
      <UpdateChecker />
      {isChatLanding ? <ChatPageClient /> : <Outlet />}
      <ImageViewerModal />
      <CommandMenu />
    </>
  );
}
