import DesktopLogin from "@/components/DesktopLogin";
import { SplashScreen } from "@/components/SplashScreen";
import {
  consumeAuthLogoutIntent,
  clearStoredKovaAuthSessionToken,
  getStoredKovaAuthSessionToken,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import {
  getSignInRenderState,
  shouldCompletePostSignInRedirect,
} from "@/lib/native-auth-handoff";
import { buildAuthRouteUrl } from "@/lib/auth-route-urls";
import { isTauri } from "@/lib/platform";
import { SignIn, useAuth } from "@kova/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clog } from "@/lib/console-logger";

const log = clog("SignInBridge");

type SignInSearch = {
  redirect_url?: string;
  kova_auth_code?: string;
  ralph_auth_code?: string;
  native_handoff?: string;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    return {
      redirect_url: search.redirect_url as string | undefined,
      kova_auth_code: search.kova_auth_code as string | undefined,
      ralph_auth_code: search.ralph_auth_code as string | undefined,
      native_handoff: search.native_handoff as string | undefined,
    };
  },
  component: SignInPage,
  head: () => ({
    meta: [
      { title: "Sign In — Ralph Meet" },
      {
        name: "description",
        content: "Sign in to Ralph Meet to access your servers and channels.",
      },
    ],
  }),
});

function SignInPage() {
  if (isTauri()) {
    return <DesktopLogin />;
  }

  return <WebSignInPage />;
}

function WebSignInPage() {
  const { redirect_url, kova_auth_code, ralph_auth_code, native_handoff } =
    Route.useSearch();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const afterSignInUrl = redirect_url || "/chat";
  const signUpUrl = buildAuthRouteUrl("/sign-up", {
    redirect_url,
    native_handoff,
  });
  const oauthCallbackUrl = isNativeDeepLink(afterSignInUrl)
    ? afterSignInUrl
    : buildWebOauthCallbackUrl(afterSignInUrl);
  const isNativeHandoff =
    isNativeDeepLink(afterSignInUrl) || native_handoff === "1";
  const hasAuthTransferCode = !!(kova_auth_code || ralph_auth_code);
  const [suppressStoredBrowserToken] = useState(() => {
    if (isNativeHandoff || !consumeAuthLogoutIntent()) return false;
    clearStoredKovaAuthSessionToken();
    return true;
  });
  const storedBrowserToken =
    isNativeHandoff || suppressStoredBrowserToken
      ? null
      : getStoredKovaAuthSessionToken();
  const didRedirectRef = useRef(false);
  const [nativeCookieHandoffChecked] = useState(isNativeHandoff);

  useEffect(() => {
    let cancelled = false;

    async function completeRedirect() {
      if (didRedirectRef.current) return;
      log.info("Starting post-sign-in redirect", {
        afterSignInUrl,
        isLoaded,
        isSignedIn,
        hasStoredBrowserToken: !!storedBrowserToken,
      });

      if (isRouterPath(afterSignInUrl)) {
        log.info("Redirect target is app route", { target: afterSignInUrl });
        if (!isLoaded || !isSignedIn) return;
        didRedirectRef.current = true;
        const token = await ensureAppSessionToken(getToken);
        log.info("App route session token ready", {
          hasToken: !!token,
          tokenLength: token?.length ?? 0,
        });
        if (token) setStoredKovaAuthSessionToken(token);
        void navigate({
          to: afterSignInUrl as any,
          replace: true,
        } as any).catch((error) => {
          log.warn(
            "Router navigation failed; falling back to hard redirect",
            error,
          );
          window.location.replace(afterSignInUrl);
        });
        return;
      }

      if (isNativeHandoff) {
        // The auth provider owns native callbacks and appends a short-lived code.
        return;
      }

      const target = afterSignInUrl;
      if (!cancelled) {
        if (didRedirectRef.current) return;
        didRedirectRef.current = true;

        log.info("Launching redirect", {
          protocol: safeProtocol(target),
        });
        window.location.replace(target);
      }
    }

    if (
      shouldCompletePostSignInRedirect({
        isNativeHandoff,
        isLoaded,
        isSignedIn,
        hasStoredBrowserToken: !!storedBrowserToken,
      })
    ) {
      void completeRedirect();
    }

    return () => {
      cancelled = true;
    };
  }, [
    afterSignInUrl,
    getToken,
    isLoaded,
    isNativeHandoff,
    isSignedIn,
    navigate,
    storedBrowserToken,
  ]);

  const signInRenderState = getSignInRenderState({
    isNativeHandoff,
    nativeCookieHandoffChecked,
    isLoaded,
    isSignedIn,
    hasAuthTransferCode,
  });

  if (signInRenderState === "native-preparing") {
    return <NativeRedirectPreparing />;
  }

  if (signInRenderState === "splash") {
    return <SplashScreen />;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 selection:bg-rm-accent/30">
      {/* Premium Orb Background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-rm-accent/10 mix-blend-screen blur-[120px] animate-[pulse_960ms_cubic-bezier(0.16,1,0.3,1)_infinite]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-primary/5 mix-blend-screen blur-[120px] animate-[pulse_980ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:120ms]" />
        <div className="absolute bottom-[20%] left-[20%] h-[400px] w-[400px] rounded-full bg-rm-accent/5 mix-blend-screen blur-[100px]" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        {/* Logo */}
        <Link
          to="/"
          className="group flex flex-col items-center gap-4 no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-rm-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-3xl"
        >
          <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-rm-bg-elevated/40 border border-rm-border shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-500 group-hover:scale-105 group-hover:border-rm-accent/50 group-hover:shadow-[0_0_30px_-5px_var(--rm-accent)] animate-[float_4s_ease-in-out_infinite]">
            <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <Radio className="relative z-10 h-8 w-8 text-rm-accent transition-colors duration-300 group-hover:text-rm-accent-hover" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent drop-shadow-sm transition-opacity duration-300 group-hover:opacity-90">
            Ralph Meet
          </h1>
        </Link>

        {/* Sign-in component container */}
        <div className="w-full relative">
          {/* Subtle glow behind the sign-in form */}
          <div className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-rm-accent/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
          <SignIn afterSignInUrl={oauthCallbackUrl} signUpUrl={signUpUrl} />
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 p-6 text-center text-[0.65rem] font-bold tracking-widest uppercase text-rm-text-ghost">
        Built with Cloudflare Realtime SFU
      </footer>
    </div>
  );
}

