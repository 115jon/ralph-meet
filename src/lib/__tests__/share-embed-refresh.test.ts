import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  hydrateInstagramEmbedsForShare,
  hydrateSocialEmbeds,
} from "../share-embed-refresh";
import type { MessageShare } from "@/services/message-share.service";

const workerEnv = env as unknown as Record<string, unknown>;

function makeShare(): MessageShare {
  return {
    id: "share-1",
    token: "tok_123",
    source_message_id: "msg-1",
    source_channel_id: "chan-1",
    source_server_id: "srv-1",
    created_by: "user-1",
    created_at: "2026-05-24T12:00:00.000Z",
    expires_at: null,
    status: "active",
    view_count: 0,
    allow_indexing: false,
    original_edited: false,
    snapshot: {
      content:
        "https://www.instagram.com/reel/DXU4PV2AGJU/?igsh=b3hjc3NnZGg2NjZv",
      author: {
        id: "author-1",
        username: "jm50106001",
        display_name: null,
        avatar_url: null,
      },
      attachments: [],
      omitted_attachment_count: 0,
      embeds: [
        {
          id: "embed-ig-1",
          url: "https://www.instagram.com/reel/DXU4PV2AGJU/?igsh=b3hjc3NnZGg2NjZv",
          type: "rich",
          rawTitle: "craziest work",
          provider: { name: "Instagram", url: "https://www.instagram.com" },
          thumbnail: {
            url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
            width: 640,
            height: 1137,
          },
          fields: [],
        },
      ],
      reactions: [],
      reply_count: 0,
      created_at: "2026-05-24T12:00:00.000Z",
      updated_at: null,
    },
  };
}

