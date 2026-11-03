// @vitest-environment jsdom

/**
 * First sign-in on yap.115jon.com (2026-11-03): Google bounced back to
 * /sign-in with `kova_auth_code`, the SDK traded it for an app token, and
 * the app still said "Your session expired" until a reload.
 *
 * The SDK renders once with the new token and the old, tokenless
 * get-session answer (no user). Session recovery took that as Kova refusing
 * the fresh token and minted from the auth-domain cookie, which is
 * cross-site from Yap and answers 401, so the state went "signed-out".
 *
 * Boots the real KovaAuthProvider with the root layout's wiring; only the
 * network is faked.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PK = "pk_live_code_exchange";
const PK_KEY = `kova-auth:${PK}:session-token`;
const MINT_URL = `https://auth.test/api/pub/apps/${PK}/session-token`;

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_live_code_exchange",
  getKovaAuthUrl: () => "https://auth.test",
}));

import { useAppSessionRecovery } from "@/hooks/useAppSessionRecovery";
import {
  recoverAppSession,
  resetAppSessionRecoveryForTests,
  useAppSessionState,
} from "@/lib/app-session-recovery";
import {
  beginAuthCodeExchangeForTests,
  isAuthCodeExchangePending,
  resetAuthCodeExchangeForTests,
} from "@/lib/auth-code-exchange";
import {
  getDesktopAuthHandoffToken,
  handleKovaSessionTokenChange,
  setStoredKovaAuthSessionToken,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import { KovaAuthProvider, useAuth } from "@kova/react";

function Probe() {
  useAppSessionRecovery();
  const { isLoaded, userId } = useAuth();
  const state = useAppSessionState();
  return (
    <output data-testid="probe">
      {state}:{isLoaded ? (userId ?? "none") : "…"}
    </output>
  );
}

/** RootComponent's provider wiring (src/routes/__root.tsx). */
function RootShell() {
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const state = useRef({ seenSessionToken: false });
  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setSessionToken(getDesktopAuthHandoffToken() ?? undefined);
    return subscribeDesktopTokenChanges((token) =>
      setSessionToken(token ?? undefined),
    );
  }, []);
  return (
    <KovaAuthProvider
      authUrl="https://auth.test"
      publishableKey={PK}
      afterSignInUrl="/chat"
      afterSignOutUrl="/sign-in"
      initialSessionToken={sessionToken}
      onSessionTokenChange={(token: string | null) => {
        setSessionToken(token ?? undefined);
        handleKovaSessionTokenChange(token, state.current);
      }}
    >
      <Probe />
    </KovaAuthProvider>
  );
}

let releaseExchange: () => void = () => {};

function bearerOf(input: RequestInfo | URL, init?: RequestInit) {
  const headers =
    input instanceof Request ? input.headers : new Headers(init?.headers);
  return headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/exchange-code")) {
      await new Promise<void>((resolve) => {
        releaseExchange = resolve;
      });
      return Response.json({ sessionToken: "tok_new" });
    }
    // The Kova cookie is cross-site from Yap: no cookie session to mint from.
    if (url === MINT_URL) return Response.json({}, { status: 401 });
    if (url.includes("/api/auth/get-session")) {
      return bearerOf(input, init) === "tok_new"
        ? Response.json({
            session: { id: "s1", token: "tok_new", userId: "user-1" },
            user: { id: "user-1", name: "Jon", email: "jon@test" },
          })
        : Response.json(null);
    }
    return Response.json(null, { status: 404 });
  },
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAppSessionRecoveryForTests();
  resetAuthCodeExchangeForTests();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  resetAuthCodeExchangeForTests();
  vi.unstubAllGlobals();
});

describe("first sign-in with a Kova code", () => {
  it("lands signed in, not 'session expired', when the cookie mint fails", async () => {
    localStorage.setItem(
      `kova-auth:${PK}:pending-states`,
      JSON.stringify([{ state: "st1", createdAt: Date.now() }]),
    );
    window.history.replaceState(
      {},
      "",
      "/sign-in?redirect_url=%2Fchat&kova_auth_code=code1&state=st1",
    );
    beginAuthCodeExchangeForTests();

    render(<RootShell />);
    // The SDK's own cookie mint answers 401 before the exchange does.
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("active:none"),
    );
    act(() => releaseExchange());

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("active:user-1"),
    );
    expect(localStorage.getItem(PK_KEY)).toBe("tok_new");
    expect(isAuthCodeExchangePending()).toBe(false);
  });
});

describe("session recovery during a code exchange", () => {
  it("waits for the exchange's token instead of minting", async () => {
    beginAuthCodeExchangeForTests();
    const recovered = recoverAppSession(null);
    act(() => setStoredKovaAuthSessionToken("tok_new"));
    await expect(recovered).resolves.toBe("tok_new");
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === MINT_URL),
    ).toBe(false);
  });

  it("does not sign out when a usable token lands while the mint is out", async () => {
    fetchMock.mockImplementationOnce(async () => {
      localStorage.setItem(PK_KEY, "tok_new");
      return Response.json({}, { status: 401 });
    });
    await expect(recoverAppSession(null)).resolves.toBe("tok_new");
    expect(localStorage.getItem(PK_KEY)).toBe("tok_new");
  });
});
