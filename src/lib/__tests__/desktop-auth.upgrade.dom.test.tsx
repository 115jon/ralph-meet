// @vitest-environment jsdom

/**
 * 3.0.0 → 3.1.0 upgrade: the Kova publishable key moved from pk_dev_* to
 * pk_live_*. Boots the real KovaAuthProvider (with the root layout's token
 * wiring) and the real DesktopLogin on top of localStorage seeded the way a
 * 3.0.0 install leaves it, with only the network faked.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OLD_PK = "pk_dev_fhygLR-eApZ4HvSfu-v-LEGFp7WAsgkLRhlveveNzhk";
const NEW_PK = "pk_live_yl2Z9ssEwlWuOYHVRWozk9WThozu4nFP3QAhCWAsPhE";
const TOKEN = "tok_issued_to_300";
const OLD_KEY = `kova-auth:${OLD_PK}:session-token`;
const NEW_KEY = `kova-auth:${NEW_PK}:session-token`;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  meStatus: 200,
}));

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY:
    "pk_live_yl2Z9ssEwlWuOYHVRWozk9WThozu4nFP3QAhCWAsPhE",
  KOVA_AUTH_URL: "https://auth.test",
  getKovaAuthUrl: () => "https://auth.test",
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Navigate: () => null,
}));
vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => `https://api.test${path}`,
  isMobile: () => false,
  isWindows: () => true,
}));
vi.mock("@/components/SplashScreen", () => ({
  SplashScreen: () => <div data-testid="splash" />,
}));
vi.mock("@/components/ThemeAwareSplashLogo", () => ({
  ThemeAwareSplashLogo: () => <span />,
}));

import DesktopLogin from "@/components/DesktopLogin";
import {
  getDesktopAuthHandoffToken,
  handleKovaSessionTokenChange,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import { KovaAuthProvider } from "@kova/react";

/** RootComponent's provider wiring (src/routes/__root.tsx). */
function DesktopShell() {
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const state = useRef({ seenSessionToken: false });
  useEffect(() => {
    // Same post-mount read as RootComponent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionToken(getDesktopAuthHandoffToken() ?? undefined);
    return subscribeDesktopTokenChanges((token) =>
      setSessionToken(token ?? undefined),
    );
  }, []);
  return (
    <KovaAuthProvider
      authUrl="https://auth.test"
      publishableKey={NEW_PK}
      afterSignInUrl="/chat"
      afterSignOutUrl="/sign-in"
      initialSessionToken={sessionToken}
      onSessionTokenChange={(token: string | null) => {
        setSessionToken(token ?? undefined);
        handleKovaSessionTokenChange(token, state.current);
      }}
    >
      <DesktopLogin />
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

/** Kova accepts the session for this app under either key; so does the API. */
const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers,
  );
  const bearer = headers.get("authorization") === `Bearer ${TOKEN}`;
  if (url === "https://api.test/api/users/me") {
    return json({}, bearer ? mocks.meStatus : 401);
  }
  if (url.endsWith("/api/auth/get-session")) {
    return json(
      bearer
        ? { session: { id: "s1", token: TOKEN }, user: { id: "u1" } }
        : null,
    );
  }
  return json(null, 404);
});

function meCalls() {
  return fetchMock.mock.calls.filter(
    ([input]) => String(input) === "https://api.test/api/users/me",
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.navigate.mockReset();
  mocks.meStatus = 200;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  return () => {
    vi.unstubAllGlobals();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  };
});

async function expectSignedIn() {
  await waitFor(
    () =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/chat",
        replace: true,
      }),
    { timeout: 4000 },
  );
  expect(meCalls()).toHaveLength(1);
  expect(new Headers(meCalls()[0]![1]?.headers).get("authorization")).toBe(
    `Bearer ${TOKEN}`,
  );
  expect(screen.queryByText("Sign in with browser")).not.toBeInTheDocument();
}

describe("3.0.0 → 3.1.0 publishable key change", () => {
  it("adopts a session stored only under the old pk's key", async () => {
    // The SDK writes its pk-scoped key before reporting a token, so a token
    // that reached 3.0.0 through the SDK never got desktop_auth_token.
    localStorage.setItem(OLD_KEY, TOKEN);

    render(<DesktopShell />);

    await expectSignedIn();
    expect(localStorage.getItem(NEW_KEY)).toBe(TOKEN);
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
    await waitFor(() =>
      expect(localStorage.getItem("desktop_auth_token")).toBe(TOKEN),
    );
  });

  it("adopts a pre-Kova ralph-auth key from the old pk too", async () => {
    localStorage.setItem(`ralph-auth:${OLD_PK}:session-token`, TOKEN);

    render(<DesktopShell />);

    await expectSignedIn();
    expect(localStorage.getItem(NEW_KEY)).toBe(TOKEN);
  });

  it("keeps a full 3.0.0 session and wipes nothing before validating it", async () => {
    localStorage.setItem("desktop_auth_token", TOKEN);
    localStorage.setItem(OLD_KEY, TOKEN);
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const removedBeforeValidation: string[] = [];
    fetchMock.mockImplementationOnce((input, init) => {
      removedBeforeValidation.push(
        ...removeItem.mock.calls.map(([key]) => String(key)),
      );
      return fetchMock.getMockImplementation()!(input, init);
    });

    render(<DesktopShell />);

    await expectSignedIn();
    expect(removedBeforeValidation).not.toContain("desktop_auth_token");
    expect(localStorage.getItem("desktop_auth_token")).toBe(TOKEN);
    expect(localStorage.getItem(NEW_KEY)).toBe(TOKEN);
    removeItem.mockRestore();
  });

  it("still clears every key when the API rejects the adopted session", async () => {
    mocks.meStatus = 401;
    localStorage.setItem(OLD_KEY, TOKEN);

    render(<DesktopShell />);

    await screen.findByRole(
      "button",
      { name: "Sign in with browser" },
      {
        timeout: 4000,
      },
    );
    expect(localStorage.getItem(NEW_KEY)).toBeNull();
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
    expect(localStorage.getItem("desktop_auth_token")).toBeNull();
  });

  it("shows sign-in when 3.0.0 had already signed out (nothing to adopt)", async () => {
    // What this machine's CEF localStorage shows: 3.0.0's Settings → Sign out
    // deleted both keys at 07:29 CDT, hours before the 3.1.0 install.
    render(<DesktopShell />);

    await screen.findByRole(
      "button",
      { name: "Sign in with browser" },
      {
        timeout: 4000,
      },
    );
    expect(meCalls()).toHaveLength(0);
  });
});
