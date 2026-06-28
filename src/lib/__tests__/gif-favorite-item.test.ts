import { describe, expect, it } from "vitest";

import { createAttachmentClipFavorite, createAttachmentGifFavorite, createExternalGifFavorite, getFxTwitterGifWebpUrl } from "@/lib/gif-favorite-item";

describe("gif favorite item helpers", () => {
  it("creates clip favorites for external mp4 videos", () => {
    const favorite = createExternalGifFavorite({
      id: "clip-1",
      title: "Helicopter clip",
      sourceUrl: "https://cdn.example.com/clips/helicopter.mp4",
      sendUrl: "https://cdn.example.com/clips/helicopter.mp4",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      duration: 12.4,
    });

    expect(favorite.mediaType).toBe("clips");
    expect(favorite.preview.contentType).toBe("video/mp4");
    expect(favorite.send.contentType).toBe("video/mp4");
    expect(favorite.send.url).toBe("https://cdn.example.com/clips/helicopter.mp4");
    expect(favorite.duration).toBe(12.4);
  });

  it("derives FxTwitter animated WebP URLs from Twitter GIF MP4 media", () => {
    expect(getFxTwitterGifWebpUrl("https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4")).toBe(
      "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp"
    );
  });

  it("derives FxTwitter animated WebP URLs from proxied Twitter GIF MP4 media", () => {
    expect(getFxTwitterGifWebpUrl("/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2FHKohayFWcAA3VCp.mp4")).toBe(
      "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp"
    );
  });

  it("does not derive WebP URLs for normal Twitter videos", () => {
    expect(getFxTwitterGifWebpUrl("https://video.twimg.com/amplify_video/2065467720074661889/vid/avc1/720x1280/QgEjUIGoD_gpNbNV.mp4")).toBeNull();
  });

  it("preserves WebP as an image GIF favorite asset type", () => {
    const favorite = createExternalGifFavorite({
      sourceUrl: "https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4",
      sendUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      contentType: "image/webp",
    });

    expect(favorite.preview.contentType).toBe("image/webp");
    expect(favorite.send).toMatchObject({
      url: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      contentType: "image/webp",
    });
  });

  it("preserves provider identity for sent GIF attachments", () => {
    const favorite = createAttachmentGifFavorite({
      filename: "4551195970372378.gif",
      sourceUrl: "https://static.klipy.com/full.gif",
      sendUrl: "https://static.klipy.com/full.gif",
      contentType: "image/gif",
    });

    expect(favorite.provider).toBe("klipy");
    expect(favorite.id).toBe("4551195970372378");
  });

  it("creates clip favorites for mp4 attachments", () => {
    const favorite = createAttachmentClipFavorite({
      id: "attachment-clip-1",
      filename: "attachment-clip-1.mp4",
      title: "Attachment clip",
      sourceUrl: "/api/attachments/attachment-clip-1",
      sendUrl: "/api/attachments/attachment-clip-1",
      contentType: "video/mp4",
      width: 1280,
      height: 720,
    });

    expect(favorite.provider).toBe("external");
    expect(favorite.mediaType).toBe("clips");
    expect(favorite.id).toBe("/api/attachments/attachment-clip-1");
    expect(favorite.send.contentType).toBe("video/mp4");
    expect(favorite.send.url).toBe("/api/attachments/attachment-clip-1");
  });

  it("matches X GIF favorites after they are sent as FxTwitter attachments", () => {
    const embeddedFavorite = createExternalGifFavorite({
      id: "x-media-0-https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4",
      sourceUrl: "https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4",
      previewUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      sendUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      contentType: "image/webp",
    });
    const sentFavorite = createAttachmentGifFavorite({
      id: "0f72a3a1-a38c-4893-8a9d-6db1862bc438",
      filename: "x-media-0-https-video.twimg.com-tweet_video-HKohayFWcAA3VCp.mp4.webp",
      fileKeyOrUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      sourceUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      sendUrl: "https://gif.fxtwitter.com/tweet_video/HKohayFWcAA3VCp.webp",
      contentType: "image/webp",
    });

    expect(sentFavorite.provider).toBe(embeddedFavorite.provider);
    expect(sentFavorite.id).toBe(embeddedFavorite.id);
  });
});
