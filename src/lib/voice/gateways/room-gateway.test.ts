import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceOpcode } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
  fetchSocketTicketBundle: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
  fetchSocketTicketBundle: mocks.fetchSocketTicketBundle,
}));

import { RoomGateway } from "./room-gateway";

class TestWebSocket {
  static instances: TestWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    TestWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = TestWebSocket.CLOSED;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  message(message: { op: number; d?: unknown }): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function sentMessages(socket: TestWebSocket) {
  return socket.sent.map(
    (message) => JSON.parse(message) as { op: number; d?: unknown },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("RoomGateway", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    mocks.fetchSocketTicketBundle.mockReset();
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    mocks.fetchSocketTicketBundle.mockResolvedValue({
      protocols: ["ralph.realtime.v1", "ralph.ticket.test"],
    });
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  it("emits media bootstrap before constructing the room WebSocket", async () => {
    const ticket = deferred<{
      mediaBootstrap: { participantId: string; voiceToken: string };
      protocols: string[];
    }>();
    mocks.fetchSocketTicketBundle.mockReturnValue(ticket.promise);
    const gateway = new RoomGateway();
    const constructionCounts: number[] = [];
    const onBootstrap = vi.fn(() => {
      constructionCounts.push(TestWebSocket.instances.length);
    });
    gateway.on("media-bootstrap", onBootstrap);

    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    expect(TestWebSocket.instances).toHaveLength(0);
    ticket.resolve({
      mediaBootstrap: {
        participantId: "reserved-participant",
        voiceToken: "bootstrap-token",
      },
      protocols: ["ralph.realtime.v1", "ralph.ticket.test"],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onBootstrap).toHaveBeenCalledWith({
      participantId: "reserved-participant",
      voiceToken: "bootstrap-token",
    });
    expect(constructionCounts).toEqual([0]);
    expect(TestWebSocket.instances).toHaveLength(1);
    gateway.disconnect();
  });

  it("suppresses bootstrap from a stale ticket fetch generation", async () => {
    const first = deferred<{
      mediaBootstrap: { participantId: string; voiceToken: string };
      protocols: string[];
    }>();
    const second = deferred<{
      mediaBootstrap: { participantId: string; voiceToken: string };
      protocols: string[];
    }>();
    mocks.fetchSocketTicketBundle
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const gateway = new RoomGateway();
    const onBootstrap = vi.fn();
    gateway.on("media-bootstrap", onBootstrap);

    gateway.connectRoom({
      name: "First",
      roomSlug: "voice-first",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    gateway.connectRoom({
      name: "Second",
      roomSlug: "voice-second",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    first.resolve({
      mediaBootstrap: { participantId: "stale", voiceToken: "stale-token" },
      protocols: ["ralph.realtime.v1", "ralph.ticket.stale"],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onBootstrap).not.toHaveBeenCalled();

    second.resolve({
      mediaBootstrap: { participantId: "current", voiceToken: "fresh-token" },
      protocols: ["ralph.realtime.v1", "ralph.ticket.current"],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onBootstrap).toHaveBeenCalledOnce();
    expect(onBootstrap).toHaveBeenCalledWith({
      participantId: "current",
      voiceToken: "fresh-token",
    });
    expect(mocks.fetchSocketTicketBundle).toHaveBeenCalledTimes(2);
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(TestWebSocket.instances[0]?.url).toBe(
      "ws://meet.test/api/channels/voice-second/ws?v=1",
    );
    gateway.disconnect();
  });

  it("advertises voice-state delta support on initial and fallback Identify", async () => {
    const gateway = new RoomGateway();
    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.message({
      op: VoiceOpcode.Hello,
      d: { heartbeat_interval: 45_000 },
    });
    socket.message({
      op: VoiceOpcode.Ready,
      d: {
        participant_id: "session-1",
        ice_servers: [],
        participants: [],
        voice_token: "voice-token",
      },
    });
    socket.message({
      op: VoiceOpcode.Error,
      d: { code: 4006, message: "Continuity lost" },
    });

    const identifyMessages = sentMessages(socket).filter(
      (message) => message.op === VoiceOpcode.Identify,
    );
    expect(identifyMessages).toEqual([
      {
        op: VoiceOpcode.Identify,
        d: expect.objectContaining({
          clerk_user_id: "user-1",
          supports_voice_state_deltas: true,
        }),
      },
      {
        op: VoiceOpcode.Identify,
        d: expect.objectContaining({
          clerk_user_id: "user-1",
          supports_voice_state_deltas: true,
        }),
      },
    ]);

    gateway.disconnect();
  });

  it("identifies a standby session and clears that flag when promoted", async () => {
    const gateway = new RoomGateway();
    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      standby: true,
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.message({
      op: VoiceOpcode.Hello,
      d: { heartbeat_interval: 45_000 },
    });
    socket.message({
      op: VoiceOpcode.Error,
      d: { code: 4006, message: "Continuity lost" },
    });
    socket.message({
      op: VoiceOpcode.Ready,
      d: {
        participant_id: "session-1",
        ice_servers: [],
        participants: [],
        voice_token: "voice-token",
      },
    });
    gateway.promoteStandby();
    socket.message({
      op: VoiceOpcode.Error,
      d: { code: 4006, message: "Continuity lost" },
    });

    const identifyMessages = sentMessages(socket).filter(
      (message) => message.op === VoiceOpcode.Identify,
    );
    expect(identifyMessages.map((message) => message.d)).toEqual([
      expect.objectContaining({ clerk_user_id: "user-1", standby: true }),
      expect.objectContaining({ clerk_user_id: "user-1", standby: true }),
      expect.not.objectContaining({ standby: true }),
    ]);
    expect(sentMessages(socket)).toContainEqual({
      op: VoiceOpcode.VoiceStateUpdate,
      d: { promote_standby: true },
    });

    gateway.disconnect();
  });

  it("sends a profile refresh through the existing opcode", async () => {
    const gateway = new RoomGateway();
    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.message({
      op: VoiceOpcode.Hello,
      d: { heartbeat_interval: 45_000 },
    });
    socket.message({
      op: VoiceOpcode.Ready,
      d: {
        participant_id: "session-1",
        ice_servers: [],
        participants: [],
        voice_token: "voice-token",
      },
    });

    gateway.refreshProfile();

    expect(sentMessages(socket)).toContainEqual({
      op: VoiceOpcode.ProfileRefresh,
      d: {},
    });
    gateway.disconnect();
  });

  it("emits MediaReady credentials from its discriminated server payload", async () => {
    const gateway = new RoomGateway();
    const onMediaReady = vi.fn();
    gateway.on("media-ready", onMediaReady);
    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.message({
      op: VoiceOpcode.MediaReady,
      d: {
        participant_id: "participant-1",
        ice_servers: [{ urls: ["stun:example.test"] }],
        voice_token: "voice-token",
      },
    });

    expect(onMediaReady).toHaveBeenCalledWith({
      participantId: "participant-1",
      iceServers: [{ urls: ["stun:example.test"] }],
      voiceToken: "voice-token",
    });
    gateway.disconnect();
  });

  it("resumes from the latest event sequence instead of a heartbeat ACK", async () => {
    const gateway = new RoomGateway();
    gateway.connectRoom({
      name: "Test User",
      clerkUserId: "user-1",
      roomSlug: "voice-server-channel",
      wsUrlGenerator: (path) => `ws://meet.test${path}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = TestWebSocket.instances[0]!;
    first.readyState = TestWebSocket.OPEN;
    first.message({
      op: VoiceOpcode.Hello,
      d: { heartbeat_interval: 45_000 },
    });
    first.message({
      op: VoiceOpcode.Ready,
      d: {
        participant_id: "session-1",
        ice_servers: [],
        participants: [],
        voice_token: "voice-token",
      },
    });
    first.message({
      op: VoiceOpcode.ProfileUpdate,
      d: {
        seq: 12,
        participant_id: "remote",
        name: "Remote",
      },
    });
    first.message({
      op: VoiceOpcode.HeartbeatACK,
      d: { seq: 99 },
    });

    gateway.forceReconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = TestWebSocket.instances[1]!;
    second.readyState = TestWebSocket.OPEN;
    second.message({
      op: VoiceOpcode.Hello,
      d: { heartbeat_interval: 45_000 },
    });

    expect(sentMessages(second)).toContainEqual({
      op: VoiceOpcode.Resume,
      d: { session_id: "session-1", seq_ack: 12 },
    });

    gateway.disconnect();
  });
});
