import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinkHandler } from "@/hooks/useExternalLinkHandler";
import { DEBUG_DESKTOP_AUTH, clearDesktopToken, getDesktopAuthHandoffToken, setDesktopAuthSession, subscribeDesktopTokenChanges, useRalphAuthTokenSync } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { getRalphAuthConfig } from "@/lib/ralph-auth-config";
import { RalphAuthProvider, useAuth } from "@ralph-auth/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      { title: "Ralph Meet — Real-Time Video Conferencing" },
      {
        name: "description",
        content:
          "Real-time video, audio & screen sharing powered by Cloudflare Realtime SFU",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@300..900&display=swap",
      },
    ],
  }),
  component: RootComponent,
  pendingComponent: SplashScreen,
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-[var(--rm-text-secondary)]">Page not found</p>
      </div>
    </div>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  if (isTauri()) {
    // Desktop: The app mounts inside `<div id="root">` in desktop/index.html.
    // If we return `<html><body>` here, ReactDOM crashes silently when Portals are used,
    // permanently dropping events in WebView2. Return a simple div wrapper instead.
    return (
      <div
        className="h-full w-full bg-[var(--rm-bg-primary)] antialiased font-[Figtree,sans-serif]"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
      >
        {children}
        <Scripts />
      </div>
    );
  }

  // Web: TanStack Start SSR root
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body
        className="bg-[var(--rm-bg-primary)] antialiased font-[Figtree,sans-serif]"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        suppressHydrationWarning
      >
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // Intercept external link clicks on desktop → open in system browser
  useExternalLinkHandler();
  const [desktopSessionToken, setDesktopSessionToken] = useState<string | undefined>(() =>
    typeof window !== "undefined" && isTauri()
      ? (getDesktopAuthHandoffToken() ?? undefined)
      : undefined,
  );

  useEffect(() => {
    if (!isTauri()) return;
    return subscribeDesktopTokenChanges((token) => {
      setDesktopSessionToken(token ?? undefined);
    });
  }, []);

  const content = (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={200}>
        <Outlet />
      </TooltipProvider>
    </ThemeProvider>
  );

  return (
    <RalphAuthProvider
      {...getRalphAuthConfig()}
      afterSignInUrl="/chat"
      afterSignOutUrl="/sign-in"
      initialSessionToken={desktopSessionToken}
      onSessionTokenChange={(token) => {
        if (!isTauri()) return;

        if (DEBUG_DESKTOP_AUTH) {
          console.info("[DesktopAuth] RalphAuthProvider session token changed", {
            hasToken: !!token,
            tokenLength: token?.length ?? 0,
          });
        }
        if (token && !getDesktopAuthHandoffToken()) setDesktopAuthSession(token);
      }}
    >
      <RalphMeetTokenBridge />
      <DesktopDeepLinkBridge />
      {content}
    </RalphAuthProvider>
  );
}

function RalphMeetTokenBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  useRalphAuthTokenSync(getToken, isLoaded, isSignedIn);
  return null;
}

function DesktopDeepLinkBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function listenForDeepLinks() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const handleDeepLink = (payload: unknown) => {
          if (disposed) return;
          console.info("[DesktopDeepLinkBridge] Event received", {
            payloadKind: Array.isArray(payload) ? "array" : typeof payload,
          });

          const url = extractDeepLinkUrl(payload);
          if (!url) {
            console.warn("[DesktopDeepLinkBridge] No ralphmeet URL found in event payload");
            return;
          }

          console.info("[DesktopDeepLinkBridge] Parsed deep link", {
            protocol: safeProtocol(url),
            hasSessionToken: !!extractSearchParam(url, "session_token"),
            hasAuthCode: !!(extractSearchParam(url, "ralph_auth_code") ?? extractSearchParam(url, "code")),
          });

          const authCode = extractSearchParam(url, "ralph_auth_code") ?? extractSearchParam(url, "code");
          if (authCode) {
            console.info("[DesktopDeepLinkBridge] Deep link contained auth code fallback", {
              codeLength: authCode.length,
            });
            void navigate({
              to: "/chat",
              search: { ralph_auth_code: authCode },
              replace: true,
            } as any);
            return;
          }

          const sessionToken = extractSearchParam(url, "session_token");
          if (sessionToken) {
            setDesktopAuthSession(sessionToken);
            console.info("[DesktopDeepLinkBridge] Raw session token handoff received and stored; login view will validate it");
            void navigate({ to: "/", replace: true });
            return;
          }

          const inviteCode = extractInviteCode(url);
          if (inviteCode) {
            console.info("[DesktopDeepLinkBridge] Deep link contained invite code");
            void navigate({ to: "/invite/$code", params: { code: inviteCode } } as any);
            return;
          }

          console.warn("[DesktopDeepLinkBridge] Deep link did not contain a session token, auth code, or invite");
        };

        const unlistenDeepLink = await listen("deep-link", (event) => handleDeepLink(event.payload));
        const unlistenNewUrl = await listen("deep-link://new-url", (event) => handleDeepLink(event.payload));

        console.info("[DesktopDeepLinkBridge] Listening for desktop deep links");

        cleanup = () => {
          unlistenDeepLink();
          unlistenNewUrl();
        };
      } catch (error) {
        console.error("[DesktopDeepLinkBridge] Failed to listen for deep links:", error);
      }
    }

    void listenForDeepLinks();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [navigate]);

  return null;
}

function safeProtocol(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

function extractSearchParam(url: string, key: string): string | null {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

function extractInviteCode(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "invite" && parsed.pathname) {
      return parsed.pathname.replace(/^\//, "") || null;
    }
  } catch {
    // Ignore malformed deep links.
  }
  return null;
}

function extractDeepLinkUrl(payload: unknown): string | null {
  if (!payload) return null;

  if (typeof payload === "string") {
    const cleaned = payload.replace(/^"|"$/g, "");
    if (cleaned.startsWith("ralphmeet://")) return cleaned;
    try {
      return extractDeepLinkUrl(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractDeepLinkUrl(item);
      if (url) return url;
    }
    return null;
  }

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.urls) return extractDeepLinkUrl(obj.urls);
    if (obj.url) return extractDeepLinkUrl(obj.url);
  }

  return null;
}
