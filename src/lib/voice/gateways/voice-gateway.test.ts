import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceOpcode } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
}));

import { VoiceGateway } from "./voice-gateway";

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
}

describe("VoiceGateway", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  it("backs off and retries when the ticket request fails with 503 (auth unavailable)", async () => {
    const { SocketTicketError } = await vi.importActual<
      typeof import("@/lib/voice/socket-ticket-client")
    >("@/lib/voice/socket-ticket-client");
    mocks.fetchSocketProtocols
      .mockRejectedValueOnce(new SocketTicketError(503))
      .mockResolvedValue(["ralph.realtime.v1", "ralph.ticket.test"]);
    const gateway = new VoiceGateway();
    const errors: unknown[] = [];
    gateway.on("error", (error) => errors.push(error));

    gateway.prepareVoice(
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );

    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1), {
      timeout: 2_000,
    });
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([{ message: "Could not open voice socket" }]);
    gateway.disconnect();
  });

  it("prepares without credentials and identifies once when credentials arrive after Hello", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();

    gateway.prepareVoice(
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    expect(socket.sent).toHaveLength(0);

    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    expect(mocks.fetchSocketProtocols).toHaveBeenCalledOnce();
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-1",
          voice_token: "voice-token-1",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    gateway.disconnect();
  });

  it.each([
    ["participant only", "participant-1", ""],
    ["token only", "", "voice-token-1"],
  ])(
    "does not identify with %s credentials",
    async (_label, participantId, voiceToken) => {
      mocks.fetchSocketProtocols.mockResolvedValue([
        "ralph.realtime.v1",
        "ralph.ticket.test",
      ]);
      const gateway = new VoiceGateway();

      gateway.connectVoice(
        participantId,
        voiceToken,
        "voice-server-channel",
        (path) => `ws://meet.test${path}`,
        { channelId: "channel", serverId: "server" },
      );
      await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));

      const socket = TestWebSocket.instances[0]!;
      socket.readyState = TestWebSocket.OPEN;
      socket.onmessage?.({
        data: JSON.stringify({
          op: VoiceOpcode.Hello,
          d: { heartbeat_interval: 45_000 },
        }),
      } as MessageEvent);

      expect(socket.sent).toHaveLength(0);
      gateway.disconnect();
    },
  );

  it("replaces an identified socket before a fresh participant generation can identify", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();

    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const first = TestWebSocket.instances[0]!;
    first.readyState = TestWebSocket.OPEN;
    first.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    gateway.connectVoice(
      "participant-2",
      "voice-token-2",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(2));

    const second = TestWebSocket.instances[1]!;
    second.readyState = TestWebSocket.OPEN;
    second.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    expect(first.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-1",
          voice_token: "voice-token-1",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    expect(second.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-2",
          voice_token: "voice-token-2",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    expect(first.readyState).toBe(TestWebSocket.CLOSED);
    gateway.disconnect();
  });

  it("keeps an identified socket when only the voice token is refreshed", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const connect = (token: string) =>
      gateway.connectVoice(
        "participant-1",
        token,
        "voice-server-channel",
        (path) => `ws://meet.test${path}`,
        { channelId: "channel", serverId: "server" },
      );

    connect("bootstrap-token");
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    // The room's Ready hands over a different token for the same participant.
    connect("ready-token");
    await Promise.resolve();
    await Promise.resolve();

    expect(TestWebSocket.instances).toHaveLength(1);
    expect(socket.readyState).toBe(TestWebSocket.OPEN);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-1",
          voice_token: "bootstrap-token",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    gateway.disconnect();
  });

  it("ignores a stale close callback after creating a replacement socket", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const wsUrlGenerator = (path: string) => `ws://meet.test${path}`;
    const ticketContext = { channelId: "channel", serverId: "server" };

    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const first = TestWebSocket.instances[0]!;
    first.readyState = TestWebSocket.OPEN;
    first.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);
    const staleClose = first.onclose;
    first.readyState = TestWebSocket.CLOSED;

    gateway.connectVoice(
      "participant-2",
      "voice-token-2",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(2));
    const second = TestWebSocket.instances[1]!;
    second.readyState = TestWebSocket.OPEN;

    staleClose?.({ code: 1006, reason: "stale close" } as CloseEvent);
    second.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    expect(second.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-2",
          voice_token: "voice-token-2",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    gateway.disconnect();
  });

  it("does not identify stale credentials on a fresh prepared socket after disconnect", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const wsUrlGenerator = (path: string) => `ws://meet.test${path}`;
    const ticketContext = { channelId: "channel", serverId: "server" };

    gateway.connectVoice(
      "old-participant",
      "old-token",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const oldSocket = TestWebSocket.instances[0]!;
    oldSocket.readyState = TestWebSocket.OPEN;
    oldSocket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);
    expect(oldSocket.sent.map((message) => JSON.parse(message))).toContainEqual(
      expect.objectContaining({
        op: VoiceOpcode.VoiceIdentify,
        d: expect.objectContaining({
          participant_id: "old-participant",
          voice_token: "old-token",
        }),
      }),
    );

    gateway.disconnect();
    gateway.prepareVoice("voice-server-channel", wsUrlGenerator, ticketContext);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(2));

    const preparedSocket = TestWebSocket.instances[1]!;
    preparedSocket.readyState = TestWebSocket.OPEN;
    preparedSocket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);
    expect(preparedSocket.sent).toHaveLength(0);

    gateway.connectVoice(
      "new-participant",
      "new-token",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );

    expect(preparedSocket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "new-participant",
          voice_token: "new-token",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    gateway.disconnect();
  });

  it("invalidates an in-flight preparation before re-preparing after disconnect", async () => {
    let resolveFirstTicket: ((protocols: string[]) => void) | undefined;
    const firstTicket = new Promise<string[]>((resolve) => {
      resolveFirstTicket = resolve;
    });
    mocks.fetchSocketProtocols
      .mockReturnValueOnce(firstTicket)
      .mockResolvedValue(["ralph.realtime.v1", "ralph.ticket.test"]);
    const gateway = new VoiceGateway();
    const wsUrlGenerator = (path: string) => `ws://meet.test${path}`;
    const ticketContext = { channelId: "channel", serverId: "server" };

    gateway.connectVoice(
      "old-participant",
      "old-token",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );
    gateway.connectVoice(
      "old-participant",
      "old-token",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );
    gateway.disconnect();
    gateway.prepareVoice("voice-server-channel", wsUrlGenerator, ticketContext);
    resolveFirstTicket?.(["ralph.realtime.v1", "ralph.ticket.test"]);

    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const preparedSocket = TestWebSocket.instances[0]!;
    preparedSocket.readyState = TestWebSocket.OPEN;
    preparedSocket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);
    expect(preparedSocket.sent).toHaveLength(0);

    gateway.connectVoice(
      "new-participant",
      "new-token",
      "voice-server-channel",
      wsUrlGenerator,
      ticketContext,
    );

    expect(preparedSocket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "new-participant",
          voice_token: "new-token",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);
    gateway.disconnect();
  });

  it("opens a new socket after a prior disconnect while ticket acquisition is asynchronous", async () => {
    let resolveTicket: ((protocols: string[]) => void) | undefined;
    mocks.fetchSocketProtocols.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveTicket = resolve;
      }),
    );
    const gateway = new VoiceGateway();

    gateway.disconnect();
    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    resolveTicket?.(["ralph.realtime.v1", "ralph.ticket.test"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(TestWebSocket.instances).toHaveLength(1);
    expect(TestWebSocket.instances[0]).toMatchObject({
      url: "ws://meet.test/api/channels/voice-server-channel/voice?v=1",
    });
  });

  it("advertises Listen Together snapshot event support in Voice Identify", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Hello,
        d: { heartbeat_interval: 45_000 },
      }),
    } as MessageEvent);

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceIdentify,
        d: {
          participant_id: "participant-1",
          voice_token: "voice-token",
          supports_listen_together_snapshot_events: true,
        },
      },
    ]);

    gateway.disconnect();
  });

  it("forwards PartyTracks descriptors on VoiceReady without legacy transfer state", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const onReady = vi.fn();
    gateway.on("voice-ready", onReady);

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    const track = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-partytracks-audio",
      session_id: "partytracks-capability",
      kind: "audio",
    };
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.VoiceReady,
        d: {
          participant_id: "participant-1",
          tracks: [track],
          speaking: { "remote-participant": 1 },
        },
      }),
    } as MessageEvent);

    expect(onReady).toHaveBeenCalledWith({
      tracks: [track],
      speaking: { "remote-participant": 1 },
    });
    expect(onReady.mock.calls[0]?.[0]).not.toHaveProperty(
      "sfu_session_transferred",
    );
    gateway.disconnect();
  });

  it("preserves PartyTracks metadata on offered and stopped tracks", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const onOffered = vi.fn();
    const onStopped = vi.fn();
    gateway.on("track-offered", onOffered);
    gateway.on("stop-tracks", onStopped);

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const track = {
      participant_id: "participant-remote",
      track_name: "cam-audio-participant-remote",
      sfu_track_name: "opaque-audio",
      session_id: "signed-session-capability",
      kind: "audio",
    };
    const socket = TestWebSocket.instances[0]!;
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.Video,
        d: { participant_id: "participant-remote", tracks: [track] },
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.StopTracks,
        d: { track_names: [track.track_name], tracks: [track] },
      }),
    } as MessageEvent);

    expect(onOffered).toHaveBeenCalledWith(track);
    expect(onStopped).toHaveBeenCalledWith({
      track_names: [track.track_name],
      tracks: [track],
    });
    gateway.disconnect();
  });

  it("emits remote client disconnects so speaking state can be cleared", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    const onDisconnect = vi.fn();
    gateway.on("client-disconnect", onDisconnect);

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.onmessage?.({
      data: JSON.stringify({
        op: VoiceOpcode.ClientDisconnect,
        d: { participant_id: "participant-remote" },
      }),
    } as MessageEvent);

    expect(onDisconnect).toHaveBeenCalledWith({
      participant_id: "participant-remote",
    });
    gateway.disconnect();
  });

  it("flushes app events queued while the initial ticket is loading", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    gateway.sendAppEvent({ type: "listen_together.state.request" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({ op: VoiceOpcode.VoiceReady, d: {} }),
    } as MessageEvent);

    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
      op: VoiceOpcode.VoiceAppEvent,
      d: { type: "listen_together.state.request" },
    });
  });

  it("does not replay stale listen-together controls after reconnect", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();

    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    gateway.sendAppEvent({
      type: "listen_together.pause",
      room_slug: "room-1",
      paused: false,
    });
    gateway.sendAppEvent({
      type: "listen_together.skip",
      room_slug: "room-1",
    });
    gateway.sendAppEvent({
      type: "listen_together.play",
      room_slug: "room-1",
      entryId: "entry-1",
    });
    gateway.sendAppEvent({
      type: "listen_together.state.request",
      room_slug: "room-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({ op: VoiceOpcode.VoiceReady, d: {} }),
    } as MessageEvent);

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      {
        op: VoiceOpcode.VoiceAppEvent,
        d: { type: "listen_together.state.request", room_slug: "room-1" },
      },
    ]);
  });

  it("returns false when a listen-together command is dropped before sending", () => {
    const gateway = new VoiceGateway();

    expect(
      gateway.sendAppEvent({
        type: "listen_together.pause",
        room_slug: "room-1",
        paused: true,
        entryId: "entry-1",
      }),
    ).toBe(false);
  });

  it("returns true when a listen-together command is accepted by the ready socket", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    const gateway = new VoiceGateway();
    gateway.connectVoice(
      "participant-1",
      "voice-token",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({ op: VoiceOpcode.VoiceReady, d: {} }),
    } as MessageEvent);

    expect(
      gateway.sendAppEvent({
        type: "listen_together.pause",
        room_slug: "room-1",
        paused: true,
        entryId: "entry-1",
      }),
    ).toBe(true);
  });
});

