import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isConnected: vi.fn(() => true),
  resetRequests: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/lib/config", () => ({
  config: { apiBaseUrl: "https://meet.test" },
}));
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

import { apiJson } from "@/lib/api";
import {
  resetTicketRequests,
  SOCKET_TICKET_PATHS,
} from "../../../modules/ralph-network/src";
import { acquireRoomTicket, acquireVoiceTicket } from "../voice/tickets";
import { acquireGatewayTicket } from "./ticket";

const target = { serverId: "s", channelId: "c", roomSlug: "room" };

describe("resetTicketRequests", () => {
  beforeEach(() => {
    vi.mocked(apiJson).mockReset();
    native.resetRequests.mockReset();
  });

  it("asks the native client to cancel only the ticket requests", () => {
    resetTicketRequests("voice ticket timed out");
    expect(native.resetRequests).toHaveBeenCalledExactlyOnceWith(
      "voice ticket timed out",
      SOCKET_TICKET_PATHS,
    );
  });

  it("names every path a socket ticket is requested on", async () => {
    vi.mocked(apiJson).mockImplementation(async (path: string) =>
      path === "/api/voice/socket-ticket"
        ? { ticket: "t" }
        : { room_ticket: "r", voice_ticket: "v" },
    );
    await acquireGatewayTicket();
    await acquireRoomTicket(target).catch(() => {});
    await acquireVoiceTicket(target, "participant").catch(() => {});

    const paths = new Set(vi.mocked(apiJson).mock.calls.map(([path]) => path));
    expect([...paths].sort()).toEqual([...SOCKET_TICKET_PATHS].sort());
  });
});
