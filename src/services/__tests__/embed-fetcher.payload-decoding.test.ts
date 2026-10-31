import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  resolveInstagramVideoMetadataMock: vi.fn(),
}));

vi.mock("@/lib/instagram-video-resolver", () => ({
  resolveInstagramVideoMetadata: hoisted.resolveInstagramVideoMetadataMock,
}));

import { extractAndProcessEmbedsWithStatus } from "../embed-fetcher";

// Vendor payloads drift. A decoded payload with a wrong root takes the same
// path as a missing one: no embed ("none"), never a retry and never a throw.
// Individual retyped fields are dropped instead of leaking into the embed.

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      for (const [prefix, respond] of Object.entries(routes)) {
        if (url.startsWith(prefix)) return respond();
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch,
  );
}

const json = (value: unknown) => () => Response.json(value);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.resolveInstagramVideoMetadataMock.mockReset();
});

describe("Spotify oEmbed", () => {
  const url = "https://open.spotify.com/track/payload-root-null";

  it("maps a real-shaped payload", async () => {
    stubFetch({
      "https://open.spotify.com/oembed": json({
        title: "A Song",
        author_name: "An Artist",
        thumbnail_url: "https://i.scdn.co/image/abc",
        thumbnail_width: 300,
        thumbnail_height: 300,
        provider_name: "Spotify",
        version: "1.0",
      }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://open.spotify.com/track/real-shape",
    );

    expect(result.embeds[0]).toMatchObject({
      rawTitle: "A Song",
      rawDescription: "Spotify - An Artist",
      thumbnail: { url: "https://i.scdn.co/image/abc", width: 300 },
    });
  });

  it("survives missing fields", async () => {
    stubFetch({ "https://open.spotify.com/oembed": json({ title: "Only" }) });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://open.spotify.com/track/missing-fields",
    );

    expect(result.embeds[0]).toMatchObject({
      rawTitle: "Only",
      rawDescription: "Spotify",
    });
    expect(result.embeds[0].thumbnail).toBeUndefined();
  });

  it("drops retyped fields instead of passing them through", async () => {
    stubFetch({
      "https://open.spotify.com/oembed": json({
        title: 12,
        author_name: ["x"],
        thumbnail_url: "https://i.scdn.co/image/abc",
        thumbnail_width: "wide",
      }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://open.spotify.com/track/retyped",
    );

    expect(result.embeds[0].rawTitle).toBeUndefined();
    expect(result.embeds[0].rawDescription).toBe("Spotify");
    expect(result.embeds[0].thumbnail).toMatchObject({ width: 300 });
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"nope"'],
  ])(
    "is a permanent none, not a retry, when the body is %s",
    async (_l, body) => {
      stubFetch({
        "https://open.spotify.com/oembed": () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
      });

      const result = await extractAndProcessEmbedsWithStatus(url + body.length);

      expect(result.hadFailures).toBe(false);
      expect(result.embeds).toEqual([]);
      expect(result.outcomes[0].status).toBe("none");
    },
  );
});

describe("YouTube oEmbed", () => {
  const dimensions = {
    "https://www.youtube.com/youtubei/v1/player": json({
      streamingData: { adaptiveFormats: [{ width: 1920, height: 1080 }] },
    }),
  };

  it("builds the embed from a real-shaped payload", async () => {
    stubFetch({
      ...dimensions,
      "https://www.youtube.com/oembed": json({
        title: "A video",
        author_name: "A channel",
        author_url: "https://www.youtube.com/@channel",
        thumbnail_url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
        thumbnail_width: 480,
        thumbnail_height: 360,
      }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://youtu.be/aaaaaaaaaaa",
    );

    expect(result.embeds[0]).toMatchObject({
      rawTitle: "A video",
      author: { name: "A channel", url: "https://www.youtube.com/@channel" },
      thumbnail: { width: 480, height: 360 },
      video: { width: 1920, height: 1080 },
    });
  });

  it("leaves out the author and thumbnail when the payload has none", async () => {
    stubFetch({
      ...dimensions,
      "https://www.youtube.com/oembed": json({ title: "Bare" }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://youtu.be/bbbbbbbbbbb",
    );

    expect(result.embeds[0].rawTitle).toBe("Bare");
    expect(result.embeds[0].author).toBeUndefined();
    expect(result.embeds[0].thumbnail).toBeUndefined();
  });

  it("is a permanent none when the body is not an object", async () => {
    stubFetch({
      ...dimensions,
      "https://www.youtube.com/oembed": json([1, 2]),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://youtu.be/ccccccccccc",
    );

    expect(result.hadFailures).toBe(false);
    expect(result.outcomes[0].status).toBe("none");
  });

  it("reads format dimensions from numeric strings and ignores junk formats", async () => {
    stubFetch({
      "https://www.youtube.com/youtubei/v1/player": json({
        streamingData: {
          formats: [null, { width: "640", height: "360" }, { width: "x" }],
          adaptiveFormats: "none",
        },
      }),
      "https://www.youtube.com/oembed": json({ title: "Strings" }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://youtu.be/ddddddddddd",
    );

    expect(result.embeds[0].video).toMatchObject({ width: 640, height: 360 });
  });
});

describe("TikTok oEmbed", () => {
  it("uses the proxy metadata when the oEmbed body is not an object", async () => {
    stubFetch({
      "https://www.tiktok.com/oembed": () =>
        new Response("null", {
          headers: { "content-type": "application/json" },
        }),
      "https://www.tikwm.com/api/": json({
        code: 0,
        data: {
          id: "7617216826585468111",
          title: "from the proxy",
          cover: "https://p16-common-sign.tiktokcdn-us.com/c.jpeg",
          play: "https://v16m.tiktokcdn-us.com/x/v/?mime_type=video_mp4",
          author: { unique_id: "someone", nickname: "Some One" },
        },
      }),
    });

    const result = await extractAndProcessEmbedsWithStatus(
      "https://www.tiktok.com/@someone/video/7617216826585468111",
    );

    expect(result.hadFailures).toBe(false);
    expect(result.embeds[0]).toMatchObject({
      rawTitle: "from the proxy",
      author: { name: "Some One" },
    });
  });
});