describe("VoiceGateway frame decoding", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    mocks.fetchSocketProtocols.mockResolvedValue([
      "ralph.realtime.v1",
      "ralph.ticket.test",
    ]);
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  it("drops malformed frames without throwing and keeps working", async () => {
    const gateway = new VoiceGateway();
    const voiceReady = vi.fn();
    const speaking = vi.fn();
    const offered = vi.fn();
    gateway.on("voice-ready", voiceReady);
    gateway.on("speaking", speaking);
    gateway.on("track-offered", offered);
    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    const raw = (data: unknown) => socket.onmessage?.({ data } as MessageEvent);
    const frame = (op: number, d?: unknown) =>
      raw(JSON.stringify(d === undefined ? { op } : { op, d }));

    expect(() => {
      raw("{");
      raw('"text"');
      raw('{"d":{}}');
      frame(VoiceOpcode.Hello, { heartbeat_interval: null });
      frame(VoiceOpcode.VoiceReady, { tracks: "none" });
      frame(VoiceOpcode.VoiceReady, { speaking: { p: "loud" } });
      frame(VoiceOpcode.Speaking, { participant_id: "p" });
      frame(VoiceOpcode.Video, { participant_id: "p", tracks: [1] });
      frame(VoiceOpcode.StopTracks, { track_names: "screen" });
      frame(VoiceOpcode.VoiceAppEvent, ["not", "an", "object"]);
      frame(4242, { unknown: true });
    }).not.toThrow();
    expect(socket.sent).toEqual([]);
    expect(voiceReady).not.toHaveBeenCalled();
    expect(speaking).not.toHaveBeenCalled();
    expect(offered).not.toHaveBeenCalled();

    frame(VoiceOpcode.Hello, { heartbeat_interval: 45_000 });
    frame(VoiceOpcode.VoiceReady, { participant_id: "participant-1" });
    frame(VoiceOpcode.Speaking, { participant_id: "p", speaking: 1 });
    expect(socket.sent.map((message) => JSON.parse(message).op)).toEqual([
      VoiceOpcode.VoiceIdentify,
    ]);
    expect(voiceReady).toHaveBeenCalledOnce();
    expect(speaking).toHaveBeenCalledWith({ participantId: "p", speaking: 1 });
    gateway.disconnect();
  });
});

