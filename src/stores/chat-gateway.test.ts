import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type ChatState } from "@/lib/chat-reducer";
import type { ChatRestActions } from "./chat-actions";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
  bootstrapChat: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
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
