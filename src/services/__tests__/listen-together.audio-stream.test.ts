import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolvePlayableYouTubeAudio = vi.hoisted(() => vi.fn());
const cacheSet = vi.hoisted(() =>
  vi.fn(async (_key: string, _value: unknown, _ttlSeconds?: number) => {}),
);

vi.mock("@/lib/ytdlp/youtube", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ytdlp/youtube")>()),
  resolvePlayableYouTubeAudio,
}));
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(async () => null),
  cacheGetMany: vi.fn(async () => new Map()),
  cacheSet,
}));

import { resetUpstreamState, UpstreamBlockedError } from "@/lib/upstream-guard";
import { YouTubeBotCheckError } from "@/lib/ytdlp/youtube";
import { resolveListenTogetherAudioStream } from "@/services/listen-together.service";

function resolvedPlayback(expireSeconds: number) {
  return {
    url: `https://rr1---sn.example.googlevideo.com/videoplayback?expire=${expireSeconds}`,
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    contentLength: 4_000_000,
    expiresAt: expireSeconds * 1000,
  };
}

describe("resolveListenTogetherAudioStream", () => {
  beforeEach(() => {
    resetUpstreamState();
  });

  afterEach(() => {
    resolvePlayableYouTubeAudio.mockReset();
    cacheSet.mockClear();
  });

  it("caches a stream URL until shortly before it expires, capped at 30 minutes", async () => {
    const sixHours = Math.floor(Date.now() / 1000) + 6 * 60 * 60;
    resolvePlayableYouTubeAudio.mockResolvedValueOnce(
      resolvedPlayback(sixHours),
    );
    await resolveListenTogetherAudioStream("video-long", "mp4");
    expect(cacheSet).toHaveBeenLastCalledWith(
      "v1:listen-together:stream:mp4:video-long",
      expect.objectContaining({ itag: 140 }),
      30 * 60,
    );

    const tenMinutes = Math.floor(Date.now() / 1000) + 10 * 60;
    resolvePlayableYouTubeAudio.mockResolvedValueOnce(
      resolvedPlayback(tenMinutes),
    );
    await resolveListenTogetherAudioStream("video-short", "mp4");
    const ttl = cacheSet.mock.lastCall?.[2] as number;
    expect(ttl).toBeGreaterThan(4 * 60);
    expect(ttl).toBeLessThanOrEqual(5 * 60);
  });

  it("backs off after YouTube's bot wall instead of re-running every client", async () => {
    resolvePlayableYouTubeAudio.mockRejectedValueOnce(
      new YouTubeBotCheckError("walled"),
    );

    await expect(
      resolveListenTogetherAudioStream("video-walled", "mp4"),
    ).rejects.toBeInstanceOf(YouTubeBotCheckError);
    await expect(
      resolveListenTogetherAudioStream("video-other", "webm", {
        forceRefresh: true,
      }),
    ).rejects.toBeInstanceOf(UpstreamBlockedError);
    expect(resolvePlayableYouTubeAudio).toHaveBeenCalledTimes(1);
  });

  it("shares one resolve between concurrent requests for a track", async () => {
    const sixHours = Math.floor(Date.now() / 1000) + 6 * 60 * 60;
    resolvePlayableYouTubeAudio.mockResolvedValue(resolvedPlayback(sixHours));

    await Promise.all([
      resolveListenTogetherAudioStream("video-shared", "webm"),
      resolveListenTogetherAudioStream("video-shared", "webm"),
    ]);
    expect(resolvePlayableYouTubeAudio).toHaveBeenCalledTimes(1);
  });
});
