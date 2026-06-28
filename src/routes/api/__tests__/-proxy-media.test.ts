import { describe, expect, it } from "vitest";
import { inferMediaContentType, isAllowedMediaUrl, normalizeRefreshableMediaKey, pickRefreshedMediaUrl } from "../proxy-media";

describe("proxy media helpers", () => {
  it("preserves explicit media content types", () => {
    expect(inferMediaContentType("video/mp4; charset=binary")).toBe("video/mp4; charset=binary");
    expect(inferMediaContentType("image/jpeg")).toBe("image/jpeg");
  });

  it("infers X/Twitter MP4 videos when upstream returns a vague content type", () => {
    const url = "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/file.mp4";
    expect(inferMediaContentType("application/octet-stream", url)).toBe("video/mp4");
    expect(inferMediaContentType(null, url)).toBe("video/mp4");
  });

  it("infers TikTok play URLs as MP4 when upstream returns a vague content type", () => {
    expect(inferMediaContentType(null, "https://v16m.tiktokcdn-us.com/example/video/tos/no1a/tos-no1a-ve/id/")).toBe("video/mp4");
    expect(inferMediaContentType("application/octet-stream", "https://api16-normal-useast5.tiktokv.us/aweme/v1/play/?video_id=abc")).toBe("video/mp4");
  });

  it("falls back to octet-stream for unknown media", () => {
    expect(inferMediaContentType(null, "https://vxtwitter.com/tvid/unknown")).toBe("application/octet-stream");
  });

  describe("isAllowedMediaUrl", () => {
    it("allows twimg and vxtwitter domains", () => {
      expect(isAllowedMediaUrl(new URL("https://video.twimg.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://pbs.twimg.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://vxtwitter.com/tvid/123"))).toBe(true);
    });

    it("allows tiktok domains", () => {
      expect(isAllowedMediaUrl(new URL("https://api16-normal-useast5.tiktokv.us/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://anything.tiktokv.us/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://anything.tiktokcdn-us.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://anything.tiktokcdn.com/path"))).toBe(true);
    });

    it("allows instagram cdn domains", () => {
      expect(isAllowedMediaUrl(new URL("https://scontent-ord5-1.cdninstagram.com/path/thumb.jpg"))).toBe(true);
    });

    it("allows klipy domains", () => {
      expect(isAllowedMediaUrl(new URL("https://static.klipy.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://media.klipy.com/path"))).toBe(true);
    });

    it("allows tenor domains", () => {
      expect(isAllowedMediaUrl(new URL("https://tenor.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://media.tenor.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://media1.tenor.com/path"))).toBe(true);
    });

    it("denies unallowed domains", () => {
      expect(isAllowedMediaUrl(new URL("https://evil.com/path"))).toBe(false);
      expect(isAllowedMediaUrl(new URL("https://notklipy.com/path"))).toBe(false);
      expect(isAllowedMediaUrl(new URL("https://nottenor.com/path"))).toBe(false);
      expect(isAllowedMediaUrl(new URL("http://static.klipy.com/path"))).toBe(false); // must be https
      expect(isAllowedMediaUrl(new URL("http://tenor.com/path"))).toBe(false); // must be https
    });
  });

  describe("refresh matching", () => {
    it("matches refreshed X videos by stable path even when query params change", () => {
      expect(pickRefreshedMediaUrl([
        {
          type: "video",
          url: "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14",
          thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg",
        },
      ], "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=27")).toBe(
        "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14"
      );
    });

    it("matches refreshed thumbnails by stable image path", () => {
      expect(pickRefreshedMediaUrl([
        {
          type: "video",
          url: "https://video.twimg.com/amplify_video/example.mp4?tag=14",
          thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg",
        },
      ], "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg?name=orig")).toBe(
        "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg"
      );
    });

    it("normalizes refreshable media keys by host and path", () => {
      expect(normalizeRefreshableMediaKey("https://video.twimg.com/tweet_video/test.mp4?tag=12")).toBe(
        "video.twimg.com/tweet_video/test.mp4"
      );
      expect(normalizeRefreshableMediaKey("https://scontent-ord5-1.cdninstagram.com/v/t51.82787-15/thumb.jpg?stp=dst-jpg&ccb=7-5")).toBe(
        "scontent-ord5-1.cdninstagram.com/v/t51.82787-15/thumb.jpg"
      );
      expect(normalizeRefreshableMediaKey("https://v16m.tiktokcdn-us.com/example/video/file/?token=1")).toBe(
        "v16m.tiktokcdn-us.com/example/video/file/"
      );
    });
  });
});
