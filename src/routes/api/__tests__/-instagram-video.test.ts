import { describe, expect, it } from "vitest";

import {
  canonicalizeInstagramUrl,
  extractInstagramShortcode,
  extractInstagramVideoUrlsFromDashManifest,
  normalizeInstagramMediaPk,
  parseInstagramGraphqlPayload,
} from "../instagram-video";

describe("instagram video route helpers", () => {
  it("canonicalizes supported Instagram media URLs", () => {
    expect(canonicalizeInstagramUrl("https://www.instagram.com/reel/DXU4PV2AGJU/?igsh=abc")).toBe(
      "https://www.instagram.com/reel/DXU4PV2AGJU/"
    );
    expect(canonicalizeInstagramUrl("https://instagram.com/p/ABC123")).toBe(
      "https://www.instagram.com/p/ABC123/"
    );
    expect(canonicalizeInstagramUrl("https://www.instagram.com/tv/XYZ987/")).toBe(
      "https://www.instagram.com/tv/XYZ987/"
    );
  });

  it("extracts shortcode from supported paths", () => {
    expect(extractInstagramShortcode("https://www.instagram.com/reel/DXU4PV2AGJU/")).toBe("DXU4PV2AGJU");
    expect(extractInstagramShortcode("https://www.instagram.com/p/ABC123/")).toBe("ABC123");
    expect(extractInstagramShortcode("https://www.instagram.com/reels/SHORT1/")).toBe("SHORT1");
  });

  it("normalizes instagram media ids to numeric media pk", () => {
    expect(normalizeInstagramMediaPk("3878972523924185684_71645946242")).toBe("3878972523924185684");
    expect(normalizeInstagramMediaPk("3878972523924185684")).toBe("3878972523924185684");
    expect(normalizeInstagramMediaPk("bad_id")).toBeNull();
  });

  it("rejects invalid or unsupported URLs", () => {
    expect(canonicalizeInstagramUrl("https://example.com/video/123")).toBeNull();
    expect(extractInstagramShortcode("https://www.instagram.com/explore/")).toBeNull();
  });

  it("maps Instagram graphql payload into route response shape", () => {
    expect(parseInstagramGraphqlPayload({
      data: {
        xdt_shortcode_media: {
          video_url: "https://instagram.cdn/video.mp4?sig=1",
          display_url: "https://instagram.cdn/thumb.jpg?sig=1",
          video_duration: 27.433,
          edge_media_to_caption: {
            edges: [
              {
                node: {
                  text: "some of my craziest work",
                },
              },
            ],
          },
        },
      },
    })).toEqual({
      videoUrl: "https://instagram.cdn/video.mp4?sig=1",
      thumbnailUrl: "https://instagram.cdn/thumb.jpg?sig=1",
      title: "some of my craziest work",
      durationSeconds: 27.433,
    });
  });

  it("extracts direct video urls from the Instagram dash manifest", () => {
    expect(extractInstagramVideoUrlsFromDashManifest(`
      <MPD>
        <AdaptationSet contentType="video">
          <Representation>
            <BaseURL>https://scontent-ord5-1.cdninstagram.com/o1/v/t16/f2/m86/AQTEST.mp4?_nc_cat=111&amp;oe=6A46B22A</BaseURL>
          </Representation>
        </AdaptationSet>
        <AdaptationSet contentType="audio">
          <Representation>
            <BaseURL>https://scontent-ord5-2.cdninstagram.com/o1/v/t2/f2/m367/AQAUDIO.mp4?_nc_cat=103&amp;oe=6A46E0C4</BaseURL>
          </Representation>
        </AdaptationSet>
      </MPD>
    `)).toEqual([
      "https://scontent-ord5-1.cdninstagram.com/o1/v/t16/f2/m86/AQTEST.mp4?_nc_cat=111&oe=6A46B22A",
      "https://scontent-ord5-2.cdninstagram.com/o1/v/t2/f2/m367/AQAUDIO.mp4?_nc_cat=103&oe=6A46E0C4",
    ]);
  });

  it("returns null fields when graphql payload is missing media", () => {
    expect(parseInstagramGraphqlPayload({ data: { xdt_shortcode_media: null } })).toEqual({
      videoUrl: null,
      thumbnailUrl: null,
      title: null,
      durationSeconds: null,
    });
  });
});
