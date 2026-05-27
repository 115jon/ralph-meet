import CommandMenu from "@/components/CommandMenu";
import { UpdateChecker } from "@/components/UpdateChecker";
import { ChatGateway } from "@/components/chat/ChatGateway";
import ChatPageClient from "@/components/chat/ChatPageClient";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { getDesktopToken, getStoredKovaAuthSessionToken, isDesktopAuthenticated, setStoredKovaAuthSessionToken } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { useAuth } from "@kova/react";
import { createFileRoute, Navigate, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

const authGuard = createServerFn().handler(async () => {
  const { auth } = await import("@/lib/kova-auth-server");
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
      typeof search?.kova_auth_code === "string" ||
      typeof search?.ralph_auth_code === "string" ||
      location.searchStr.includes("kova_auth_code=") ||
      location.searchStr.includes("ralph_auth_code=");
    if (hasAuthTransferCode) return { userId: "oauth-callback" };
    if (isTauri()) return desktopAuthGuard();
    if (typeof window !== "undefined" && (getDesktopToken() || getStoredKovaAuthSessionToken())) {
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

  if (userId === "oauth-callback") {
    return <ChatAuthCallbackGate />;
  }

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

function ChatAuthCallbackGate() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    async function finishCallback() {
      if (!isSignedIn) {
        setFailed(true);
        return;
      }

      const token = await getToken().catch(() => null);
      if (cancelled) return;

      if (token) {
        setStoredKovaAuthSessionToken(token);
        window.history.replaceState(null, "", "/chat");
        window.location.replace("/chat");
        return;
      }

      setFailed(true);
    }

    void finishCallback();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn]);

  if (failed) {
    return <Navigate to="/sign-in" search={{ redirect_url: "/chat" }} replace />;
  }

  return <div className="min-h-screen bg-[var(--rm-bg-primary)]" />;
}
