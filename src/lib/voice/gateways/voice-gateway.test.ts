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
