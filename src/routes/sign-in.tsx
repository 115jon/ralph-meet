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
import { getKovaAuthUrl, KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { SignIn, useAuth } from "@kova/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
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
  const { redirect_url, kova_auth_code, ralph_auth_code, native_handoff } = Route.useSearch();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const afterSignInUrl = redirect_url || "/chat";
  const signUpUrl = buildAuthRouteUrl("/sign-up", { redirect_url, native_handoff });
  const oauthCallbackUrl = isNativeDeepLink(afterSignInUrl)
    ? afterSignInUrl
    : buildWebOauthCallbackUrl(afterSignInUrl);
  const isNativeHandoff = isNativeDeepLink(afterSignInUrl) || native_handoff === "1";
  const hasAuthTransferCode = !!(kova_auth_code || ralph_auth_code);
  const [suppressStoredBrowserToken] = useState(() => {
    if (isNativeHandoff || !consumeAuthLogoutIntent()) return false;
    clearStoredKovaAuthSessionToken();
    return true;
  });
  const storedBrowserToken = isNativeHandoff || suppressStoredBrowserToken ? null : getStoredKovaAuthSessionToken();
  const didRedirectRef = useRef(false);
  const [nativeRedirectTarget, setNativeRedirectTarget] = useState<string | null>(null);
  const [nativeCookieHandoffChecked, setNativeCookieHandoffChecked] = useState(false);

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
        if (isChatLandingPath(afterSignInUrl)) {
          void navigate({ to: "/chat", replace: true })
            .catch((error) => {
              log.warn("Router navigation failed; falling back to hard redirect", error);
              window.location.replace("/chat");
            });
        } else {
          void navigate({ to: afterSignInUrl as "/chat", replace: true })
            .catch((error) => {
              log.warn("Router navigation failed; falling back to hard redirect", error);
              window.location.replace(afterSignInUrl);
            });
        }
        return;
      }

      if (isNativeHandoff) {
        log.info("Native redirect target detected before token lookup", {
          hasSessionToken: hasSessionToken(afterSignInUrl),
        });
      }

      const target = await withSessionToken(afterSignInUrl, getToken, storedBrowserToken, isNativeHandoff);
      if (!cancelled) {
        if (didRedirectRef.current) return;
        didRedirectRef.current = true;

        if (isNativeHandoff) {
          log.info("Native redirect target ready", {
            hasSessionToken: hasSessionToken(target),
          });
          setNativeRedirectTarget(target);
          if (!markNativeRedirectAttempt(target)) {
            log.info("Native redirect already attempted in this tab; showing fallback button");
            return;
          }
        }
        log.info("Launching redirect", {
          protocol: safeProtocol(target),
          hasSessionToken: hasSessionToken(target),
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

  useEffect(() => {
    if (!isNativeHandoff || nativeCookieHandoffChecked || didRedirectRef.current) return;

    let cancelled = false;

    async function mintFromExistingBrowserSession() {
      clearStoredKovaAuthSessionToken();
      const token = await getAppScopedSessionToken(null);
      if (cancelled || didRedirectRef.current) return;

      if (token) {
        setStoredKovaAuthSessionToken(token);
        const target = attachSessionToken(afterSignInUrl, token);
        didRedirectRef.current = true;
        setNativeRedirectTarget(target);
        if (markNativeRedirectAttempt(target)) {
          window.location.replace(target);
        }
        return;
      }

      setNativeCookieHandoffChecked(true);
    }

    void mintFromExistingBrowserSession();

    return () => {
      cancelled = true;
    };
  }, [afterSignInUrl, isNativeHandoff, nativeCookieHandoffChecked]);

  if (nativeRedirectTarget) {
    return <NativeRedirectFallback target={nativeRedirectTarget} />;
  }

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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 selection:bg-indigo-500/30">
      {/* Premium Orb Background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-indigo-500/10 mix-blend-screen blur-[120px]" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] animate-pulse rounded-full bg-purple-500/10 mix-blend-screen blur-[120px]" style={{ animationDuration: '10s' }} />
        <div className="absolute bottom-[20%] left-[20%] h-[400px] w-[400px] rounded-full bg-pink-500/5 mix-blend-screen blur-[100px]" />
      </div>

      {/* Grid Pattern Overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIG0gMGgyNHYxSDB6bTAgMjNoMjR2MUgweiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjxwYXRoIGQ9Ik0wIG0gdjI0SDF2LTI0em0yMyAwdjI0aDF2LTI0eiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAxKSIvPjwvc3ZnPg==')] opacity-50" />

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        {/* Logo */}
        <Link to="/" className="group flex flex-col items-center gap-4 no-underline outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-3xl">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_0_40px_-10px_rgba(99,102,241,0.2)] ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-105 group-hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_0_60px_-15px_rgba(99,102,241,0.4)] animate-[float_4s_ease-in-out_infinite]">
            <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <Radio className="relative z-10 h-8 w-8 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-colors duration-300 group-hover:text-indigo-300" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent drop-shadow-sm transition-opacity duration-300 group-hover:opacity-90">
            Ralph Meet
          </h1>
        </Link>

        {/* Sign-in component container */}
        <div className="w-full relative">
          {/* Subtle glow behind the sign-in form */}
          <div className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-indigo-500/20 to-purple-500/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
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
        <div className="absolute h-[560px] w-[560px] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[520px] w-[520px] rounded-full bg-purple-500/10 blur-[120px]" />
      </div>

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-5 rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur">
        <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-white/10">
          <Radio className="h-7 w-7 text-indigo-300" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Preparing Ralph Meet</h1>
          <p className="text-sm leading-6 text-[var(--rm-text-secondary)]">
            We are attaching your signed-in Ralph Auth session before opening the desktop app.
          </p>
        </div>
      </main>
    </div>
  );
}

