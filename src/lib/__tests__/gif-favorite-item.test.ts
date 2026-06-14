import { describe, expect, it } from "vitest";

import { createAttachmentGifFavorite, createExternalGifFavorite, getFxTwitterGifWebpUrl } from "@/lib/gif-favorite-item";

describe("gif favorite item helpers", () => {
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
});