function NativeRedirectPreparing() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 text-center">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute h-[560px] w-[560px] rounded-full bg-rm-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[520px] w-[520px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur">
        <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-rm-accent-dim ring-1 ring-rm-border">
          <Radio className="h-7 w-7 text-rm-accent" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Preparing Ralph Meet
          </h1>
          <p className="text-sm leading-6 text-[var(--rm-text-secondary)]">
            We are attaching your signed-in Ralph Auth session before opening
            the desktop app.
          </p>
        </div>
      </main>
    </div>
  );
}

function isRouterPath(value: string): value is `/${string}` {
  return value.startsWith("/") && !value.startsWith("//");
}

function buildWebOauthCallbackUrl(afterSignInUrl: string): string {
  const params = new URLSearchParams();
  params.set("redirect_url", afterSignInUrl);
  return `/sign-in?${params.toString()}`;
}

function isNativeDeepLink(value: string): boolean {
  try {
    return new URL(value).protocol === "ralphmeet:";
  } catch {
    return false;
  }
}

async function ensureAppSessionToken(
  getToken: () => Promise<string | null>,
): Promise<string | null> {
  const storedToken = getStoredKovaAuthSessionToken();
  if (storedToken) return storedToken;

  const token = await withTimeout(getToken(), 2500).catch(() => null);
  if (token) return token;

  return getStoredKovaAuthSessionToken();
}

function safeProtocol(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timeout));
  });
}
