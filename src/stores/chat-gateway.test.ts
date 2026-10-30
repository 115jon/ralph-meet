import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type ChatState } from "@/lib/chat-reducer";
import type { ChatRestActions } from "./chat-actions";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
  bootstrapChat: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
  SocketTicketError: class extends Error {
    constructor(readonly status: number) {
      super(`Socket ticket request failed (${status})`);
    }
  },
}));
vi.mock("@/lib/platform", () => ({
  getCurrentPresencePlatform: () => "web",
  isTauri: false,
  wsUrl: (path: string) => `wss://meet.test${path}`,
}));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
vi.mock("@/lib/voice/heartbeat-manager", () => ({
  HeartbeatManager: class {
    start = vi.fn();
    stop = vi.fn();
    onAck = vi.fn();
  },
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

import { createChatGateway } from "./chat-gateway";
import { SocketTicketError } from "@/lib/voice/socket-ticket-client";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
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
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(message: { op: number; d?: unknown }) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  disconnect(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

function sentMessages(socket: FakeWebSocket) {
  return socket.sent.map(
    (message) =>
      JSON.parse(message) as { op: number; d?: Record<string, unknown> },
  );
}

function createFixture() {
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

describe("chat gateway continuity", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockResolvedValue([]);
    mocks.bootstrapChat.mockResolvedValue(undefined);
    mocks.loadMessages.mockResolvedValue({
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
    });
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("resumes with the last dispatch cursor and becomes usable on Resumed", async () => {
    const { gateway } = createFixture();
    gateway.initGateway("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    expect(sentMessages(first)).toContainEqual({
      op: 0,
      d: expect.objectContaining({
        clerk_user_id: "user-1",
        supports_voice_state_deltas: true,
      }),
    });
    first.message({ op: 2, d: { participant_id: "session-1" } });
    first.message({
      op: 19,
      d: { seq: 7, event: "GUILD_UPDATE", data: { id: "server-1" } },
    });
    first.message({ op: 6, d: { seq: 99 } });
    first.disconnect();

    gateway.initGateway("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.message({ op: 8, d: { heartbeat_interval: 45_000 } });

    expect(sentMessages(second)).toContainEqual({
      op: 7,
      d: { session_id: "session-1", seq_ack: 7 },
    });
    expect(sentMessages(second)).not.toContainEqual(
      expect.objectContaining({ op: 0 }),
    );

    second.message({ op: 9, d: {} });
    gateway.subscribeServer("server-1");
    expect(sentMessages(second)).toContainEqual({
      op: 35,
      d: { server_id: "server-1" },
    });

    gateway.disconnectGateway();
  });

  it("falls back to Identify and reconciliation when Resume loses continuity", async () => {
    const { gateway } = createFixture();
    gateway.initGateway("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    first.message({ op: 2, d: { participant_id: "session-1" } });
    first.message({
      op: 19,
      d: { seq: 4, event: "GUILD_UPDATE", data: { id: "server-1" } },
    });
    first.disconnect();

    gateway.initGateway("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    second.message({
      op: 18,
      d: { code: 4006, message: "Continuity lost" },
    });

    expect(sentMessages(second)).toContainEqual({
      op: 0,
      d: expect.objectContaining({
        clerk_user_id: "user-1",
        supports_voice_state_deltas: true,
      }),
    });
    expect(gateway.getSessionId()).toBeNull();

    second.message({ op: 2, d: { participant_id: "fresh-session" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.bootstrapChat).toHaveBeenCalled();
    expect(mocks.loadMessages).toHaveBeenCalledWith("channel-1");

    gateway.disconnectGateway();
  });

  it("does not resume the previous user session after an identity change", async () => {
    const { gateway } = createFixture();
    gateway.initGateway("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    first.message({ op: 2, d: { participant_id: "session-1" } });
    first.message({
      op: 19,
      d: { seq: 4, event: "GUILD_UPDATE", data: { id: "server-1" } },
    });
    first.disconnect();

    gateway.setClerkUserId("user-2");
    gateway.initGateway("user-2");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.message({ op: 8, d: { heartbeat_interval: 45_000 } });

    expect(sentMessages(second)).toContainEqual({
      op: 0,
      d: expect.objectContaining({ clerk_user_id: "user-2" }),
    });
    expect(sentMessages(second)).not.toContainEqual(
      expect.objectContaining({ op: 7 }),
    );

    gateway.disconnectGateway();
  });
});

describe("chat gateway wake", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockResolvedValue([]);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function connected() {
    const fixture = createFixture();
    fixture.gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    return { ...fixture, socket };
  }

  it("retries at once instead of waiting out the backoff", async () => {
    const { gateway, socket } = await connected();
    socket.disconnect();
    // Two failed attempts push the backoff past 2s.
    await vi.advanceTimersByTimeAsync(1600);
    FakeWebSocket.instances.at(-1)!.disconnect();
    const before = FakeWebSocket.instances.length;

    gateway.wake();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances.length).toBe(before + 1);
    gateway.disconnectGateway();
  });

  it("probes an open socket and keeps it when it answers", async () => {
    const { gateway, socket, dispatch } = await connected();

    gateway.wake();
    expect(sentMessages(socket)).toContainEqual({ op: 3 });
    socket.message({ op: 6 });
    await vi.advanceTimersByTimeAsync(6000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "SET_CONNECTED",
      connected: false,
    });
    gateway.disconnectGateway();
  });

  it("drops a socket that died while the page slept and reconnects", async () => {
    const { gateway, dispatch } = await connected();

    gateway.wake();
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_CONNECTED",
      connected: false,
    });

    await vi.advanceTimersByTimeAsync(1600);
    expect(FakeWebSocket.instances).toHaveLength(2);
    gateway.disconnectGateway();
  });

  it("does nothing after an intentional disconnect", async () => {
    const { gateway } = await connected();
    gateway.disconnectGateway();

    gateway.wake();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("chat gateway sign-in failure and first-load steps", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a single 401 on the normal backoff without saying signed out", async () => {
    mocks.fetchSocketProtocols
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_GATEWAY_FAILURE", failure: "auth" }),
    );
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_GATEWAY_FAILURE", failure: "auth" }),
    );
    gateway.disconnectGateway();
  });

  it("reports auth after two 401s in a row, then retries only once a minute", async () => {
    mocks.fetchSocketProtocols.mockRejectedValue(new SocketTicketError(401));
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(1600);

    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_GATEWAY_FAILURE",
      failure: "auth",
    });
    const attemptsBefore = dispatch.mock.calls.filter(
      ([action]) => action.type === "SET_RECONNECT_ATTEMPT",
    ).length;

    await vi.advanceTimersByTimeAsync(59_000);
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(4);
    // The slow retry is not a reconnect attempt: the strip keeps "Signed out".
    expect(
      dispatch.mock.calls.filter(
        ([action]) => action.type === "SET_RECONNECT_ATTEMPT",
      ),
    ).toHaveLength(attemptsBefore);
    gateway.disconnectGateway();
  });

  it("a 401 then a 503 is not two refusals in a row", async () => {
    mocks.fetchSocketProtocols
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockRejectedValueOnce(new SocketTicketError(503))
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(4);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_GATEWAY_FAILURE", failure: "auth" }),
    );
    gateway.disconnectGateway();
  });

  it("the slow retry clears signed out once the session is back", async () => {
    mocks.fetchSocketProtocols
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(1600);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "SET_GATEWAY_FAILURE",
      failure: "auth",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_GATEWAY_FAILURE",
      failure: null,
    });
    gateway.disconnectGateway();
  });

  it("keeps retrying with backoff on other ticket failures", async () => {
    mocks.fetchSocketProtocols.mockRejectedValue(new SocketTicketError(503));
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_GATEWAY_FAILURE", failure: "auth" }),
    );
    await vi.advanceTimersByTimeAsync(1600);
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    gateway.disconnectGateway();
  });

  it("tries once more when the page comes back, and clears the failure on success", async () => {
    mocks.fetchSocketProtocols
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockRejectedValueOnce(new SocketTicketError(401))
      .mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(1600);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_GATEWAY_FAILURE",
      failure: "auth",
    });

    gateway.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_GATEWAY_FAILURE",
      failure: null,
    });
    gateway.disconnectGateway();
  });

  it("reports the first-load steps: ticket, socket, ready", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    socket.message({ op: 2, d: { participant_id: "session-1" } });

    const steps = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "SET_CONNECT_STEP")
      .map((action) => action.step);
    expect(steps).toEqual([0, 1, 2, 3]);
    gateway.disconnectGateway();
  });

  it("leaving /chat after Ready keeps step 3, so coming back is a reconnect", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ op: 8, d: { heartbeat_interval: 45_000 } });
    socket.message({ op: 2, d: { participant_id: "session-1" } });

    gateway.disconnectGateway();
    dispatch.mockClear();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.instances[1]!.open();

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_CONNECT_STEP" }),
    );
    gateway.disconnectGateway();
  });

  it("leaving /chat before Ready resets to step 0 for a clean cold load", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([]);
    const { gateway, dispatch } = createFixture();
    gateway.initGateway("user-1");
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.instances[0]!.open();

    dispatch.mockClear();
    gateway.disconnectGateway();
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_CONNECT_STEP",
      step: 0,
    });
  });
});
