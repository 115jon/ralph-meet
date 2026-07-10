import CommandMenu from "@/components/CommandMenu";
import { ChatGateway } from "@/components/chat/ChatGateway";
import ChatPageClient from "@/components/chat/ChatPageClient";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
  isDesktopAuthenticated,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { useAuth } from "@kova/react";
import {
  createFileRoute,
  Navigate,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

const authGuard = createServerFn().handler(async () => {
  const { auth } = await import("@/lib/kova-auth-server");
  const { userId } = await auth();
  return { userId: userId ?? null };
});

function buildRedirectUrl(location: {
  pathname: string;
  searchStr?: string;
  hash?: string;
}): string {
  const search = location.searchStr
    ? location.searchStr.startsWith("?")
      ? location.searchStr
      : `?${location.searchStr}`
    : "";
  const hash = location.hash
    ? location.hash.startsWith("#")
      ? location.hash
      : `#${location.hash}`
    : "";

  return `${location.pathname}${search}${hash}`;
}

function buildPostAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "/chat";

  const url = new URL(window.location.href);
  url.searchParams.delete("kova_auth_code");
  url.searchParams.delete("ralph_auth_code");
  url.searchParams.delete("code");

  return `${url.pathname}${url.search}${url.hash}`;
}

/** Native auth guard accepts the persisted Ralph Auth app token. */
function desktopAuthGuard() {
  if (!isDesktopAuthenticated()) {
    throw redirect({ to: "/" });
  }
  return { userId: "desktop" };
}

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
  beforeLoad: async ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const hasAuthTransferCode =
      typeof search?.kova_auth_code === "string" ||
      typeof search?.ralph_auth_code === "string" ||
      location.searchStr.includes("kova_auth_code=") ||
      location.searchStr.includes("ralph_auth_code=");
    if (hasAuthTransferCode) return { userId: "oauth-callback" };
    if (isTauri()) return desktopAuthGuard();
    if (
      typeof window !== "undefined" &&
      (getDesktopToken() || getStoredKovaAuthSessionToken())
    ) {
      return { userId: "web" };
    }
    const result = await authGuard();
    if (!result.userId) {
      throw redirect({
        to: "/sign-in",
        search: { redirect_url: buildRedirectUrl(location) },
      });
    }
    return { userId: result.userId };
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
  const isChatLanding =
    location.pathname === "/chat" || location.pathname === "/chat/";

  if (userId === "oauth-callback") {
    return <ChatAuthCallbackGate />;
  }

  return (
    <>
      <ChatGateway authenticatedUserId={userId} />
      <ConnectionOverlay />
      {isChatLanding ? <ChatPageClient /> : <Outlet />}
      <ImageViewerModal />
      <CommandMenu />
    </>
  );
}

function ChatAuthCallbackGate() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
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
        const target = buildPostAuthCallbackUrl();
        void navigate({ to: target as any, replace: true } as any).catch(() => {
          window.location.replace(target);
        });
        return;
      }

      setFailed(true);
    }

    void finishCallback();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, navigate]);

  if (failed) {
    return (
      <Navigate
        to="/sign-in"
        search={{ redirect_url: buildPostAuthCallbackUrl() }}
        replace
      />
    );
  }

  return <div className="min-h-screen bg-[var(--rm-bg-primary)]" />;
}