describe("hydrateInstagramEmbedsForShare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete workerEnv.INSTAGRAM_SESSIONID;
    delete workerEnv.INSTAGRAM_CSRFTOKEN;
  });

  it("fills missing Instagram reel video metadata for stale share snapshots", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return Response.json({
            media_id: "3878972523924185684_71645946242",
            thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
            title: "craziest work",
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/3878972523924185684/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                video_versions: [
                  {
                    url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
                    width: 720,
                    height: 1280,
                  },
                ],
                image_versions2: {
                  candidates: [
                    {
                      url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
                    },
                  ],
                },
                caption: { text: "craziest work" },
                video_duration: 128.4,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const hydrated = await hydrateInstagramEmbedsForShare(makeShare());

    expect(hydrated.snapshot.embeds[0].video).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
      width: 720,
      height: 1280,
      kind: "direct",
      contentType: "video/mp4",
      durationSeconds: 128.4,
    });
    expect(hydrated.snapshot.embeds[0].thumbnail).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
      width: 640,
      height: 1137,
    });
  });

  it("uses resolver thumbnail data when the stale share is missing one", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return Response.json({
            media_id: "3878972523924185684_71645946242",
            title: "craziest work",
            thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/3878972523924185684/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                video_versions: [
                  {
                    url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
                    width: 720,
                    height: 1280,
                  },
                ],
                image_versions2: {
                  candidates: [
                    {
                      url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
                    },
                  ],
                },
                caption: { text: "craziest work" },
                video_duration: 128.4,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const share = makeShare();
    share.snapshot.embeds[0] = {
      ...share.snapshot.embeds[0],
      thumbnail: undefined,
    };

    const hydrated = await hydrateInstagramEmbedsForShare(share);

    expect(hydrated.snapshot.embeds[0].thumbnail).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
    });
  });

  it("hydrates stale TikTok player embeds into direct shareable media", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (
          url ===
          "https://www.tiktok.com/player/api/v1/items?item_ids=7644364274630020383"
        ) {
          return new Response("not found", { status: 404 });
        }
        if (!url.startsWith("https://www.tikwm.com/api/?url=")) {
          throw new Error(`Unexpected fetch: ${url}`);
        }

        return Response.json({
          code: 0,
          data: {
            id: "7644364274630020383",
            title: "Not even gonna let him finish this one",
            hdplay:
              "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
            cover:
              "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
            author: {
              nickname: "1Cloud9",
              unique_id: "kingoftheskys1",
              avatar:
                "https://p16-common-sign.tiktokcdn-us.com/example/avatar.jpeg",
            },
            digg_count: 17039,
            comment_count: 363,
            play_count: 183647,
            create_time: 1748306272,
            duration: 21,
          },
        });
      }) as unknown as typeof fetch,
    );

    const share = {
      ...makeShare(),
      snapshot: {
        ...makeShare().snapshot,
        content:
          "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383",
        embeds: [
          {
            id: "embed-tt-1",
            url: "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383?is_from_webapp=1&sender_device=pc",
            type: "video" as const,
            provider: { name: "TikTok", url: "https://www.tiktok.com" },
            author: {
              name: "1Cloud9",
              url: "https://www.tiktok.com/@kingoftheskys1",
            },
            video: {
              url: "https://www.tiktok.com/player/v1/7644364274630020383",
              width: 325,
              height: 738,
              kind: "player" as const,
            },
            fields: [],
          },
        ],
      },
    } satisfies MessageShare;

    const hydrated = await hydrateInstagramEmbedsForShare(share);
    const embed = hydrated.snapshot.embeds[0];

    expect(embed.url).toBe(
      "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383?is_from_webapp=1&sender_device=pc",
    );
    expect(embed.video).toEqual({
      url: "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
      width: 720,
      height: 1280,
      kind: "direct",
      contentType: "video/mp4",
      durationSeconds: 21,
    });
    expect(embed.media).toEqual([
      {
        type: "video",
        url: "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
        thumbnailUrl:
          "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
        contentType: "video/mp4",
        durationSeconds: 21,
      },
    ]);
    expect(embed.thumbnail).toEqual({
      url: "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
      width: 720,
      height: 1280,
    });
    expect(embed.metrics).toEqual({
      comments: 363,
      likes: 17039,
      views: 183647,
    });
  });

  it("falls back to the Instagram shortcode endpoint when oEmbed omits media_id", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return Response.json({
            title: "craziest work",
            thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/shortcode/DXU4PV2AGJU/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                video_versions: [
                  {
                    url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
                    width: 720,
                    height: 1280,
                  },
                ],
                image_versions2: {
                  candidates: [
                    {
                      url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
                    },
                  ],
                },
                caption: { text: "craziest work" },
                video_duration: 128.4,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const hydrated = await hydrateInstagramEmbedsForShare(makeShare());

    expect(hydrated.snapshot.embeds[0].video).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
      width: 720,
      height: 1280,
      kind: "direct",
      contentType: "video/mp4",
      durationSeconds: 128.4,
    });
  });

  it("falls back to the Instagram shortcode endpoint when oEmbed returns null", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return new Response("not found", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/shortcode/DXU4PV2AGJU/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                video_versions: [
                  {
                    url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=2",
                    width: 720,
                    height: 1280,
                  },
                ],
                image_versions2: {
                  candidates: [
                    {
                      url: "https://scontent-ord5-1.cdninstagram.com/thumb-2.jpg",
                    },
                  ],
                },
                caption: { text: "craziest work again" },
                video_duration: 64.2,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const hydrated = await hydrateInstagramEmbedsForShare(makeShare());

    expect(hydrated.snapshot.embeds[0].video).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=2",
      width: 720,
      height: 1280,
      kind: "direct",
      contentType: "video/mp4",
      durationSeconds: 64.2,
    });
    expect(hydrated.snapshot.embeds[0].thumbnail).toEqual({
      url: "https://scontent-ord5-1.cdninstagram.com/thumb-2.jpg",
      width: 640,
      height: 1137,
    });
  });

  it("falls back to the public Instagram page metadata when API endpoints return 404", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return new Response("No Media Match", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/",
          )
        ) {
          return new Response("not found", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://www.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/",
          )
        ) {
          return new Response("not found", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (url === "https://www.instagram.com/p/DZ9DK2RgNSk/") {
          return new Response(
            `
          <html>
            <head>
              <meta property="og:title" content="tas on Instagram: &quot;rukia!&quot;" />
              <meta property="og:description" content="1,073 likes, 15 comments - tasyiu on June 23, 2026: &quot;rukia!&quot;. " />
              <meta property="og:image" content="https://scontent-ord5-2.cdninstagram.com/fresh-image.jpg?oe=6A53095B&amp;_nc_ht=scontent-ord5-2.cdninstagram.com" />
            </head>
          </html>
        `,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const share = makeShare();
    share.snapshot.content =
      "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==";
    share.snapshot.embeds[0] = {
      ...share.snapshot.embeds[0],
      url: "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
      rawTitle: undefined,
      thumbnail: undefined,
      media: undefined,
      video: undefined,
      author: undefined,
      metrics: undefined,
      timestamp: undefined,
      audio: undefined,
    };

    const hydrated = await hydrateInstagramEmbedsForShare(share);

    expect(hydrated.snapshot.embeds[0].rawTitle).toBe("rukia!");
    expect(hydrated.snapshot.embeds[0].thumbnail).toEqual({
      url: "https://scontent-ord5-2.cdninstagram.com/fresh-image.jpg?oe=6A53095B&_nc_ht=scontent-ord5-2.cdninstagram.com",
      width: undefined,
      height: undefined,
    });
    expect(hydrated.snapshot.embeds[0].media).toEqual([
      {
        type: "image",
        url: "https://scontent-ord5-2.cdninstagram.com/fresh-image.jpg?oe=6A53095B&_nc_ht=scontent-ord5-2.cdninstagram.com",
        altText: "rukia!",
      },
    ]);
    expect(hydrated.snapshot.embeds[0].metrics).toEqual({
      comments: 15,
      likes: 1073,
      views: undefined,
    });
  });

  it("uses the shared entity id from the public Instagram page to recover slideshow media", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return new Response("No Media Match", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/",
          )
        ) {
          return new Response("not found", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://www.instagram.com/api/v1/media/shortcode/DZ9DK2RgNSk/info/",
          )
        ) {
          return new Response("not found", {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/3926308389746955428/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                caption: { text: "rukia!" },
                like_count: 1073,
                comment_count: 15,
                taken_at: 1782272402,
                user: {
                  username: "tasyiu",
                  profile_pic_url:
                    "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
                  is_verified: true,
                },
                carousel_media: [
                  {
                    image_versions2: {
                      candidates: [
                        {
                          url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
                          width: 2728,
                          height: 1817,
                        },
                        {
                          url: "https://scontent-ord5-2.cdninstagram.com/slide-1-small.jpg?oe=6A53095B",
                          width: 750,
                          height: 500,
                        },
                      ],
                    },
                  },
                  {
                    image_versions2: {
                      candidates: [
                        {
                          url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925",
                          width: 2727,
                          height: 1816,
                        },
                        {
                          url: "https://scontent-ord5-1.cdninstagram.com/slide-2-small.jpg?oe=6A532925",
                          width: 750,
                          height: 499,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          });
        }
        if (url === "https://www.instagram.com/p/DZ9DK2RgNSk/") {
          return new Response(
            `
          <html>
            <head>
              <meta property="og:title" content="tas on Instagram: &quot;rukia!&quot;" />
              <meta property="og:description" content="1,073 likes, 15 comments - tasyiu on June 23, 2026: &quot;rukia!&quot;. " />
              <meta property="og:image" content="https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B" />
              <script type="application/json">{"shared_entity_id":"3926308389746955428"}</script>
            </head>
          </html>
        `,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const share = makeShare();
    share.snapshot.content =
      "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==";
    share.snapshot.embeds[0] = {
      ...share.snapshot.embeds[0],
      url: "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
      rawTitle: undefined,
      thumbnail: undefined,
      media: undefined,
      video: undefined,
      author: undefined,
      metrics: undefined,
      timestamp: undefined,
      audio: undefined,
    };

    const hydrated = await hydrateInstagramEmbedsForShare(share);

    expect(hydrated.snapshot.embeds[0].rawTitle).toBe("rukia!");
    expect(hydrated.snapshot.embeds[0].author).toEqual({
      name: "tasyiu",
      url: "https://www.instagram.com/tasyiu",
      iconURL:
        "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
      isVerified: true,
    });
    expect(hydrated.snapshot.embeds[0].thumbnail).toEqual({
      url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
      width: 2728,
      height: 1817,
    });
    expect(hydrated.snapshot.embeds[0].media).toEqual([
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
    expect(hydrated.snapshot.embeds[0].metrics).toEqual({
      comments: 15,
      likes: 1073,
      views: undefined,
    });
  });

  it("replaces stale Instagram media URLs on a complete stored embed", async () => {
    workerEnv.INSTAGRAM_SESSIONID = "sessionid";
    workerEnv.INSTAGRAM_CSRFTOKEN = "csrftoken";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return Response.json({
            media_id: "3878972523924185684_71645946242",
            thumbnail_url:
              "https://scontent-ord5-2.cdninstagram.com/fresh-thumb.jpg",
            title: "craziest work",
            author_name: "example",
            author_url: "https://www.instagram.com/example",
            provider_name: "Instagram",
            provider_url: "https://www.instagram.com",
          });
        }
        if (
          url.startsWith(
            "https://i.instagram.com/api/v1/media/3878972523924185684/info/",
          )
        ) {
          return Response.json({
            items: [
              {
                video_versions: [
                  {
                    url: "https://scontent-ord5-2.cdninstagram.com/fresh-video.mp4?sig=9",
                    width: 720,
                    height: 1280,
                  },
                ],
                image_versions2: {
                  candidates: [
                    {
                      url: "https://scontent-ord5-2.cdninstagram.com/fresh-thumb.jpg",
                      width: 640,
                      height: 1137,
                    },
                  ],
                },
                caption: { text: "craziest work" },
                video_duration: 128.4,
                user: {
                  username: "example",
                  profile_pic_url:
                    "https://scontent-ord5-2.cdninstagram.com/fresh-avatar.jpg",
                  is_verified: false,
                },
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const share = makeShare();
    share.snapshot.embeds[0] = {
      ...share.snapshot.embeds[0],
      rawTitle: "craziest work",
      author: {
        name: "example",
        url: "https://www.instagram.com/example",
        iconURL: "https://scontent-ord5-1.cdninstagram.com/stale-avatar.jpg",
        isVerified: false,
      },
      thumbnail: {
        url: "https://scontent-ord5-1.cdninstagram.com/stale-thumb.jpg",
        width: 640,
        height: 1137,
      },
      media: [
        {
          type: "video",
          url: "https://scontent-ord5-1.cdninstagram.com/stale-video.mp4",
          width: 720,
          height: 1280,
        },
      ],
      video: {
        url: "https://scontent-ord5-1.cdninstagram.com/stale-video.mp4",
        width: 720,
        height: 1280,
        kind: "direct",
        contentType: "video/mp4",
        durationSeconds: 128.4,
      },
      metrics: { likes: 1, comments: 1, views: 1 },
      timestamp: "2026-05-24T12:00:00.000Z",
      audio: { title: "track" },
    };

    const hydrated = await hydrateInstagramEmbedsForShare(share);
    const embed = hydrated.snapshot.embeds[0];

    expect(embed.video?.url).toBe(
      "https://scontent-ord5-2.cdninstagram.com/fresh-video.mp4?sig=9",
    );
    expect(embed.thumbnail?.url).toBe(
      "https://scontent-ord5-2.cdninstagram.com/fresh-thumb.jpg",
    );
    expect(embed.author?.iconURL).toBe(
      "https://scontent-ord5-2.cdninstagram.com/fresh-avatar.jpg",
    );
    expect(embed.media?.[0]?.url).toBe(
      "https://scontent-ord5-2.cdninstagram.com/fresh-video.mp4?sig=9",
    );
  });

  it("turns a stored social embed into a tombstone when the post is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (
          url.startsWith("https://api.fxtwitter.com") ||
          url.startsWith("https://api.vxtwitter.com") ||
          url.startsWith("https://vxtwitter.com")
        ) {
          return new Response(
            JSON.stringify({ code: 404, message: "NOT_FOUND" }),
            {
              status: 404,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const [embed] = await hydrateSocialEmbeds([
      {
        id: "embed-x-deleted",
        url: "https://x.com/example/status/2057892777069883519",
        type: "rich",
        provider: { name: "X", url: "https://x.com" },
        media: [
          {
            type: "image",
            url: "https://pbs.twimg.com/media/stale.jpg",
          },
        ],
        fields: [],
      },
    ]);

    expect(embed.unavailable).toBe(true);
    expect(embed.media).toBeUndefined();
    expect(embed.id).toBe("embed-x-deleted");
  });

  it("keeps stored X media when embed providers fail transiently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream unavailable", { status: 503 })),
    );

    const stored = {
      id: "embed-x-1",
      url: "https://x.com/example/status/123",
      type: "rich" as const,
      provider: { name: "X", url: "https://x.com" },
      media: [
        {
          type: "image" as const,
          url: "https://pbs.twimg.com/media/still-here.jpg",
        },
      ],
      fields: [],
    };

    const [embed] = await hydrateSocialEmbeds([stored]);

    expect(embed).toEqual(stored);
  });
});
