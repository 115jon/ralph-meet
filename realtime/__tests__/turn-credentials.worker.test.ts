import { describe, expect, it, vi } from "vitest";
import { generateTurnCredentials } from "../meeting-room/turn-credentials";

const log = { info: vi.fn(), warn: vi.fn() };

describe("TURN credential adapter", () => {
  it("returns Cloudflare STUN when credentials are not configured", async () => {
    const fetch = vi.fn();

    await expect(
      generateTurnCredentials({
        tokenId: "",
        tokenSecret: "",
        fetch,
        log,
      }),
    ).resolves.toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests TURN credentials and filters the response to two reliable servers", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        iceServers: [
          {
            urls: [
              "turn:one.example:3478?transport=udp",
              "turn:one.example:443?transport=tcp",
              "turn:one.example:80?transport=tcp",
            ],
            username: "user-1",
            credential: "credential-1",
          },
          {
            urls: ["stun:two.example:3478"],
            username: "user-2",
            credential: "credential-2",
          },
          { urls: ["turn:three.example:3478?transport=udp"] },
        ],
      }),
    );

    await expect(
      generateTurnCredentials({
        tokenId: "turn-key",
        tokenSecret: "turn-secret",
        fetch,
        log,
      }),
    ).resolves.toEqual([
      {
        urls: [
          "turn:one.example:3478?transport=udp",
          "turn:one.example:443?transport=tcp",
        ],
        username: "user-1",
        credential: "credential-1",
      },
      {
        urls: ["stun:two.example:3478"],
        username: "user-2",
        credential: "credential-2",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/turn-key/credentials/generate-ice-servers",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer turn-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 48 * 60 * 60 }),
      },
    );
  });

  it.each([
    ["HTTP failure", async () => new Response("failed", { status: 503 })],
    ["empty response", async () => Response.json({ iceServers: [] })],
    ["malformed response", async () => Response.json({ iceServers: "nope" })],
    [
      "network failure",
      async () => {
        throw new Error("offline");
      },
    ],
  ])("falls back to STUN on %s", async (_name, implementation) => {
    await expect(
      generateTurnCredentials({
        tokenId: "turn-key",
        tokenSecret: "turn-secret",
        fetch: vi.fn(implementation),
        log,
      }),
    ).resolves.toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  });
});
