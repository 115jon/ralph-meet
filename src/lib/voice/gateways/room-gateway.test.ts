import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceOpcode } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
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

describe("RoomGateway", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    vi.stubGlobal("WebSocket", TestWebSocket);
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
