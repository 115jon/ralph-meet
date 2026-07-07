import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";

const hoisted = vi.hoisted(() => ({
  cacheGetMock: vi.fn(),
  cacheSetMock: vi.fn(),
  fetchInstagramOEmbedMetadataMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: hoisted.cacheGetMock,
  cacheSet: hoisted.cacheSetMock,
}));

vi.mock("@/lib/share-preview-proxy", () => ({
  fetchInstagramOEmbedMetadata: hoisted.fetchInstagramOEmbedMetadataMock,
}));

import { resolveInstagramVideoMetadata } from "../instagram-video-resolver";

const workerEnv = env as unknown as Record<string, unknown>;

describe("resolveInstagramVideoMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete workerEnv.INSTAGRAM_SESSIONID;
    delete workerEnv.INSTAGRAM_CSRFTOKEN;
  });

  it("re-fetches slideshow metadata when the cache only contains a weak public fallback", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    hoisted.cacheGetMock.mockResolvedValue({
      videoUrl: null,
      thumbnailUrl: "https://scontent-ord5-2.cdninstagram.com/stale-slide-1.jpg?oe=6A53095B",
      title: "rukia!",
      durationSeconds: null,
      media: [
        {
          type: "image",
          url: "https://scontent-ord5-2.cdninstagram.com/stale-slide-1.jpg?oe=6A53095B",
          altText: "rukia!",
        },
      ],
      authorAvatarUrl: null,
      authorVerified: null,
      likeCount: 1073,
      commentCount: 15,
      viewCount: null,
      timestamp: "2026-06-23T05:00:00.000Z",
      audio: null,
    });
    hoisted.fetchInstagramOEmbedMetadataMock.mockResolvedValue(null);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://i.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/")) {
        return new Response("not found", {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url.startsWith("https://www.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/")) {
        return new Response("not found", {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url === "https://www.instagram.com/p/DZ9DK2RgNSk/") {
        return new Response(`
          <html>
            <head>
              <meta property="og:title" content="tas on Instagram: &quot;rukia!&quot;" />
              <meta property="og:image" content="https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B" />
              <script type="application/json">{"shared_entity_id":"3926308389746955428"}</script>
            </head>
          </html>
        `, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url.startsWith("https://i.instagram.com/api/v1/media/3926308389746955428/info/")) {
        return Response.json({
          items: [{
            caption: { text: "rukia!" },
            like_count: 1073,
            comment_count: 15,
            taken_at: 1782272402,
            user: {
              username: "tasyiu",
              profile_pic_url: "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
              is_verified: false,
            },
            carousel_media: [
              {
                image_versions2: {
                  candidates: [
                    { url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B", width: 2728, height: 1817 },
                  ],
                },
              },
              {
                image_versions2: {
                  candidates: [
                    { url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925", width: 2727, height: 1816 },
                  ],
                },
              },
            ],
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const result = await resolveInstagramVideoMetadata("https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==");

    expect(result?.title).toBe("rukia!");
    expect(result?.authorName).toBe("tasyiu");
    expect(result?.authorUrl).toBe("https://www.instagram.com/tasyiu");
    expect(result?.authorAvatarUrl).toBe("https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B");
    expect(result?.media).toEqual([
      {
        type: "image",
        url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
        width: 2728,
        height: 1817,
      },
      {
        type: "image",
        url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925",
        width: 2727,
        height: 1816,
      },
    ]);
    expect(hoisted.cacheSetMock).toHaveBeenCalledOnce();
  });

  it("re-fetches legacy cached Instagram metadata that has avatar data but no author identity", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    hoisted.cacheGetMock.mockResolvedValue({
      videoUrl: null,
      thumbnailUrl: "https://scontent-ord5-2.cdninstagram.com/stale-slide-1.jpg?oe=6A53095B",
      title: "rukia!",
      durationSeconds: null,
      media: [
        {
          type: "image",
          url: "https://scontent-ord5-2.cdninstagram.com/stale-slide-1.jpg?oe=6A53095B",
          width: 2728,
          height: 1817,
        },
      ],
      authorAvatarUrl: "https://scontent-ord5-1.cdninstagram.com/stale-avatar.jpg?oe=6A53095B",
      authorVerified: true,
      likeCount: 1073,
      commentCount: 15,
      viewCount: null,
      timestamp: "2026-06-24T03:40:02.000Z",
      audio: null,
    });
    hoisted.fetchInstagramOEmbedMetadataMock.mockResolvedValue(null);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://i.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/")) {
        return new Response("not found", {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url.startsWith("https://www.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/")) {
        return new Response("not found", {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url === "https://www.instagram.com/p/DZ9DK2RgNSk/") {
        return new Response(`
          <html>
            <head>
              <meta property="og:title" content="tas on Instagram: &quot;rukia!&quot;" />
              <meta property="og:image" content="https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B" />
              <script type="application/json">{"shared_entity_id":"3926308389746955428"}</script>
            </head>
          </html>
        `, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url.startsWith("https://i.instagram.com/api/v1/media/3926308389746955428/info/")) {
        return Response.json({
          items: [{
            caption: { text: "rukia!" },
            like_count: 1073,
            comment_count: 15,
            taken_at: 1782272402,
            user: {
              username: "tasyiu",
              profile_pic_url: "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
              is_verified: true,
            },
            carousel_media: [
              {
                image_versions2: {
                  candidates: [
                    { url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B", width: 2728, height: 1817 },
                  ],
                },
              },
            ],
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const result = await resolveInstagramVideoMetadata("https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==");

    expect(result?.authorName).toBe("tasyiu");
    expect(result?.authorUrl).toBe("https://www.instagram.com/tasyiu");
    expect(hoisted.cacheSetMock).toHaveBeenCalledOnce();
  });
});
