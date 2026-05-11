import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExternalLinkHandler } from "@/hooks/useExternalLinkHandler";
import { clearDesktopToken, getDesktopToken, setDesktopToken, useRalphAuthTokenSync } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { getRalphAuthConfig } from "@/lib/ralph-auth-config";
import { RalphAuthProvider, useAuth } from "@ralph-auth/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
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
  const initialSessionToken =
    typeof window !== "undefined" ? getDesktopToken() : undefined;

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
      initialSessionToken={initialSessionToken ?? undefined}
      onSessionTokenChange={(token) => {
        if (token) setDesktopToken(token);
        else clearDesktopToken();
      }}
    >
      <RalphMeetTokenBridge />
      {content}
    </RalphAuthProvider>
  );
}

function RalphMeetTokenBridge() {
  const { getToken, isSignedIn } = useAuth();
  useRalphAuthTokenSync(getToken, isSignedIn);
  return null;
}
