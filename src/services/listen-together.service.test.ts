import {
  extractYouTubeUrl,
  mapYoutubeVideoNode,
  parseDurationSeconds,
  scoreYoutubeCandidate,
} from "@/services/listen-together.service";
import { describe, expect, it } from "vitest";

describe("listen together provider helpers", () => {
  it("extracts YouTube watch and playlist identifiers from supported URLs", () => {
    expect(extractYouTubeUrl("https://youtu.be/abc123XYZ90")).toEqual({
      provider: "youtube",
      videoId: "abc123XYZ90",
    });

    expect(
      extractYouTubeUrl(
        "https://music.youtube.com/watch?v=abc123XYZ90&list=PL12345",
      ),
    ).toEqual({
      provider: "youtube_music",
      videoId: "abc123XYZ90",
      playlistId: "PL12345",
    });
  });

  it("normalizes a YouTube video node into a track result", () => {
    const mapped = mapYoutubeVideoNode({
      video_id: "abc123XYZ90",
      title: { runs: [{ text: "Track One" }] },
      author: { name: { runs: [{ text: "Artist Name" }] } },
      length_text: { runs: [{ text: "3:45" }] },
      thumbnails: [
        { url: "https://img.example/1.jpg" },
        { url: "https://img.example/2.jpg" },
      ],
    });

    expect(mapped).toMatchObject({
      kind: "track",
      id: "youtube:abc123XYZ90",
      provider: "youtube",
      videoId: "abc123XYZ90",
      title: "Track One",
      artist: "Artist Name",
      durationMs: 225_000,
      artworkUrl: "https://img.example/2.jpg",
      sourceLabel: "YouTube",
    });
  });

  it("strips spoken duration suffixes from accessible YouTube titles", () => {
    const mapped = mapYoutubeVideoNode({
      video_id: "fine1234567",
      title: { runs: [{ text: "Fine 3 minutes, 10 seconds" }] },
      author: { name: { runs: [{ text: "The Cardigans" }] } },
      length_text: { runs: [{ text: "3:10" }] },
      thumbnails: [{ url: "https://img.example/fine.jpg" }],
    });

    expect(mapped?.title).toBe("Fine");
  });

  it("scores close Spotify matches above unrelated candidates", () => {
    const target = {
      name: "Midnight City",
      artist: "M83",
      duration: 244,
    };

    const closeMatch = scoreYoutubeCandidate(
      {
        kind: "music",
        id: "youtube:good",
        provider: "youtube",
        videoId: "good",
        title: "M83 - Midnight City",
        artist: "M83",
        album: null,
        durationMs: 244_000,
        artworkUrl: null,
        canonicalUrl: "https://www.youtube.com/watch?v=good",
        sourceUrl: "https://www.youtube.com/watch?v=good",
        sourceLabel: "YouTube",
      },
      target,
    );

    const weakMatch = scoreYoutubeCandidate(
      {
        kind: "music",
        id: "youtube:weak",
        provider: "youtube",
        videoId: "weak",
        title: "Completely Different Song",
        artist: "Another Artist",
        album: null,
        durationMs: 120_000,
        artworkUrl: null,
        canonicalUrl: "https://www.youtube.com/watch?v=weak",
        sourceUrl: "https://www.youtube.com/watch?v=weak",
        sourceLabel: "YouTube",
      },
      target,
    );

    expect(closeMatch).toBeGreaterThan(weakMatch);
  });

  it("accepts spotify duration values that are already in milliseconds", () => {
    const closeMatch = scoreYoutubeCandidate(
      {
        kind: "music",
        id: "youtube:good-ms",
        provider: "youtube",
        videoId: "good-ms",
        title: "The Cardigans - Fine",
        artist: "The Cardigans",
        album: null,
        durationMs: 189_000,
        artworkUrl: null,
        canonicalUrl: "https://www.youtube.com/watch?v=good-ms",
        sourceUrl: "https://www.youtube.com/watch?v=good-ms",
        sourceLabel: "YouTube",
      },
      {
        name: "Fine",
        artist: "The Cardigans",
        duration: 189_895,
      },
    );

    expect(closeMatch).toBeGreaterThan(10);
  });

  it("parses colon-delimited durations into seconds", () => {
    expect(parseDurationSeconds("3:45")).toBe(225);
    expect(parseDurationSeconds("1:02:03")).toBe(3_723);
  });

  it("normalizes lockup-style playlist videos into track results", () => {
    const mapped = mapYoutubeVideoNode({
      contentId: "pGMGwizKUis",
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: {
        lockupMetadataViewModel: {
          title: { content: "M83 - Hurry Up, We're Dreaming Outro" },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                {
                  metadataParts: [{ text: { content: "Gucci Palucci" } }],
                },
              ],
            },
          },
        },
      },
      contentImage: {
        thumbnailViewModel: {
          image: {
            sources: [
              { url: "https://img.example/1.jpg" },
              { url: "https://img.example/2.jpg" },
            ],
          },
          overlays: [
            {
              thumbnailBottomOverlayViewModel: {
                badges: [
                  {
                    thumbnailBadgeViewModel: {
                      text: "4:08",
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    expect(mapped).toMatchObject({
      kind: "track",
      videoId: "pGMGwizKUis",
      title: "M83 - Hurry Up, We're Dreaming Outro",
      artist: "Gucci Palucci",
      durationMs: 248_000,
      artworkUrl: "https://img.example/2.jpg",
    });
  });
});
