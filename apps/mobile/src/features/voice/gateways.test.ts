import { GatewayOp } from "@ralph/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tickets", () => ({
  acquireRoomTicket: vi.fn(),
  acquireVoiceTicket: vi.fn(async () => ({ url: "wss://meet.test/voice" })),
  beginCallAdmission: vi.fn(),
}));

vi.mock("../../../modules/ralph-network/src", () => ({
  resetTicketRequests: vi.fn(),
}));

import { resetTicketRequests } from "../../../modules/ralph-network/src";
import { CONNECT_TIMEOUTS } from "@ralph/realtime";
import { VoiceSocket, type VoiceSocketHandlers } from "./gateways";
import { acquireVoiceTicket } from "./tickets";

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

  it("holds its identify after a network change until the room says who we are", async () => {
    vi.mocked(acquireVoiceTicket).mockImplementation(async () => ({
      url: "wss://meet.test/voice",
      protocols: [],
    }));
    const identifies = (socket: TestWebSocket) =>
      socket.sent
        .map((frame) => JSON.parse(frame) as { op: number; d?: unknown })
        .filter((frame) => frame.op === GatewayOp.VoiceIdentify)
        .map((frame) => (frame.d as { participant_id: string }).participant_id);
    const open = async (count: number) => {
      await vi.waitFor(() =>
        expect(TestWebSocket.instances).toHaveLength(count),
      );
      const socket = TestWebSocket.instances[count - 1]!;
      socket.readyState = TestWebSocket.OPEN;
      socket.onopen?.({} as Event);
      socket.receive({
        op: GatewayOp.Hello,
        d: { heartbeat_interval: 15_000 },
      });
      return socket;
    };

    const voice = new VoiceSocket(target, handlers());
    voice.connectVoice("participant-1", "token");
    expect(identifies(await open(1))).toEqual(["participant-1"]);

    // The network came back: the socket is dropped and opens again, but
    // waits for the room.
    voice.holdIdentify();
    voice.wake({ networkChanged: true });
    const second = await open(2);
    expect(identifies(second)).toEqual([]);

    // The room resumed: same participant, identify now.
    voice.releaseIdentify();
    expect(identifies(second)).toEqual(["participant-1"]);

    // Next time the room comes back as someone new: identify as them.
    voice.holdIdentify();
    voice.wake({ networkChanged: true });
    const third = await open(3);
    expect(identifies(third)).toEqual([]);
    voice.connectVoice("participant-2", "token-2");
    expect(identifies(third)).toEqual(["participant-2"]);
    voice.stop();
  });

  it("resets the HTTP pool and asks again when a ticket request never answers", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      vi.mocked(acquireVoiceTicket).mockImplementation(
        (_target, _participant, signal) => {
          if (signal) signals.push(signal);
          return new Promise(() => {});
        },
      );
      const voice = new VoiceSocket(target, handlers());
      voice.connectVoice("participant-1", "token");
      expect(signals).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUTS.ticketMs);
      expect(signals[0]!.aborted).toBe(true);
      expect(resetTicketRequests).toHaveBeenCalledWith(
        "voice ticket timed out",
      );

      // Call sockets back off 500 ms × (0.5–1) before the next attempt.
      await vi.advanceTimersByTimeAsync(500);
      expect(signals).toHaveLength(2);
      expect(TestWebSocket.instances).toHaveLength(0);
      voice.stop();
      expect(signals[1]!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
