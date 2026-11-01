// @vitest-environment jsdom

/**
 * The chat gateway after its app token was revoked server-side (production,
 * 2026-11-01). The real ticket client, desktop-auth, session recovery and
 * realtime socket; only the network and the WebSocket are faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type ChatState } from "@/lib/chat-reducer";
import type { ChatRestActions } from "./chat-actions";

const PK = "pk_live_gateway";
const PK_KEY = `kova-auth:${PK}:session-token`;
const MINT_URL = `https://auth.test/api/pub/apps/${PK}/session-token`;
const TICKET_URL = "https://meet.test/api/voice/socket-ticket";

const mocks = vi.hoisted(() => ({
  bootstrapChat: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_live_gateway",
  getKovaAuthUrl: () => "https://auth.test",
}));
vi.mock("@/lib/platform", () => ({
  getApiBaseUrl: () => "https://meet.test",
  getCurrentPresencePlatform: () => "web",
  isTauri: () => false,
  wsUrl: (path: string) => `wss://meet.test${path}`,
}));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("@/lib/display-name", () => ({ getDisplayName: vi.fn() }));
vi.mock("@/lib/desktop-notifications", () => ({
  getUnreadChannelState: vi.fn(() => ({
    unreadDmChannelIds: [],
    unreadServerChannelIds: [],
  })),
  shouldNativeNotifyForChannelActivity: vi.fn(() => false),
  shouldNativeNotifyForMessage: vi.fn(() => false),
}));
vi.mock("@/lib/desktop-native-sync", () => ({
  MOBILE_ACTION_TYPE_ID: "test",
  showNativeDesktopToast: vi.fn(),
  syncDesktopNotificationState: vi.fn(),
}));
vi.mock("@/lib/presence-platform", () => ({
  normalizePresencePlatforms: (platforms: unknown) => platforms,
}));
vi.mock("@/lib/reconnect-sound-guard", () => ({
  areReconnectSoundsSuppressed: vi.fn(() => true),
  beginReconnectSoundSuppression: vi.fn(() => vi.fn()),
  getVoiceChannelPresenceSound: vi.fn(),
}));
vi.mock("@/lib/sounds", () => ({
  playCallConnect: vi.fn(),
  playCallEnd: vi.fn(),
  playNotification: vi.fn(),
  playOutgoingRingStart: vi.fn(),
  playOutgoingRingStop: vi.fn(),
  playRingStart: vi.fn(),
  playRingStop: vi.fn(),
  playVoiceJoin: vi.fn(),
  playVoiceLeave: vi.fn(),
}));
vi.mock("./useCallStore", () => ({
  useCallStore: { getState: () => ({}) },
}));
vi.mock("./useDesktopSettingsStore", () => ({
  useDesktopSettingsStore: {
    getState: () => ({ desktopNotifications: false }),
  },
}));
vi.mock("./useSoundSettingsStore", () => ({
  isSoundEnabled: vi.fn(() => false),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(message: { op: number; d?: unknown }) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

/** Bearer tokens Ralph accepts for a ticket. */
let validTokens: Set<string>;
/** Kova's session-token mint: the cookie session, or none. */
let mint: () => Response;

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === MINT_URL) return mint();
    if (url === TICKET_URL) {
      const bearer = new Headers(init?.headers)
        .get("Authorization")
        ?.replace(/^Bearer /, "");
      return bearer && validTokens.has(bearer)
        ? Response.json({ ticket: `ticket_${bearer}` })
        : Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
);

const signedOutMint = () =>
  Response.json({ error: "Not authenticated" }, { status: 401 });

function mintCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input) === MINT_URL);
}

async function createFixture() {
  // Fresh module state (mint in flight, cooldown, rejected tokens) per test.
  vi.resetModules();
  const { createChatGateway } = await import("./chat-gateway");
  const state: ChatState = {
    ...initialState,
    user: { ...initialState.user, id: "user-1" } as NonNullable<
      ChatState["user"]
    >,
    activeChannelId: "channel-1",
  };
  const dispatch = vi.fn();
  const actions = {
    bootstrapChat: mocks.bootstrapChat,
    loadMessages: mocks.loadMessages,
  } as unknown as ChatRestActions;
  const gateway = createChatGateway(() => state, dispatch, actions);
  return { gateway, dispatch };
}

