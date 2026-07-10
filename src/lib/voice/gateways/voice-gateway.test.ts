import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSocketProtocols: vi.fn(),
}));

vi.mock("@/lib/voice/socket-ticket-client", () => ({
  fetchSocketProtocols: mocks.fetchSocketProtocols,
}));

import { VoiceGateway } from "./voice-gateway";

class TestWebSocket {
  static instances: TestWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = this.CONNECTING;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    TestWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = this.CLOSED;
  }

  send(): void {}
}

describe("VoiceGateway", () => {
  beforeEach(() => {
    TestWebSocket.instances = [];
    mocks.fetchSocketProtocols.mockReset();
    vi.stubGlobal("WebSocket", TestWebSocket);
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
});
