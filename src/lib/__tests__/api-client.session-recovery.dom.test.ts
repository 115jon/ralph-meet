// @vitest-environment jsdom

/**
 * A stored Kova app token revoked server-side while the auth-domain cookie
 * session is still valid (production, 2026-11-01): every Ralph call answered
 * 401 and the client never asked Kova for a new token. These drive the real
 * api-client, desktop-auth and app-session-recovery; only the network is
 * faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PK = "pk_live_recovery";
const PK_KEY = `kova-auth:${PK}:session-token`;
const MINT_URL = `https://auth.test/api/pub/apps/${PK}/session-token`;

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_live_recovery",
  getKovaAuthUrl: () => "https://auth.test",
}));
vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => `https://meet.test${path}`,
  isTauri: () => "__TAURI_INTERNALS__" in window,
}));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { markAuthLogoutIntent } from "@/lib/desktop-auth";

/** Bearer tokens Ralph accepts; anything else is a 401. */
let validTokens: Set<string>;
/** What Kova's session-token mint answers (cookie session or not). */
let mint: () => Response;

function bearerOf(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers);
  return headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === MINT_URL) return mint();
    const token = bearerOf(init);
    if (!token || !validTokens.has(token)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: true, url, token });
  },
);

function mintCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input) === MINT_URL);
}

function setTauri(on: boolean) {
  const w = window as { __TAURI_INTERNALS__?: unknown };
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  validTokens = new Set(["tok_fresh"]);
  mint = () => Response.json({ sessionToken: "tok_fresh" });
  localStorage.setItem(PK_KEY, "tok_revoked");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTauri(false);
});

async function freshClient() {
  // Module state (in-flight mint, cooldown, rejected tokens) per test.
  vi.resetModules();
  const api = await import("@/lib/api-client");
  const auth = await import("@/lib/desktop-auth");
  return { apiGet: api.apiGet, auth };
}

describe("api-client 401 recovery (web)", () => {
  it("re-mints the app token once and retries the refused call", async () => {
    const { apiGet } = await freshClient();

    await expect(apiGet("/api/users/me")).resolves.toMatchObject({
      ok: true,
      token: "tok_fresh",
    });
    expect(mintCalls()).toHaveLength(1);
    const [, mintInit] = mintCalls()[0]!;
    expect(mintInit).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(new Headers(mintInit?.headers).get("X-Publishable-Key")).toBe(PK);
    // Stored for every later call, the SDK and the sockets.
    expect(localStorage.getItem(PK_KEY)).toBe("tok_fresh");
  });

  it("shares one mint between concurrent refused calls", async () => {
    const { apiGet } = await freshClient();

    const results = await Promise.all([
      apiGet("/api/users/me"),
      apiGet("/api/servers"),
      apiGet("/api/presence"),
      apiGet("/api/dms"),
    ]);

    expect(results).toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({ token: "tok_fresh" }),
      ),
    );
    expect(mintCalls()).toHaveLength(1);
  });

  it("goes signed out (token cleared) when Kova has no session either", async () => {
    mint = () => Response.json({ error: "Not authenticated" }, { status: 401 });
    const { apiGet } = await freshClient();

    await expect(apiGet("/api/users/me")).rejects.toMatchObject({
      status: 401,
    });
    expect(mintCalls()).toHaveLength(1);
    expect(localStorage.getItem(PK_KEY)).toBeNull();
    const { getAppSessionState } = await import("@/lib/app-session-recovery");
    expect(getAppSessionState()).toBe("signed-out");
  });

  it("does not loop when a freshly minted token is refused too", async () => {
    validTokens = new Set();
    const { apiGet } = await freshClient();

    await expect(apiGet("/api/users/me")).rejects.toMatchObject({
      status: 401,
    });
    await expect(apiGet("/api/servers")).rejects.toMatchObject({
      status: 401,
    });
    expect(mintCalls()).toHaveLength(1);
  });

  it("does not mint while a sign-out is in progress", async () => {
    markAuthLogoutIntent();
    const { apiGet } = await freshClient();

    await expect(apiGet("/api/users/me")).rejects.toMatchObject({
      status: 401,
    });
    expect(mintCalls()).toHaveLength(0);
  });
});

describe("api-client 401 recovery (desktop)", () => {
  beforeEach(() => {
    setTauri(true);
    localStorage.setItem("desktop_auth_token", "tok_revoked");
  });

  it("re-mints and retries when the webview still has a Kova session", async () => {
    const { apiGet } = await freshClient();

    await expect(apiGet("/api/users/me")).resolves.toMatchObject({
      token: "tok_fresh",
    });
    expect(localStorage.getItem("desktop_auth_token")).toBe("tok_fresh");
  });

  it("asks for the device-code sign-in instead of hanging", async () => {
    mint = () => Response.json({ error: "Not authenticated" }, { status: 401 });
    const { apiGet, auth } = await freshClient();

    await expect(apiGet("/api/users/me")).rejects.toMatchObject({
      code: "DESKTOP_AUTH_REQUIRED",
    });
    expect(auth.getDesktopAuthHandoffToken()).toBeNull();
  });
});
