import { extractYouTubeVideoId, pickPreferredFormat } from "../ytdlp/youtube";
import { describe, expect, it } from "vitest";

describe("yt-dlp YouTube helpers", () => {
  it("extracts video ids from common YouTube URL shapes", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=test")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("prefers direct audio-only formats when audio playback is requested", () => {
    const format = pickPreferredFormat([
      {
        itag: 140,
        url: "https://example.com/audio-mp4",
        mimeType: "audio/mp4; codecs=\"mp4a.40.2\"",
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
        mimeType: "video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"",
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
    ], "audio", "mp4");

    expect(format?.itag).toBe(140);
  });
});
