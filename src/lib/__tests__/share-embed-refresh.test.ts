import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { hydrateInstagramEmbedsForShare } from "../share-embed-refresh";
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
      content: "https://www.instagram.com/reel/DXU4PV2AGJU/?igsh=b3hjc3NnZGg2NjZv",
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

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
        return Response.json({
          media_id: "3878972523924185684_71645946242",
          thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
          title: "craziest work",
        });
      }
      if (url.startsWith("https://i.instagram.com/api/v1/media/3878972523924185684/info/")) {
        return Response.json({
          items: [{
            video_versions: [
              { url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1", width: 720, height: 1280 },
            ],
            image_versions2: {
              candidates: [
                { url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg" },
              ],
            },
            caption: { text: "craziest work" },
            video_duration: 128.4,
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

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

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
        return Response.json({
          media_id: "3878972523924185684_71645946242",
          title: "craziest work",
          thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
        });
      }
      if (url.startsWith("https://i.instagram.com/api/v1/media/3878972523924185684/info/")) {
        return Response.json({
          items: [{
            video_versions: [
              { url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1", width: 720, height: 1280 },
            ],
            image_versions2: {
              candidates: [
                { url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg" },
              ],
            },
            caption: { text: "craziest work" },
            video_duration: 128.4,
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

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
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (!url.startsWith("https://www.tikwm.com/api/?url=")) {
        throw new Error(`Unexpected fetch: ${url}`);
      }

      return Response.json({
        code: 0,
        data: {
          id: "7644364274630020383",
          title: "Not even gonna let him finish this one",
          hdplay: "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4",
          cover: "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
          author: {
            nickname: "1Cloud9",
            unique_id: "kingoftheskys1",
            avatar: "https://p16-common-sign.tiktokcdn-us.com/example/avatar.jpeg",
          },
          digg_count: 17039,
          comment_count: 363,
          play_count: 183647,
          create_time: 1748306272,
          duration: 21,
        },
      });
    }) as unknown as typeof fetch);

    const share = {
      ...makeShare(),
      snapshot: {
        ...makeShare().snapshot,
        content: "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383",
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

    expect(embed.url).toBe("https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383");
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
        thumbnailUrl: "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
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

  it("leaves non-Instagram embeds unchanged", async () => {
    const share = {
      ...makeShare(),
      snapshot: {
        ...makeShare().snapshot,
        embeds: [
          {
            id: "embed-x-1",
            url: "https://x.com/example/status/123",
            type: "rich" as const,
            rawTitle: "example",
            provider: { name: "X", url: "https://x.com" },
            fields: [],
          },
        ],
      },
    };

    const hydrated = await hydrateInstagramEmbedsForShare(share);

    expect(hydrated).toBe(share);
  });
});
