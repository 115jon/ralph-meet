// @vitest-environment jsdom

/**
 * The chat page's auth gate (useChatPageLogic) waits on the desktop token
 * event and no longer polls. That is only safe if the Kova SDK's own write of
 * its pk-scoped session key always produces the event. Boots the real
 * KovaAuthProvider with the root layout's wiring (src/routes/__root.tsx),
 * lets it mint an app session token, and checks the event fires after the
 * SDK's write, on the web and on desktop. Only the network is faked.
 */

import { render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PK = "pk_live_token_event";
const TOKEN = "tok_minted_by_sdk";
const PK_KEY = `kova-auth:${PK}:session-token`;

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_live_token_event",
  KOVA_AUTH_URL: "https://auth.test",
  getKovaAuthUrl: () => "https://auth.test",
}));

import {
  getDesktopAuthHandoffToken,
  handleKovaSessionTokenChange,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import { KovaAuthProvider } from "@kova/react";

/** RootComponent's provider wiring. */
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
      <span />
    </KovaAuthProvider>
  );
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** A cookie session exists; the SDK mints the app's bearer token from it. */
const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `https://auth.test/api/pub/apps/${PK}/session-token`) {
    return json({ sessionToken: TOKEN });
  }
  if (url.endsWith("/api/auth/get-session")) return json(null);
  return json(null, 404);
});

function setTauri(on: boolean) {
  const w = window as { __TAURI_INTERNALS__?: unknown };
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

/** Records each event with what the SDK's pk key held when it fired. */
function recordTokenEvents() {
  const events: { token: string | null; pkKey: string | null }[] = [];
  const unsubscribe = subscribeDesktopTokenChanges((token) => {
    events.push({ token, pkKey: localStorage.getItem(PK_KEY) });
  });
  return { events, unsubscribe };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTauri(false);
});

describe("token event after the Kova SDK's own session write", () => {
  it.each([
    ["web", false],
    ["desktop", true],
  ])("fires on the %s", async (_runtime, tauri) => {
    setTauri(tauri);
    const { events, unsubscribe } = recordTokenEvents();

    render(<RootShell />);

    await waitFor(() =>
      expect(events).toContainEqual({ token: TOKEN, pkKey: TOKEN }),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(`/apps/${PK}/session-token`),
      ),
    ).toBe(true);
    expect(localStorage.getItem("desktop_auth_token")).toBe(
      tauri ? TOKEN : null,
    );
    unsubscribe();
  });

  it("fires on the web even when the slot already held the token", async () => {
    // A second report of the same token (initialSessionToken round trip, or
    // the 50 s token sync) still announces itself.
    localStorage.setItem(PK_KEY, TOKEN);
    const { events, unsubscribe } = recordTokenEvents();

    render(<RootShell />);

    await waitFor(() =>
      expect(events).toContainEqual({ token: TOKEN, pkKey: TOKEN }),
    );
    unsubscribe();
  });
});
