import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearVideoPlaybackAvailabilityCacheForTests,
  primeVideoPlaybackAvailability,
  shouldProbeVideoPlaybackAvailability,
} from "@/lib/video-playback-availability";

describe("video playback availability", () => {
  afterEach(() => {
    clearVideoPlaybackAvailabilityCacheForTests();
    vi.restoreAllMocks();
  });

  it("probes proxied non-animated videos when a poster is available", () => {
    expect(shouldProbeVideoPlaybackAvailability({
      src: "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2Ftest.mp4",
      contentType: "video/mp4",
      posterUrl: "https://pbs.twimg.com/amplify_video_thumb/test.jpg",
      sourceUrl: "https://x.com/example/status/1",
      isAnimated: false,
    })).toBe(true);
  });

  it("skips uploaded attachments and animated videos", () => {
    expect(shouldProbeVideoPlaybackAvailability({
      src: "/api/attachments/local.mp4",
      contentType: "video/mp4",
      posterUrl: "https://example.com/local.jpg",
      isAnimated: false,
    })).toBe(false);

    expect(shouldProbeVideoPlaybackAvailability({
      src: "/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2Ftest.mp4",
      contentType: "video/mp4",
      posterUrl: "https://pbs.twimg.com/tweet_video_thumb/test.jpg",
      isAnimated: true,
    })).toBe(false);
  });

  it("marks probed videos as playable when the proxy returns a video response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await primeVideoPlaybackAvailability({
      src: "https://meet.115jon.site/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2Ftest.mp4",
      contentType: "video/mp4",
      posterUrl: "https://pbs.twimg.com/amplify_video_thumb/test.jpg",
      sourceUrl: "https://x.com/example/status/1",
      isAnimated: false,
    });

    expect(result).toBe("playable");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://meet.115jon.site/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2Ftest.mp4",
      expect.objectContaining({
        method: "GET",
        headers: {
          Range: "bytes=0-0",
        },
      }),
    );
  });

  it("falls back to poster mode when the proxy response is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
      },
    })));

    const result = await primeVideoPlaybackAvailability({
      src: "https://meet.115jon.site/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2Ftest.mp4",
      contentType: "video/mp4",
      posterUrl: "https://pbs.twimg.com/amplify_video_thumb/test.jpg",
      sourceUrl: "https://x.com/example/status/1",
      isAnimated: false,
    });

    expect(result).toBe("poster");
  });
});
