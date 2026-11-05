import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/desktop-auth", () => ({
  getDesktopToken: () => null,
  getStoredKovaAuthSessionToken: () => null,
}));
vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "",
}));
vi.mock("@/lib/platform", () => ({
  getApiBaseUrl: () => "https://meet.test",
  isTauri: () => false,
}));

import {
  fetchSocketProtocols,
  SocketTicketError,
} from "../socket-ticket-client";

describe("fetchSocketProtocols (the chat socket)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ticket: "global-ticket" })),
    );
  });

  it("asks /api/voice/socket-ticket for a global ticket", async () => {
    await expect(fetchSocketProtocols({ audience: "global" })).resolves.toEqual(
      ["ralph.realtime.v1", "ralph.ticket.global-ticket"],
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://meet.test/api/voice/socket-ticket",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ audience: "global" }),
      }),
    );
  });

  it("rejects with the status of a refused request", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      fetchSocketProtocols({ audience: "global" }),
    ).rejects.toBeInstanceOf(SocketTicketError);
  });
});
