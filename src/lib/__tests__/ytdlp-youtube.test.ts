import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ytdlp/upstream", () => ({
  loadActiveSolverBundle: vi.fn(async () => ({
    version: "test-bundle",
    source: "bundled",
  })),
}));

import {
  __resetYouTubeInnertubeCacheForTests,
  extractYouTubeVideoId,
  pickPreferredFormat,
  resolvePlayableYouTubeAudio,
  resolveYouTubePlayback,
  YouTubeBotCheckError,
} from "../ytdlp/youtube";
import type { YouTubeResolvedFormat } from "../ytdlp/types";

function audioFormat(
  overrides: Partial<YouTubeResolvedFormat>,
): YouTubeResolvedFormat {
  return {
    itag: 140,
    url: "https://example.com/audio",
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    container: "mp4",
    codecs: ["mp4a.40.2"],
    bitrate: 128000,
    contentLength: 100,
    width: null,
    height: null,
    fps: null,
    qualityLabel: null,
    audioSampleRate: 44100,
    audioChannels: 2,
    hasAudio: true,
    hasVideo: false,
    projectionType: null,
    expiresAt: null,
    ...overrides,
  };
}

const MUXED_360P = audioFormat({
  itag: 18,
  url: "https://example.com/muxed",
  mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
  codecs: ["avc1.42001E", "mp4a.40.2"],
  // The real itag 18 carries ~500 kbps of video: more than any audio stream.
  bitrate: 503000,
  width: 640,
  height: 360,
  fps: 30,
  qualityLabel: "360p",
  hasVideo: true,
});

