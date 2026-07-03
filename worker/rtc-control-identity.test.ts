import { describe, expect, it, vi } from "vitest";

import {
  consumeRtcRoomProfileRefreshCooldown,
  fetchRtcRoomVoiceCredentials,
  resolveRtcRoomControlIdentifySessionData,
} from "./rtc-control-identity";

describe("rtc-control-identity helpers", () => {
  it("enforces the profile refresh cooldown window", () => {
    const cooldowns = new Map<string, number>();

    expect(consumeRtcRoomProfileRefreshCooldown(cooldowns, "participant-1", 10_000)).toBe(true);
    expect(consumeRtcRoomProfileRefreshCooldown(cooldowns, "participant-1", 19_999)).toBe(false);
    expect(consumeRtcRoomProfileRefreshCooldown(cooldowns, "participant-1", 20_000)).toBe(true);
  });

  it("falls back to an empty voice token plus STUN-only credentials when secrets are absent", async () => {
    const credentials = await fetchRtcRoomVoiceCredentials(
      {
        CALLS_APP_SECRET: "",
        TURN_TOKEN_ID: "",
        TURN_TOKEN_SECRET: "",
        CLERK_SECRET_KEY: "",
        DB: {} as D1Database,
        CACHE: {} as KVNamespace,
      },
      "room-1",
      "participant-1",
      "user-1",
    );

    expect(credentials).toEqual({
      voiceToken: "",
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    });
  });

  it("resolves identify data from shared profile/status helpers without MeetingRoom ownership", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        username: "alice-clerk",
        first_name: "Alice",
        last_name: "Clerk",
        image_url: "https://cdn.example/avatar.png",
        unsafe_metadata: { displayName: "Alice Clerk" },
      }),
    })) as typeof fetch;

    const env = {
      CALLS_APP_SECRET: "",
      TURN_TOKEN_ID: "",
      TURN_TOKEN_SECRET: "",
      CLERK_SECRET_KEY: "clerk-secret",
      DB: {
        prepare: vi.fn((query: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              if (query.includes("SELECT status")) {
                return { status: "idle" };
              }
              return {
                username: "alice-db",
                display_name: "Alice DB",
                avatar_url: "/api/avatars/alice.png",
                avatar_display: "cover",
              };
            }),
          })),
        })),
      } as unknown as D1Database,
      CACHE: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      } as unknown as KVNamespace,
    };

    try {
      const identifyData = await resolveRtcRoomControlIdentifySessionData(
        env,
        "room-1",
        "participant-1",
        {
          name: "payload-name",
          username: "payload-username",
          clerk_user_id: "user-1",
        },
      );

      expect(identifyData).toEqual({
        participantId: "participant-1",
        name: "Alice DB",
        username: "alice-db",
        displayName: "Alice DB",
        avatarUrl: "/api/avatars/alice.png",
        avatarDisplay: "cover",
        status: "idle",
        voiceToken: "",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      });
      expect(env.CACHE.put).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