describe("VoiceGateway lifecycle", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  const connect = (gateway: VoiceGateway) =>
    gateway.connectVoice(
      "participant-1",
      "voice-token-1",
      "voice-server-channel",
      (path) => `ws://meet.test${path}`,
      { channelId: "channel", serverId: "server" },
    );

  it("stops retrying after two 401 ticket refusals and tries once more on wake", async () => {
    const { SocketTicketError } = await vi.importActual<
      typeof import("@/lib/voice/socket-ticket-client")
    >("@/lib/voice/socket-ticket-client");
    mocks.fetchSocketProtocols.mockRejectedValue(new SocketTicketError(401));
    const gateway = new VoiceGateway();
    const authFailed = vi.fn();
    gateway.on("auth-failed", authFailed);

    connect(gateway);
    await vi.waitFor(() => expect(authFailed).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);

    mocks.fetchSocketProtocols.mockResolvedValue(["ralph.realtime.v1"]);
    gateway.wake();
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(3);
    gateway.disconnect();
  });

  it("is kicked without reconnecting when the room replaces the socket", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue(["ralph.realtime.v1"]);
    const gateway = new VoiceGateway();
    const kicked = vi.fn();
    const disconnected = vi.fn();
    gateway.on("kicked", kicked);
    gateway.on("disconnected", disconnected);

    connect(gateway);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const socket = TestWebSocket.instances[0]!;
    socket.readyState = TestWebSocket.OPEN;
    socket.onclose?.({
      code: 1000,
      reason: "Replaced by new connection",
    } as CloseEvent);

    expect(kicked).toHaveBeenCalledOnce();
    expect(disconnected).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocks.fetchSocketProtocols).toHaveBeenCalledOnce();
  });

  it("wakes a pending retry at once instead of waiting out the backoff", async () => {
    mocks.fetchSocketProtocols.mockResolvedValue(["ralph.realtime.v1"]);
    vi.useFakeTimers();
    try {
      const gateway = new VoiceGateway();
      connect(gateway);
      await vi.advanceTimersByTimeAsync(0);
      const first = TestWebSocket.instances[0]!;
      first.readyState = TestWebSocket.OPEN;
      first.onclose?.({ code: 1006, reason: "" } as CloseEvent);
      expect(mocks.fetchSocketProtocols).toHaveBeenCalledOnce();

      gateway.wake();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.fetchSocketProtocols).toHaveBeenCalledTimes(2);
      expect(TestWebSocket.instances).toHaveLength(2);
      gateway.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});
