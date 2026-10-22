import { AUTH_CARD_APPEARANCE } from "@/components/auth/auth-card-appearance";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import DesktopLogin from "@/components/DesktopLogin";
import { SplashScreen } from "@/components/SplashScreen";
import {
  consumeAuthLogoutIntent,
  clearStoredKovaAuthSessionToken,
  getStoredKovaAuthSessionToken,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import {
  buildAuthRouteUrl,
  redirectOrigins,
  sanitizeRedirectUrl,
} from "@/lib/auth-route-urls";
import { isTauri } from "@/lib/platform";
import { SignIn, useAuth } from "@kova/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { clog } from "@/lib/console-logger";

const log = clog("SignInBridge");

type SignInSearch = {
  redirect_url?: string;
  kova_auth_code?: string;
  ralph_auth_code?: string;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    return {
      redirect_url: search.redirect_url as string | undefined,
      kova_auth_code: search.kova_auth_code as string | undefined,
      ralph_auth_code: search.ralph_auth_code as string | undefined,
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
  const { redirect_url, kova_auth_code, ralph_auth_code } = Route.useSearch();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const afterSignInUrl = sanitizeRedirectUrl(redirect_url, redirectOrigins());
  const signUpUrl = buildAuthRouteUrl("/sign-up", { redirect_url });
  const oauthCallbackUrl = buildWebOauthCallbackUrl(afterSignInUrl);
  const hasAuthTransferCode = !!(kova_auth_code || ralph_auth_code);
  const [suppressStoredBrowserToken] = useState(() => {
    if (!consumeAuthLogoutIntent()) return false;
    clearStoredKovaAuthSessionToken();
    return true;
  });
  const storedBrowserToken = suppressStoredBrowserToken
    ? null
    : getStoredKovaAuthSessionToken();
  const didRedirectRef = useRef(false);

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
        // `href`, not `to`: the router treats `to` as a bare path, so
        // "/activate?code=…" passed as `to` silently goes nowhere.
        void navigate({
          href: afterSignInUrl,
          replace: true,
        }).catch((error) => {
          log.warn(
            "Router navigation failed; falling back to hard redirect",
            error,
          );
          window.location.replace(afterSignInUrl);
        });
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

    if (storedBrowserToken || (isLoaded && isSignedIn)) {
      void completeRedirect();
    }

    return () => {
      cancelled = true;
    };
  }, [
    afterSignInUrl,
    getToken,
    isLoaded,
    isSignedIn,
    navigate,
    storedBrowserToken,
  ]);

  if (!isLoaded || isSignedIn || hasAuthTransferCode) {
    return <SplashScreen />;
  }

  return (
    <AuthSplitLayout>
      <SignIn
        afterSignInUrl={oauthCallbackUrl}
        signUpUrl={signUpUrl}
        appearance={AUTH_CARD_APPEARANCE}
      />
    </AuthSplitLayout>
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
