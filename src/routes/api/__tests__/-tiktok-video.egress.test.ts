// The reported bug, end to end with fakes: from Cloudflare's shared IP tikwm
// answers "Free Api Limit", so an age-gated TikTok came back with
// `restricted: true, videoUrl: null`. Through the egress proxy it plays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, { value: unknown; ttl: number }>(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async (key: string) => hoisted.store.get(key)?.value ?? null),
  cacheSet: vi.fn(async (key: string, value: unknown, ttl: number) => {
    hoisted.store.set(key, { value, ttl });
  }),
}));

import { resetUpstreamState } from "@/lib/upstream-guard";
import {
  CLASSIFIED_URL,
  TIKTOK_FIXTURES,
  htmlResponse,
  jsonResponse,
} from "@/lib/vendor-payloads/__tests__/fixtures/tiktok";
import {
  disableEgress,
  enableEgress,
  stubTikTokNetwork,
} from "@/lib/__tests__/egress-fakes";
import { GET } from "../tiktok-video";

const FREE_API_LIMIT = {
  code: -1,
  msg: "Free Api Limit: 10000 request/ 1 day.",
};

// Worker-side view of TikTok: the player API says nothing, the page says the
// post is age-gated, and tikwm refuses the shared IP.
const direct = {
  player: () => jsonResponse(TIKTOK_FIXTURES.playerNilCoreData),
  page: () => htmlResponse(TIKTOK_FIXTURES.pageContentClassified),
  tikwm: () => jsonResponse(FREE_API_LIMIT),
};

function request(videoUrl = CLASSIFIED_URL) {
  return GET({
    request: new Request(
      `https://meet.test/api/tiktok-video?videoUrl=${encodeURIComponent(videoUrl)}`,
    ),
  });
}

beforeEach(() => {
  hoisted.store.clear();
  resetUpstreamState();
});

afterEach(() => {
  disableEgress();
  vi.unstubAllGlobals();
});

describe("GET /api/tiktok-video for an age-gated post", () => {
  it("returns a playable videoUrl once tikwm is asked through the proxy", async () => {
    enableEgress();
    const net = stubTikTokNetwork({
      direct,
      egress: {
        tikwm: () => jsonResponse(TIKTOK_FIXTURES.tikwmContentClassified),
      },
    });

    const response = await request();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      videoUrl: expect.stringMatching(/^https:\/\/v16m\.tiktokcdn-us\.com\//),
      restricted: true,
      authorHandle: "ugnewwave",
      canonicalUrl: CLASSIFIED_URL,
    });
    expect(net.count("direct", "tikwm.com")).toBe(0);
    expect(net.count("egress", "tikwm.com/api/")).toBe(1);
  });

  it("is the bug without the proxy: tikwm's quota error leaves no video", async () => {
    disableEgress();
    stubTikTokNetwork({ direct });

    const response = await request();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.restricted).toBe(true);
    expect(body.videoUrl).toBeNull();
  });
});
