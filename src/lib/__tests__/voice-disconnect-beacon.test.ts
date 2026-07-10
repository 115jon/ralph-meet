// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/desktop-auth", () => ({
  getDesktopToken: vi.fn(),
  getStoredKovaAuthSessionToken: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => path,
  isTauri: vi.fn(() => false),
}));

import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { sendVoiceDisconnectBeacon } from "@/lib/voice-disconnect-beacon";

describe("sendVoiceDisconnectBeacon", () => {
  const originalFetch = globalThis.fetch;
  const originalSendBeacon = navigator.sendBeacon;

  beforeEach(() => {
    vi.mocked(getDesktopToken).mockReturnValue(null);
    vi.mocked(getStoredKovaAuthSessionToken).mockReturnValue(null);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 202 })),
    ) as typeof fetch;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
    vi.clearAllMocks();
  });

  it("uses sendBeacon when cookie auth is enough", () => {
    const sent = sendVoiceDisconnectBeacon({
      channelId: "vc-1",
      serverId: "srv-1",
      gatewaySessionId: "gw-1",
      voiceSessionId: "voice-1",
    });

    expect(sent).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses keepalive fetch when an auth token must be attached", () => {
    vi.mocked(getStoredKovaAuthSessionToken).mockReturnValue("token-123");

    const sent = sendVoiceDisconnectBeacon({
      channelId: "vc-1",
      serverId: "srv-1",
      gatewaySessionId: "gw-1",
      voiceSessionId: "voice-1",
    });

    expect(sent).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/channels/vc-1/voice-disconnect",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "X-Gateway-Session-Id": "gw-1",
          "X-Voice-Session-Id": "voice-1",
        }),
      }),
    );
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("returns false when there is no session metadata to disconnect", () => {
    const sent = sendVoiceDisconnectBeacon({
      channelId: "vc-1",
      serverId: "srv-1",
    });

    expect(sent).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
});
