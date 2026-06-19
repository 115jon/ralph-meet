import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import { fetchChannelMedia } from "../media.service";

describe("fetchChannelMedia", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("preserves canonical urls for external and already-proxied attachments", async () => {
    db.mockQuery("FROM attachments a", {
      results: [
        {
          id: "a_external",
          filename: "provider.gif",
          file_key: "https://static.klipy.com/provider.gif",
          content_type: "image/gif",
          size_bytes: 1234,
          created_at: "2026-06-19T05:00:00.000Z",
          message_created_at: "2026-06-19T05:00:00.000Z",
          message_id: "m_external",
          author_id: "u1",
          author_username: "alice",
          author_display_name: null,
          author_avatar_url: null,
        },
        {
          id: "a_proxy",
          filename: "clip.mp4",
          file_key: "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2Ftest.mp4",
          content_type: "video/mp4",
          size_bytes: 4096,
          created_at: "2026-06-19T04:59:00.000Z",
          message_created_at: "2026-06-19T04:59:00.000Z",
          message_id: "m_proxy",
          author_id: "u1",
          author_username: "alice",
          author_display_name: null,
          author_avatar_url: null,
        },
      ],
    });
    db.mockQuery("COALESCE(m.embeds, '[]') != '[]'", { results: [] });

    const items = await fetchChannelMedia(db as any, "channel_1");

    expect(items.find((item) => item.id === "a_external")).toMatchObject({
      file_key: "https://static.klipy.com/provider.gif",
      url: "https://static.klipy.com/provider.gif",
      source_kind: "attachment",
    });
    expect(items.find((item) => item.id === "a_proxy")).toMatchObject({
      file_key: "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2Ftest.mp4",
      url: "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2Ftest.mp4",
      source_kind: "attachment",
    });
  });

  it("includes direct media extracted from stored embeds", async () => {
    db.mockQuery("FROM attachments a", {
      results: [
        {
          id: "a_old",
          filename: "older.png",
          file_key: "attachments/channel/a_old/older.png",
          content_type: "image/png",
          size_bytes: 512,
          created_at: "2026-06-19T04:00:00.000Z",
          message_created_at: "2026-06-19T04:00:00.000Z",
          message_id: "m_old",
          author_id: "u1",
          author_username: "alice",
          author_display_name: null,
          author_avatar_url: null,
        },
      ],
    });
    db.mockQuery("COALESCE(m.embeds, '[]') != '[]'", {
      results: [
        {
          message_id: "m_embed",
          created_at: "2026-06-19T05:10:00.000Z",
          embeds: JSON.stringify([
            {
              id: "embed_1",
              url: "https://x.com/example/status/1",
              type: "rich",
              thumbnail: {
                url: "https://pbs.twimg.com/tweet_video_thumb/example.jpg",
              },
              media: [
                {
                  type: "image",
                  url: "https://pbs.twimg.com/media/one.jpg?name=orig",
                  width: 1200,
                  height: 900,
                },
                {
                  type: "video",
                  url: "https://video.twimg.com/tweet_video/example.mp4",
                  thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/example.jpg",
                  contentType: "video/mp4",
                  isGif: true,
                },
              ],
              referencedTweet: {
                type: "quoted",
                media: [
                  {
                    type: "image",
                    url: "https://pbs.twimg.com/media/quoted.jpg",
                  },
                ],
              },
              fields: [],
            },
          ]),
          author_id: "u2",
          author_username: "bob",
          author_display_name: "Bob",
          author_avatar_url: "https://cdn.example.com/bob.png",
        },
      ],
    });

    const items = await fetchChannelMedia(db as any, "channel_1");

    expect(items[0]?.message_id).toBe("m_embed");
    expect(items.map((item) => item.url)).toEqual(expect.arrayContaining([
      "https://pbs.twimg.com/media/one.jpg?name=orig",
      "https://video.twimg.com/tweet_video/example.mp4",
      "https://pbs.twimg.com/media/quoted.jpg",
      "/api/attachments/channel/a_old/older.png",
    ]));

    expect(items.find((item) => item.url === "https://video.twimg.com/tweet_video/example.mp4")).toMatchObject({
      message_id: "m_embed",
      source_kind: "embed",
      filename: "example.mp4",
      content_type: "video/mp4",
      thumbnail_url: "https://pbs.twimg.com/tweet_video_thumb/example.jpg",
      is_gif: true,
    });
  });
});
