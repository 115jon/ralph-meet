import { describe, expect, it } from "vitest";
import { inferMediaContentType } from "../proxy-media";

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
});
