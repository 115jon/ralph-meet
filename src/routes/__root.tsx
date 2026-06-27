import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinkHandler } from "@/hooks/useExternalLinkHandler";
import { DEBUG_DESKTOP_AUTH, getDesktopAuthHandoffToken, setDesktopAuthSession, subscribeDesktopTokenChanges, useKovaAuthTokenSync } from "@/lib/desktop-auth";
import { getKovaAuthConfig } from "@/lib/kova-auth-config";
import { isDesktop, isTauri } from "@/lib/platform";
import { KovaAuthProvider, useAuth } from "@kova/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clog } from "@/lib/console-logger";
import appCss from "../styles.css?url";

const authLog = clog("DesktopAuth");
const deepLinkLog = clog("DesktopDeepLinkBridge");
const devtoolsLog = clog("DesktopDevtools");

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
        className="bg-rm-bg-primary antialiased font-[Figtree,sans-serif]"
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
  const [sessionToken, setSessionToken] = useState<string | undefined>(() =>
    typeof window !== "undefined"
      ? (getDesktopAuthHandoffToken() ?? undefined)
      : undefined,
  );

  useEffect(() => {
    if (!isTauri()) return;
    return subscribeDesktopTokenChanges((token) => {
      setSessionToken(token ?? undefined);
    });
  }, []);

  const content = (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "miku-light", "miku-dark", "spiderman-light", "spiderman-dark"]}
    >
      <TooltipProvider delayDuration={200}>
        <Outlet />
      </TooltipProvider>
    </ThemeProvider>
  );

  return (
    <KovaAuthProvider
      {...getKovaAuthConfig()}
      afterSignInUrl="/chat"
      afterSignOutUrl="/sign-in"
      initialSessionToken={sessionToken}
      onSessionTokenChange={(token) => {
        setSessionToken(token ?? undefined);
        if (!isTauri()) return;

        if (DEBUG_DESKTOP_AUTH) {
          authLog.info("KovaAuthProvider session token changed", {
            hasToken: !!token,
            tokenLength: token?.length ?? 0,
          });
        }
        if (token && !getDesktopAuthHandoffToken()) setDesktopAuthSession(token);
      }}
    >
      <KovaMeetTokenBridge />
      <DesktopDeepLinkBridge />
      {content}
    </KovaAuthProvider>
  );
}

function KovaMeetTokenBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  useKovaAuthTokenSync(getToken, isLoaded, isSignedIn);
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
          deepLinkLog.info("Event received", {
            payloadKind: Array.isArray(payload) ? "array" : typeof payload,
          });

          const url = extractDeepLinkUrl(payload);
          if (!url) {
            deepLinkLog.warn("No ralphmeet URL found in event payload");
            return;
          }

          deepLinkLog.info("Parsed deep link", {
            protocol: safeProtocol(url),
            hasSessionToken: !!extractSearchParam(url, "session_token"),
            hasAuthCode: !!extractAuthCode(url),
          });

          const authCode = extractAuthCode(url);
          if (authCode) {
            deepLinkLog.info("Deep link contained auth code fallback", {
              codeLength: authCode.length,
            });
            void navigate({
              to: "/chat",
              search: { kova_auth_code: authCode },
              replace: true,
            } as any);
            return;
          }

          const sessionToken = extractSearchParam(url, "session_token");
          if (sessionToken) {
            setDesktopAuthSession(sessionToken);
            deepLinkLog.info("Raw session token handoff received and stored; login view will validate it");
            void navigate({ to: "/", replace: true });
            return;
          }

          const inviteCode = extractInviteCode(url);
          if (inviteCode) {
            deepLinkLog.info("Deep link contained invite code");
            void navigate({ to: "/invite/$code", params: { code: inviteCode } } as any);
            return;
          }

          deepLinkLog.warn("Deep link did not contain a session token, auth code, or invite");
        };

        const unlistenDeepLink = await listen("deep-link", (event) => handleDeepLink(event.payload));
        const unlistenNewUrl = await listen("deep-link://new-url", (event) => handleDeepLink(event.payload));

        deepLinkLog.info("Listening for desktop deep links");

        cleanup = () => {
          unlistenDeepLink();
          unlistenNewUrl();
        };
      } catch (error) {
        deepLinkLog.error("Failed to listen for deep links:", error);
      }
    }

    void listenForDeepLinks();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!isDesktop()) return;

    const handleKeyDown = async (event: KeyboardEvent) => {
      const isDevtoolsShortcut =
        event.key === "F12" ||
        (event.key.toLowerCase() === "i" && event.ctrlKey && event.shiftKey);

      if (!isDevtoolsShortcut) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("plugin:webview|internal_toggle_devtools");
      } catch (error) {
        devtoolsLog.error("Failed to toggle devtools", error);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

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

function extractAuthCode(url: string): string | null {
  return (
    extractSearchParam(url, "kova_auth_code") ??
    extractSearchParam(url, "ralph_auth_code") ??
    extractSearchParam(url, "code")
  );
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
