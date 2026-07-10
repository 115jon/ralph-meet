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
  resolveYouTubePlayback,
} from "../ytdlp/youtube";

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
          expect(headers.get("X-YouTube-Client-Name")).toBe("28");
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

  it("does not rerun fallback playback clients after switching to the web session", async () => {
    let androidVrAttempts = 0;
    let webAttempts = 0;

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
          const clientName = headers.get("X-YouTube-Client-Name");

          if (clientName === "28") {
            androidVrAttempts += 1;
            return Response.json({
              playabilityStatus: {
                status: "LOGIN_REQUIRED",
                reason: "Sign in to confirm you’re not a bot",
              },
            });
          }

          if (
            clientName === "1" &&
            url.startsWith(
              "https://www.youtube.com/youtubei/v1/player?key=test-key",
            )
          ) {
            webAttempts += 1;
            return Response.json({
              videoDetails: {
                title: "Web Recovery Track",
                author: "Resolver Test",
                lengthSeconds: "180",
                isLiveContent: false,
              },
              streamingData: {
                adaptiveFormats: [
                  {
                    itag: 140,
                    url: "https://rr1---sn.example.googlevideo.com/videoplayback?expire=1893456000&itag=140",
                    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                    bitrate: 128000,
                    contentLength: "111111",
                    audioSampleRate: "44100",
                    audioChannels: 2,
                  },
                ],
              },
            });
          }

          return Response.json({
            playabilityStatus: {
              status: "LOGIN_REQUIRED",
              reason: "Sign in to confirm you’re not a bot",
            },
          });
        }

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

        if (url.startsWith("https://www.youtube.com/watch?")) {
          throw new Error(`Unexpected watch page fetch in test: ${url}`);
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

    expect(resolved.title).toBe("Web Recovery Track");
    expect(resolved.selectedFormat?.itag).toBe(140);
    expect(androidVrAttempts).toBe(1);
    expect(webAttempts).toBe(1);
  });
});