const authFailure = { type: "SET_GATEWAY_FAILURE", failure: "auth" };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  mocks.bootstrapChat.mockReset().mockResolvedValue(undefined);
  mocks.loadMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMoreBefore: false,
    hasMoreAfter: false,
  });
  validTokens = new Set(["tok_fresh"]);
  mint = () => Response.json({ sessionToken: "tok_fresh" });
  localStorage.setItem(PK_KEY, "tok_revoked");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat gateway with a revoked app token", () => {
  it("re-mints on the refused ticket and connects, never showing signed out", async () => {
    const { gateway, dispatch } = await createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(mintCalls()).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.protocols).toEqual(
      expect.arrayContaining([expect.stringContaining("ticket_tok_fresh")]),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatch).not.toHaveBeenCalledWith(authFailure);
    expect(localStorage.getItem(PK_KEY)).toBe("tok_fresh");
    gateway.disconnectGateway();
  });

  it("signed out after two refusals, then a wake after signing in elsewhere re-mints and reconnects", async () => {
    mint = signedOutMint;
    const { gateway, dispatch } = await createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(1600);

    expect(dispatch).toHaveBeenCalledWith(authFailure);
    expect(FakeWebSocket.instances).toHaveLength(0);
    // Two refused tickets, one mint: the second refusal is in the cooldown.
    expect(mintCalls()).toHaveLength(1);
    expect(localStorage.getItem(PK_KEY)).toBeNull();

    // The Kova cookie session is back (signed in in another tab).
    mint = () => Response.json({ sessionToken: "tok_fresh" });
    await vi.advanceTimersByTimeAsync(16_000);
    gateway.wake();
    await vi.advanceTimersByTimeAsync(0);

    expect(mintCalls()).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const failures = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "SET_GATEWAY_FAILURE");
    expect(failures.at(-1)).toEqual({
      type: "SET_GATEWAY_FAILURE",
      failure: null,
    });
    gateway.disconnectGateway();
  });

  it("a wake while the user id is gone re-checks the session", async () => {
    mint = signedOutMint;
    const { gateway } = await createFixture();
    const recovery = await import("@/lib/app-session-recovery");
    await recovery.recoverAppSession("tok_revoked");
    expect(recovery.getAppSessionState()).toBe("signed-out");
    // The SDK's get-session found no session: the gateway has no user id.
    gateway.setGatewayUserId(null);

    mint = () => Response.json({ sessionToken: "tok_fresh" });
    await vi.advanceTimersByTimeAsync(16_000);
    gateway.wake();
    await vi.advanceTimersByTimeAsync(0);

    expect(mintCalls()).toHaveLength(2);
    expect(localStorage.getItem(PK_KEY)).toBe("tok_fresh");
    expect(recovery.getAppSessionState()).toBe("active");
  });

  it("the user id going away and coming back is a reconnect that reloads, not a cold load", async () => {
    validTokens.add("tok_revoked");
    const { gateway, dispatch } = await createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    first.message({ op: 2, d: { participant_id: "session-1" } });

    // ChatGateway's order: the user id effect, then initGateway.
    gateway.setGatewayUserId(null);
    dispatch.mockClear();
    gateway.initGateway("user-1");
    gateway.setGatewayUserId("user-1");
    await vi.advanceTimersByTimeAsync(0);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    second.message({ op: 2, d: { participant_id: "session-2" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatch).not.toHaveBeenCalledWith({
      type: "SET_CONNECT_STEP",
      step: 0,
    });
    expect(mocks.bootstrapChat).toHaveBeenCalled();
    expect(mocks.loadMessages).toHaveBeenCalledWith("channel-1");
    gateway.disconnectGateway();
  });
});
