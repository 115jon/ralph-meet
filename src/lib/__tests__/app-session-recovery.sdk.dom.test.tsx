// @vitest-environment jsdom

/**
 * The production incident end to end at the SDK boundary (2026-11-01): the
 * stored app token was revoked server-side while the Kova cookie session
 * lived on. The tab woke, the SDK refetched get-session with the dead bearer
 * and got 200 null, so useAuth() went signed out, the chat gateway lost its
 * user id and stopped, and the SDK never minted a new token (it only mints
 * when it holds none). The strip said "Reconnecting" for 41 minutes.
 *
 * Boots the real KovaAuthProvider with the root layout's wiring
 * (src/routes/__root.tsx); only the network is faked.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PK = "pk_live_sdk_recovery";
const PK_KEY = `kova-auth:${PK}:session-token`;
const MINT_URL = `https://auth.test/api/pub/apps/${PK}/session-token`;

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_live_sdk_recovery",
  getKovaAuthUrl: () => "https://auth.test",
}));

import { GatewayConnectionBanner } from "@/components/chat/ConnectionBanner";
import { useAppSessionRecovery } from "@/hooks/useAppSessionRecovery";
import { resetAppSessionRecoveryForTests } from "@/lib/app-session-recovery";
import {
  getDesktopAuthHandoffToken,
  handleKovaSessionTokenChange,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import { useChatStore } from "@/stores/chat-store";
import { KovaAuthProvider, useAuth } from "@kova/react";

function Bridge() {
  useAppSessionRecovery();
  return null;
}

function WhoAmI() {
  const { isLoaded, userId } = useAuth();
  return (
    <output data-testid="who">{isLoaded ? (userId ?? "none") : "…"}</output>
  );
}

/** RootComponent's provider wiring, plus KovaMeetTokenBridge's recovery. */
function RootShell({ children }: { children?: React.ReactNode }) {
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
      <Bridge />
      <WhoAmI />
      {children}
    </KovaAuthProvider>
  );
}

/** What Kova's session-token mint answers (cookie session or not). */
let mint: () => Response;

function bearerOf(input: RequestInfo | URL, init?: RequestInit) {
  const headers =
    input instanceof Request ? input.headers : new Headers(init?.headers);
  return headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === MINT_URL) return mint();
    if (url.includes("/api/auth/get-session")) {
      // Kova answers 200 null for a bearer it no longer knows.
      return bearerOf(input, init) === "tok_fresh"
        ? Response.json({
            session: { id: "s1", token: "tok_fresh", userId: "user-1" },
            user: { id: "user-1", name: "Jon", email: "jon@test" },
          })
        : Response.json(null);
    }
    return Response.json(null, { status: 404 });
  },
);

function mintCalls() {
  return fetchMock.mock.calls.filter(
    ([input]) =>
      String(input instanceof Request ? input.url : input) === MINT_URL,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetAppSessionRecoveryForTests();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem(PK_KEY, "tok_revoked");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a stored app token Kova no longer knows", () => {
  it("is replaced from the cookie session, and the user comes back", async () => {
    mint = () => Response.json({ sessionToken: "tok_fresh" });
    render(<RootShell />);

    await waitFor(() =>
      expect(screen.getByTestId("who")).toHaveTextContent("user-1"),
    );
    expect(localStorage.getItem(PK_KEY)).toBe("tok_fresh");
    expect(mintCalls()).toHaveLength(1);
  });

  it("with no cookie session either, the strip says signed out, not reconnecting", async () => {
    mint = () => Response.json({ error: "Not authenticated" }, { status: 401 });
    // The gateway stopped when the user id went; it never saw a refused
    // ticket, so it reports no failure of its own.
    act(() => {
      useChatStore.setState({
        connected: false,
        reconnectAttempt: 0,
        gatewayFailure: null,
      });
    });
    render(
      <RootShell>
        <GatewayConnectionBanner initialHasConnected />
      </RootShell>,
    );

    await waitFor(() =>
      expect(
        document.querySelector("[data-slot=connection-banner]"),
      ).toHaveAttribute("data-state", "signed-out"),
    );
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting")).toBeNull();
    expect(localStorage.getItem(PK_KEY)).toBeNull();
    expect(screen.getByTestId("who")).toHaveTextContent("none");
    expect(mintCalls()).toHaveLength(1);
  });
});