function requestUrl(input: string | URL | Request) {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

const BOT_WALL = {
  playabilityStatus: {
    status: "LOGIN_REQUIRED",
    reason: "Sign in to confirm you’re not a bot",
  },
};

afterEach(() => {
  __resetYouTubeInnertubeCacheForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("yt-dlp YouTube helpers", () => {
  it("extracts video ids from common YouTube URL shapes", () => {
    expect(
      extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=test")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("prefers direct audio-only formats when audio playback is requested", () => {
    const format = pickPreferredFormat(
      [
        {
          itag: 140,
          url: "https://example.com/audio-mp4",
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          container: "mp4",
          codecs: ["mp4a.40.2"],
          bitrate: 128000,
          contentLength: 100,
          width: null,
          height: null,
          fps: null,
          qualityLabel: null,
          audioSampleRate: 44100,
          audioChannels: 2,
          hasAudio: true,
          hasVideo: false,
          projectionType: null,
          expiresAt: null,
        },
        {
          itag: 18,
          url: "https://example.com/muxed",
          mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          container: "mp4",
          codecs: ["avc1.42001E", "mp4a.40.2"],
          bitrate: 96000,
          contentLength: 100,
          width: 640,
          height: 360,
          fps: 30,
          qualityLabel: "360p",
          audioSampleRate: 44100,
          audioChannels: 2,
          hasAudio: true,
          hasVideo: true,
          projectionType: null,
          expiresAt: null,
        },
      ],
      "audio",
      "mp4",
    );

    expect(format?.itag).toBe(140);
  });

  it("never picks the muxed video file over audio-only streams, whatever its bitrate", () => {
    const opus = audioFormat({
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      container: "webm",
      codecs: ["opus"],
      bitrate: 135000,
    });
    const aac = audioFormat({ itag: 140, bitrate: 130000 });
    const heAac = audioFormat({ itag: 139, bitrate: 49000 });

    expect(
      pickPreferredFormat([MUXED_360P, opus, aac, heAac], "audio", "mp4")?.itag,
    ).toBe(140);
    expect(
      pickPreferredFormat([MUXED_360P, opus, aac, heAac], "audio", "webm")
        ?.itag,
    ).toBe(251);
    // Only the muxed file left: still playable as audio.
    expect(pickPreferredFormat([MUXED_360P], "audio", "webm")?.itag).toBe(18);
  });

  it("resolves playback from the cached web innertube session without requiring the watch page", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "https://www.youtube.com/?hl=en") {
        return new Response(
          [
            "<!doctype html><html><head><script>",
            'ytcfg.set({"INNERTUBE_API_KEY":"test-key","INNERTUBE_CONTEXT_CLIENT_NAME":1,"VISITOR_DATA":"visitor-data","STS":12345,"PLAYER_JS_URL":"\\/s\\/player\\/test-player\\/player_ias.vflset\\/en_US\\/base.js","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20260611.01.00","hl":"en","gl":"US","utcOffsetMinutes":0}}});',
            "</script></head><body></body></html>",
          ].join(""),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }

      if (
        url.startsWith(
          "https://www.youtube.com/youtubei/v1/player?key=test-key",
        )
      ) {
        return Response.json({
          videoDetails: {
            title: "Remote Safe Track",
            author: "Resolver Test",
            lengthSeconds: "123",
            isLiveContent: false,
          },
          streamingData: {
            adaptiveFormats: [
              {
                itag: 140,
                url: "https://rr1---sn.example.googlevideo.com/videoplayback?expire=1893456000&itag=140",
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: 128000,
                contentLength: "123456",
                audioSampleRate: "44100",
                audioChannels: 2,
              },
            ],
          },
        });
      }

      if (url.startsWith("https://www.youtube.com/watch?")) {
        return new Response("Too Many Requests", { status: 429 });
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYouTubePlayback(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      {
        preferredKind: "audio",
        preferredContainer: "mp4",
        includeFormats: true,
      },
    );

    expect(resolved.title).toBe("Remote Safe Track");
    expect(resolved.playerUrl).toBe(
      "https://www.youtube.com/s/player/test-player/player_ias.vflset/en_US/base.js",
    );
    expect(resolved.selectedFormat?.itag).toBe(140);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.youtube\.com\/watch\?/),
      expect.anything(),
    );
  });

  it("resolves playback from clean fallback clients before fetching the web session", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
          const headers = new Headers(init?.headers);
          // IOS goes first: it answers Cloudflare with direct audio URLs.
          expect(headers.get("X-YouTube-Client-Name")).toBe("5");
          expect(headers.get("X-Goog-Visitor-Id")).toBeNull();
          expect(headers.get("Cookie")).toBeNull();

          return Response.json({
            videoDetails: {
              title: "Fallback First Track",
              author: "Resolver Test",
              lengthSeconds: "222",
              isLiveContent: false,
            },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 140,
                  url: "https://rr1---sn.example.googlevideo.com/videoplayback?expire=1893456000&itag=140",
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  bitrate: 128000,
                  contentLength: "654321",
                  audioSampleRate: "44100",
                  audioChannels: 2,
                },
              ],
            },
          });
        }

        if (
          url === "https://www.youtube.com/?hl=en" ||
          url.startsWith("https://www.youtube.com/watch?")
        ) {
          throw new Error(`Unexpected web bootstrap fetch in test: ${url}`);
        }

        throw new Error(`Unexpected fetch in test: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYouTubePlayback(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      {
        preferredKind: "audio",
        preferredContainer: "mp4",
        includeFormats: true,
      },
    );

    expect(resolved.title).toBe("Fallback First Track");
    expect(resolved.selectedFormat?.itag).toBe(140);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at YouTube's bot wall without asking the walled web pages too", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
        return Response.json(BOT_WALL);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveYouTubePlayback("dQw4w9WgXcQ", { preferredKind: "audio" }),
    ).rejects.toBeInstanceOf(YouTubeBotCheckError);
    // One call per playback client, then nothing.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("skips a client whose formats need the solver when a later one has direct URLs", async () => {
    const clients: string[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (
          !url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")
        ) {
          throw new Error(`Unexpected fetch in test: ${url}`);
        }
        const clientName =
          new Headers(init?.headers).get("X-YouTube-Client-Name") ?? "";
        clients.push(clientName);
        if (clientName === "5") {
          // IOS: only ciphered formats this time.
          return Response.json({
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 140,
                  signatureCipher:
                    "s=abc&sp=sig&url=https%3A%2F%2Frr1---sn.example.googlevideo.com%2Fvideoplayback%3Fitag%3D140",
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  bitrate: 128000,
                },
              ],
            },
          });
        }
        if (clientName === "28") {
          return Response.json({
            videoDetails: { title: "Direct Track", lengthSeconds: "200" },
            streamingData: {
              formats: [
                {
                  itag: 18,
                  url: "https://rr1---sn.example.googlevideo.com/videoplayback?expire=1893456000&itag=18",
                  mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
                  bitrate: 503000,
                  qualityLabel: "360p",
                  width: 640,
                  height: 360,
                  audioQuality: "AUDIO_QUALITY_LOW",
                },
              ],
              adaptiveFormats: [
                {
                  itag: 251,
                  url: "https://rr1---sn.example.googlevideo.com/videoplayback?expire=1893456000&itag=251",
                  mimeType: 'audio/webm; codecs="opus"',
                  bitrate: 135000,
                  audioQuality: "AUDIO_QUALITY_MEDIUM",
                },
              ],
            },
          });
        }
        return Response.json(BOT_WALL);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYouTubePlayback("dQw4w9WgXcQ", {
      preferredKind: "audio",
      preferredContainer: "mp4",
      includeFormats: true,
    });

    expect(clients).toEqual(["5", "3", "28"]);
    // Audio-only Opus beats the muxed file even though mp4 was asked for.
    expect(resolved.selectedFormat?.itag).toBe(251);
    expect(resolved.selectedFormat?.expiresAt).toBe(1893456000 * 1000);
  });

  it("gives each player call a timeout so a hanging client cannot stall the resolve", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        return Response.json({
          streamingData: {
            adaptiveFormats: [
              {
                itag: 140,
                url: "https://rr1---sn.example.googlevideo.com/videoplayback?itag=140",
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: 128000,
              },
            ],
          },
        });
      }),
    );

    await resolveYouTubePlayback("dQw4w9WgXcQ", { preferredKind: "audio" });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("resolvePlayableYouTubeAudio", () => {
  const IOS_AAC =
    "https://rr1---sn.example.googlevideo.com/videoplayback?c=IOS&itag=140&expire=1893456000";
  const ANDROID_MUXED =
    "https://rr2---sn.example.googlevideo.com/videoplayback?c=ANDROID&itag=18&expire=1893456000";

  function playerAnswer(clientName: string) {
    if (clientName === "5") {
      return Response.json({
        streamingData: {
          adaptiveFormats: [
            {
              itag: 140,
              url: IOS_AAC,
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              bitrate: 130000,
              contentLength: "3860872",
            },
          ],
        },
      });
    }
    if (clientName === "3") {
      return Response.json({
        streamingData: {
          formats: [
            {
              itag: 18,
              url: ANDROID_MUXED,
              mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
              bitrate: 503000,
              qualityLabel: "360p",
              width: 640,
              height: 360,
              audioQuality: "AUDIO_QUALITY_LOW",
            },
          ],
        },
      });
    }
    return Response.json(BOT_WALL);
  }

  function stubYouTube(tailStatus: (url: string) => number) {
    const players: string[] = [];
    const probes: Array<{ url: string; range: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        const headers = new Headers(init?.headers);
        if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
          const client = headers.get("X-YouTube-Client-Name") ?? "";
          players.push(client);
          return playerAnswer(client);
        }
        if (url.includes(".googlevideo.com/")) {
          probes.push({ url, range: headers.get("Range") });
          return new Response(null, { status: tailStatus(url) });
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }),
    );
    return { players, probes };
  }

  it("keeps the audio-only stream when its last bytes answer", async () => {
    const { players, probes } = stubYouTube(() => 206);

    const format = await resolvePlayableYouTubeAudio("VtcP0PFifpE", "mp4");

    expect(format.itag).toBe(140);
    expect(players).toEqual(["5"]);
    expect(probes).toEqual([{ url: IOS_AAC, range: "bytes=3860870-3860871" }]);
  });

  it("moves past a client whose stream is cut off after the first MiB", async () => {
    const { players, probes } = stubYouTube((url) =>
      url.includes("c=IOS") ? 403 : 206,
    );

    const format = await resolvePlayableYouTubeAudio("VtcP0PFifpE", "mp4");

    expect(format.itag).toBe(18);
    // IOS once, then the same walk without IOS: ANDROID answers first.
    expect(players).toEqual(["5", "3"]);
    // No content length on the muxed format: probe just past the first MiB.
    expect(probes.at(-1)).toEqual({
      url: ANDROID_MUXED,
      range: "bytes=1048576-1048577",
    });
  });

  it("gives up with the refused formats named instead of looping", async () => {
    const { players } = stubYouTube(() => 403);

    await expect(
      resolvePlayableYouTubeAudio("VtcP0PFifpE", "webm"),
    ).rejects.toThrow(/IOS:140, ANDROID:18/);
    expect(players.length).toBeLessThanOrEqual(8);
  });
});
