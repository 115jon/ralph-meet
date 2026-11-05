import { GatewayOp } from "@ralph/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tickets", () => ({
  acquireRoomTicket: vi.fn(),
  acquireVoiceTicket: vi.fn(async () => ({ url: "wss://meet.test/voice" })),
  beginCallAdmission: vi.fn(),
}));

import { VoiceSocket, type VoiceSocketHandlers } from "./gateways";

class TestWebSocket {
  static instances: TestWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
}

function handlers(): VoiceSocketHandlers {
  return {
    voiceReady: vi.fn(),
    trackOffered: vi.fn(),
    speaking: vi.fn(),
    clientDisconnect: vi.fn(),
    stopTracks: vi.fn(),
    republishRequest: vi.fn(),
    appEvent: vi.fn(),
    error: vi.fn(),
    disconnected: vi.fn(),
  };
}

const target = { serverId: "s", channelId: "c", roomSlug: "voice-s-c" };

describe("VoiceSocket", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  it("identifies again with a refreshed token after the voice room refused an expired one", async () => {
    const voice = new VoiceSocket(target, handlers());
    voice.connectVoice("participant-1", "expired-token");
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onopen?.({} as Event);
    socket.receive({ op: GatewayOp.Hello, d: { heartbeat_interval: 15_000 } });
    // The voice room refuses the identify and keeps the socket open.
    socket.receive({
      op: GatewayOp.Error,
      d: { code: 4004, message: "Voice token expired" },
    });

    voice.updateVoiceToken("fresh-token");

    expect(
      socket.sent
        .map((frame) => JSON.parse(frame) as { op: number; d?: unknown })
        .filter((frame) => frame.op === GatewayOp.VoiceIdentify)
        .map((frame) => (frame.d as { voice_token: string }).voice_token),
    ).toEqual(["expired-token", "fresh-token"]);
    voice.stop();
  });

  it("gives up for good when the voice moved to another device (4010)", async () => {
    const events = handlers();
    const voice = new VoiceSocket(target, events);
    voice.connectVoice("participant-1", "token");
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onopen?.({} as Event);
    socket.receive({ op: GatewayOp.Hello, d: { heartbeat_interval: 15_000 } });

    socket.onclose?.({
      code: 4010,
      reason: "Voice moved to another device",
    } as CloseEvent);

    expect(events.disconnected).toHaveBeenCalledWith("replaced");
    voice.stop();
  });
});
