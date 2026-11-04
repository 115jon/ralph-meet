import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTurnCredentialCacheForTests,
  generateTurnCredentials,
  getCachedTurnCredentials,
  TURN_CREDENTIAL_CACHE_MS,
} from "../meeting-room/turn-credentials";

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

describe("cached TURN credentials", () => {
  const turnResponse = (username: string) =>
    Response.json({
      iceServers: [
        {
          urls: ["turn:one.example:3478?transport=udp"],
          username,
          credential: "credential",
        },
      ],
    });
  const input = (fetch: typeof globalThis.fetch) => ({
    tokenId: "turn-key",
    tokenSecret: "turn-secret",
    fetch,
    log,
  });

  beforeEach(() => clearTurnCredentialCacheForTests());

  it("shares one request between concurrent and later joins", async () => {
    const fetch = vi.fn(async () => turnResponse("user-1"));
    const [first, second] = await Promise.all([
      getCachedTurnCredentials(input(fetch), 1_000),
      getCachedTurnCredentials(input(fetch), 1_000),
    ]);
    const later = await getCachedTurnCredentials(input(fetch), 2_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first[0]?.username).toBe("user-1");
    expect(second).toEqual(first);
    expect(later).toEqual(first);
  });

  it("generates new credentials once the cached set is too old", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => turnResponse("user-1"))
      .mockImplementationOnce(async () => turnResponse("user-2"));
    await getCachedTurnCredentials(input(fetch), 0);
    const next = await getCachedTurnCredentials(
      input(fetch),
      TURN_CREDENTIAL_CACHE_MS,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(next[0]?.username).toBe("user-2");
  });

  it("does not keep the STUN fallback after a failure", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => new Response("no", { status: 503 }))
      .mockImplementationOnce(async () => turnResponse("user-1"));
    await expect(getCachedTurnCredentials(input(fetch), 0)).resolves.toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
    ]);
    const retried = await getCachedTurnCredentials(input(fetch), 1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retried[0]?.username).toBe("user-1");
  });
});
