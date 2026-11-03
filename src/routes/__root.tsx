import { NotFoundPage, RouteErrorPage } from "@/components/PageState";
import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { DeferredToaster } from "@/components/DeferredToaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppSessionRecovery } from "@/hooks/useAppSessionRecovery";
import { useExternalLinkHandler } from "@/hooks/useExternalLinkHandler";
import {
  DEBUG_DESKTOP_AUTH,
  getDesktopAuthHandoffToken,
  handleKovaSessionTokenChange,
  subscribeDesktopTokenChanges,
  useKovaAuthTokenSync,
} from "@/lib/desktop-auth";
import { getKovaAuthConfig } from "@/lib/kova-auth-config";
import { inviteCodeFromDeepLink } from "@/lib/desktop-deep-link";
import { getHost } from "@/lib/host";
import { getPublicWebUrl, isDesktop, isTauri } from "@/lib/platform";
import { KovaAuthProvider, useAuth } from "@kova/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { clog } from "@/lib/console-logger";
import appCss from "../styles.css?url";
import { AppActiveRoot } from "@/hooks/useAppActive";
import geistFont from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import bricolageFont from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2?url";
import martianFont from "@fontsource-variable/martian-mono/files/martian-mono-latin-wdth-normal.woff2?url";

const authLog = clog("DesktopAuth");
const deepLinkLog = clog("DesktopDeepLinkBridge");
const devtoolsLog = clog("DesktopDevtools");
const faviconHref = import.meta.env.DEV ? "/favicon-dev.ico" : "/favicon.ico";
const SITE_TITLE = "Yap: voice, chat and video rooms";
const SITE_DESCRIPTION =
  "Voice, chat, video and screen share for the people you talk to every day. Start a room, send the link, they're in.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        // viewport-fit=cover makes env(safe-area-inset-*) non-zero (notch,
        // home indicator); resizes-content shrinks the layout for the
        // on-screen keyboard so the composer stays above it.
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      // Link previews: Yappy and the wordmark on the dark panel (1200x630).
      // No og:image size or alt here: a route's own og:image (a shared
      // message) replaces this one, and would inherit them.
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Yap" },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: `${getPublicWebUrl()}/og-image.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", href: faviconHref },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Self-hosted faces (styles.css imports the @font-face rules); the
      // latin subsets of the faces on first paint are preloaded so text doesn't
      // swap (Geist Mono is code only and loads on demand).
      {
        rel: "preload",
        href: geistFont,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      // Display (titles, names, control labels) and silkscreen (labels,
      // readouts, counts) are on first paint of every surface too.
      {
        rel: "preload",
        href: bricolageFont,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: martianFont,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
  pendingComponent: SplashScreen,
  shellComponent: RootDocument,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  if (isTauri()) {
    // Desktop: The app mounts inside `<div id="root">` in desktop/index.html.
    // If we return `<html><body>` here, ReactDOM crashes silently when Portals are used,
    // permanently dropping events in WebView2. Return a simple div wrapper instead.
    return (
      <div
        className="h-full w-full bg-ply-0 text-ink-1 antialiased font-ui"
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
        className="bg-ply-0 text-ink-1 antialiased font-ui"
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
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const sessionTokenStateRef = useRef({ seenSessionToken: false });

  useEffect(() => {
    // Auth handoff storage is intentionally read after the stable server snapshot.
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setSessionToken(getDesktopAuthHandoffToken() ?? undefined);
    return subscribeDesktopTokenChanges((token) => {
      setSessionToken(token ?? undefined);
    });
  }, []);

  const content = (
    <ThemeProvider>
      <AppActiveRoot />
      <TooltipProvider>
        <Outlet />
        <DeferredToaster />
      </TooltipProvider>
    </ThemeProvider>
  );

  return (
    <KovaAuthProvider
      {...getKovaAuthConfig()}
      afterSignInUrl="/chat"
      afterSignOutUrl="/sign-in"
      initialSessionToken={sessionToken}
      onSessionTokenChange={(token: string | null) => {
        setSessionToken(token ?? undefined);
        if (DEBUG_DESKTOP_AUTH) {
          authLog.info("KovaAuthProvider session token changed", {
            hasToken: !!token,
            tokenLength: token?.length ?? 0,
          });
        }
        handleKovaSessionTokenChange(token, sessionTokenStateRef.current);
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
  // A stored token Kova no longer knows: mint a new one from the cookie.
  useAppSessionRecovery();
  return null;
}

function DesktopDeepLinkBridge() {
  const navigate = useNavigate();

  // The page's one deep-link handler. Rust dedupes links, reveals the window
  // and queues links that arrive before this listens.
  useEffect(() => {
    if (!isDesktop()) return;

    const { unsubscribe, ready } = getHost().deepLinks.subscribe((url) => {
      // Auth no longer uses deep links (desktop signs in with a device code);
      // invites are the only yap:// links handled here.
      const code = inviteCodeFromDeepLink(url);
      if (!code) {
        deepLinkLog.warn("Deep link did not contain an invite");
        return;
      }
      deepLinkLog.info("Deep link contained invite code");
      void navigate({ to: "/invite/$code", params: { code } });
    });
    ready.catch((error: unknown) =>
      deepLinkLog.error("Failed to listen for deep links:", error),
    );
    return unsubscribe;
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
        await getHost().window.toggleDevtools();
      } catch (error) {
        devtoolsLog.error("Failed to toggle devtools", error);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return null;
}
