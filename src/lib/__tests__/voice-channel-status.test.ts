import { describe, expect, it } from "vitest";

import type { GifPickerItem } from "@/lib/gif-picker";
import { voiceChannelStatusMediaFromGifItem } from "@/lib/voice-channel-status";

function makeGif(overrides: Partial<GifPickerItem> = {}): GifPickerItem {
  return {
    id: "goat-gif",
    title: "Goat Gif",
    provider: "external",
    altText: "goat",
    sourceUrl: "https://example.com/source",
    aspectRatio: 2,
    mediaType: "gifs",
    preview: {
      url: "https://example.com/preview.mp4",
      width: 200,
      height: 100,
      sizeBytes: 10,
      contentType: "video/mp4",
    },
    send: {
      url: "https://example.com/send.gif",
      width: 400,
      height: 200,
      sizeBytes: 20,
      contentType: "image/gif",
    },
    ...overrides,
  };
}

describe("voice channel status GIF mapping", () => {
  it("uses the animated send asset instead of the lightweight preview asset", () => {
    const media = voiceChannelStatusMediaFromGifItem(makeGif());

    expect(media.preview_url).toBe("https://example.com/send.gif");
    expect(media.preview_width).toBe(400);
    expect(media.preview_height).toBe(200);
    expect(media.preview_content_type).toBe("image/gif");
  });
});