function NativeRedirectFallback({ target }: { target: string }) {
  const hasToken = hasSessionToken(target);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--rm-bg-primary)] px-6 text-center">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="absolute h-[560px] w-[560px] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[520px] w-[520px] rounded-full bg-purple-500/10 blur-[120px]" />
      </div>

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-6 rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 ring-1 ring-white/10">
          <Radio className="h-7 w-7 text-indigo-300" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Return to Ralph Meet</h1>
          <p className="text-sm leading-6 text-[var(--rm-text-secondary)]">
            {hasToken
              ? "Your signed-in session is attached. Use the button below to open the desktop app."
              : "The desktop app link is ready, but no session token was attached yet. The app may open without being signed in."}
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-text-muted)]">
            Auth token: {hasToken ? "attached" : "missing"}
          </p>
        </div>
        <a
          href={target}
          onClick={() => {
            log.info("Fallback Open Ralph Meet clicked", {
              hasSessionToken: hasToken,
            });
          }}
          className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400"
        >
          Open Ralph Meet
        </a>
      </main>
    </div>
  );
}

function isRouterPath(value: string): value is `/${string}` {
  return value.startsWith("/") && !value.startsWith("//");
}

function isChatLandingPath(value: string): boolean {
  return value === "/chat" || value === "/chat/";
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

function hasSessionToken(value: string): boolean {
  try {
    return !!new URL(value).searchParams.get("session_token");
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

function markNativeRedirectAttempt(target: string): boolean {
  if (typeof window === "undefined") return true;

  const key = `ralphmeet:native-redirect:${target}`;
  if (window.sessionStorage.getItem(key)) {
    return false;
  }

  window.sessionStorage.setItem(key, String(Date.now()));
  return true;
}

async function withSessionToken(
  target: string,
  getToken: () => Promise<string | null>,
  storedBrowserToken: string | null,
  isNativeHandoff: boolean,
): Promise<string> {
  log.info("Requesting Ralph Auth session token");
      const providerToken = isNativeHandoff
        ? null
        : storedBrowserToken ?? await withTimeout(getToken(), 2500).catch(() => null);
  const token = await getAppScopedSessionToken(providerToken, !isNativeHandoff && !!storedBrowserToken);
  log.info("Token lookup finished", {
    hasToken: !!token,
    tokenLength: token?.length ?? 0,
    source: storedBrowserToken ? "stored-browser" : providerToken ? "provider" : "cookie",
  });
  if (!token) return target;

  try {
    const url = new URL(target);
    if (url.protocol === "ralphmeet:") {
      return attachSessionToken(url.toString(), token);
    }
  } catch {
    // Keep the original target if it is not URL-parseable.
  }

  return target;
}

function attachSessionToken(target: string, token: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === "ralphmeet:") {
      url.searchParams.set("session_token", token);
      return url.toString();
    }
  } catch {
    // Keep the original target if it is not URL-parseable.
  }

  return target;
}

async function getAppScopedSessionToken(providerToken: string | null, clearProviderOnFailure = false): Promise<string | null> {
  if (!KOVA_AUTH_PUBLISHABLE_KEY) return providerToken;

  const requestSessionToken = async (token: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(
      `${getKovaAuthUrl()}/api/pub/apps/${KOVA_AUTH_PUBLISHABLE_KEY}/session-token`,
      {
        method: "POST",
        headers,
        credentials: "include",
      },
    );

    if (!response.ok) {
      log.warn("Failed to mint app-scoped session token", { status: response.status });
      return null;
    }

    const payload = (await response.json()) as { sessionToken?: string };
    return payload.sessionToken ?? null;
  };

  try {
    const cookieToken = await requestSessionToken(null);
    if (cookieToken) return cookieToken;

    if (providerToken) {
      const token = await requestSessionToken(providerToken);
      if (token) return token;
      if (clearProviderOnFailure) {
        clearStoredKovaAuthSessionToken();
      }
    }
  } catch (error) {
    log.warn("App-scoped session token request failed", error);
    if (clearProviderOnFailure) {
      clearStoredKovaAuthSessionToken();
    }
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timeout));
  });
}
