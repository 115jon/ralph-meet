import type { MessageShare } from "@/services/message-share.service";
import { describe, expect, it } from "vitest";
import { buildShareMetadata, buildShareOEmbed } from "../share-metadata";

function makeShare(overrides: Partial<MessageShare> = {}): MessageShare {
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
      content: "Check this **out** https://example.com",
      author: {
        id: "author-1",
        username: "jm50106001",
        display_name: null,
        avatar_url: null,
      },
      attachments: [],
      omitted_attachment_count: 0,
      embeds: [],
      reactions: [],
      reply_count: 0,
      created_at: "2026-05-24T12:00:00.000Z",
      updated_at: null,
    },
    ...overrides,
  };
}

describe("share metadata", () => {
  it("builds noindex Open Graph source data for text shares", () => {
    const metadata = buildShareMetadata("https://meet.115jon.site", makeShare());

    expect(metadata.title).toBe("Check this out https://example.com");
    expect(metadata.description).toBe("Check this out https://example.com");
    expect(metadata.shareUrl).toBe("https://meet.115jon.site/share/tok_123");
    expect(metadata.oembedUrl).toContain("/api/oembed?url=");
    expect(metadata.robots).toBe("noindex, nofollow");
    expect(metadata.media).toBeUndefined();
  });

  it("uses embed text instead of repeating a pasted URL-only message", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          content: "https://x.com/GiFShitpost/status/2058251424576741420?s=20",
          embeds: [
            {
              id: "embed-1",
              url: "https://x.com/GiFShitpost/status/2058251424576741420?s=20",
              type: "rich",
              rawDescription: "is this shit from fortnite bro",
              author: {
                name: "GIFs Shitpost (@GiFShitpost)",
                url: "https://twitter.com/GiFShitpost",
              },
              provider: { name: "X", url: "https://x.com" },
              thumbnail: {
                url: "https://pbs.twimg.com/tweet_video_thumb/HI9uM1OXgAIwHo-.jpg",
                width: 800,
                height: 782,
              },
              video: {
                url: "https://video.twimg.com/tweet_video/HI9uM1OXgAIwHo-.mp4",
                width: 800,
                height: 782,
                kind: "direct",
                contentType: "video/mp4",
              },
              fields: [],
            },
          ],
        },
      })
    );

    expect(metadata.title).toBe("GIFs Shitpost (@GiFShitpost)");
    expect(metadata.description).toBe("is this shit from fortnite bro");
    expect(metadata.media).toEqual({
      type: "video",
      url: "https://video.twimg.com/tweet_video/HI9uM1OXgAIwHo-.mp4",
      contentType: "video/mp4",
      width: 800,
      height: 782,
    });
  });

  it("uses user-written message text as title while keeping embed media", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          content: "Look at this one",
          embeds: [
            {
              id: "embed-1",
              url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              type: "video",
              rawTitle: "Example YouTube video",
              rawDescription: "A video description",
              provider: { name: "YouTube", url: "https://www.youtube.com" },
              thumbnail: {
                url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                width: 480,
                height: 360,
              },
              video: {
                url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
                width: 1280,
                height: 720,
                kind: "player",
              },
              fields: [],
            },
          ],
        },
      })
    );

    expect(metadata.title).toBe("Look at this one");
    expect(metadata.description).toBe("jm50106001: Look at this one");
    expect(metadata.media).toEqual({
      type: "image",
      url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      width: 480,
      height: 360,
    });
  });

  it("uses provider-aware image cards for link-only player embeds", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          content: "https://www.tiktok.com/@johnny/video/123",
          embeds: [
            {
              id: "embed-1",
              url: "https://www.tiktok.com/@johnny/video/123",
              type: "video",
              rawTitle: "TikTok - Johnny",
              rawDescription: "#roblox #robloxfyp #roblox",
              provider: { name: "TikTok", url: "https://www.tiktok.com" },
              thumbnail: {
                url: "https://p16-sign.tiktokcdn-us.com/tos-useast5-p/example.jpeg",
                width: 720,
                height: 1280,
              },
              video: {
                url: "https://www.tiktok.com/player/v1/123",
                width: 325,
                height: 738,
                kind: "player",
              },
              fields: [],
            },
          ],
        },
      })
    );

    expect(metadata.title).toBe("TikTok - Johnny");
    expect(metadata.description).toBe("#roblox #robloxfyp #roblox");
    expect(metadata.media).toEqual({
      type: "image",
      url: "https://meet.115jon.site/api/shared-messages/tok_123/preview-image",
      width: 600,
      height: 315,
    });
  });

  it("prefers uploaded image media for unfurls", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          attachments: [
            {
              id: "att-1",
              filename: "photo.png",
              file_key: "attachments/server/channel/photo.png",
              size_bytes: 123,
              content_type: "image/png",
              url: "/api/attachments/server/channel/photo.png",
            },
          ],
        },
      })
    );

    expect(metadata.media).toEqual({
      type: "image",
      url: "https://meet.115jon.site/api/shared-messages/tok_123/media/server/channel/photo.png",
      contentType: "image/png",
    });
  });

  it("uses embed thumbnails when no shareable attachment or video exists", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          content: "",
          embeds: [
            {
              id: "embed-1",
              url: "https://example.com/post",
              rawTitle: "External post",
              rawDescription: "External description",
              type: "link",
              fields: [],
              thumbnail: {
                url: "https://cdn.example.com/thumb.jpg",
                width: 1200,
                height: 630,
              },
            },
          ],
        },
      })
    );

    expect(metadata.description).toBe("External description");
    expect(metadata.media).toEqual({
      type: "image",
      url: "https://cdn.example.com/thumb.jpg",
      width: 1200,
      height: 630,
    });
  });

  it("escapes oEmbed html and reports video type", () => {
    const metadata = buildShareMetadata(
      "https://meet.115jon.site",
      makeShare({
        snapshot: {
          ...makeShare().snapshot,
          content: "<script>alert(1)</script>",
          attachments: [
            {
              id: "att-1",
              filename: "clip.mp4",
              file_key: "attachments/server/channel/clip.mp4",
              size_bytes: 456,
              content_type: "video/mp4",
              url: "/api/attachments/server/channel/clip.mp4",
            },
          ],
        },
      })
    );
    const oembed = buildShareOEmbed(metadata);

    expect(oembed.type).toBe("video");
    expect(oembed.html).toContain("&lt;script");
    expect(oembed.html).not.toContain("<script>");
  });
});
