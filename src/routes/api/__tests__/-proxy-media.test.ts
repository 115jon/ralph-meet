import { afterEach, describe, expect, it, vi } from "vitest";
import { inferMediaContentType, isAllowedMediaUrl, normalizeRefreshableMediaKey, pickRefreshedMediaUrl, proxyMedia } from "../proxy-media";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy media helpers", () => {
  it("preserves explicit media content types", () => {
    expect(inferMediaContentType("video/mp4; charset=binary")).toBe("video/mp4; charset=binary");
    expect(inferMediaContentType("image/jpeg")).toBe("image/jpeg");
    expect(inferMediaContentType("audio/mp4")).toBe("audio/mp4");
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

  it("infers Instagram audio URLs when upstream returns a vague content type", () => {
    expect(inferMediaContentType(null, "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5")).toBe("audio/mp4");
    expect(inferMediaContentType(null, "https://scontent-ord5-1.cdninstagram.com/path/progressive/?mime_type=audio%2Fmpeg")).toBe("audio/mpeg");
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

    it("matches refreshed Instagram audio by stable path", () => {
      expect(pickRefreshedMediaUrl([
        {
          type: "audio",
          url: "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5",
        },
      ], "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?stp=dst-audio")).toBe(
        "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5"
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

    it("matches refreshed TikTok avatar urls by stable path when the signature changes", () => {
      expect(pickRefreshedMediaUrl([
        {
          type: "image",
          url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=fresh&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783170000&x-signature=freshsig",
        },
        {
          type: "image",
          url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast5-i-photomode-tx/972da93247aa452099fd6b20757465df~tplv-photomode-image-cover:640:0:q70.webp?refresh_token=coverfresh",
        },
      ], "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=stale&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783080000&x-signature=stalesig")).toBe(
        "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=fresh&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783170000&x-signature=freshsig"
      );
    });
  });

  describe("TikTok proxy fallback", () => {
    const sourceUrl = "https://www.tiktok.com/@feetlattee/photo/7649484991986027806";
    const staleImageUrl = "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-i-photomode-tx2/d9d1c6f4367e4ad59e911bfc44654fcb~tplv-photomode-image.jpeg?x-expires=1783080000&x-signature=stalesig";
    const freshImageUrl = "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-i-photomode-tx2/d9d1c6f4367e4ad59e911bfc44654fcb~tplv-photomode-image.jpeg?x-expires=1783170000&x-signature=freshsig";

    function makeTikwmResponse(imageUrl: string): Response {
      return Response.json({
        code: 0,
        data: {
          id: "7649484991986027806",
          cover: imageUrl,
          origin_cover: imageUrl,
          ai_dynamic_cover: imageUrl,
          author: {
            unique_id: "feetlattee",
          },
          images: [imageUrl],
        },
      });
    }

    it("redirects the browser to a refreshed TikTok CDN url when worker-side fetches are forbidden", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return makeTikwmResponse(freshImageUrl);
        }

        if (url === staleImageUrl || url === freshImageUrl) {
          return new Response("Forbidden", {
            status: 403,
            headers: {
              "Content-Type": "text/html",
              "Content-Length": "9",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(`https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`),
        true,
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(freshImageUrl);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("still redirects to the direct TikTok asset when refresh resolves to the same url", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return makeTikwmResponse(staleImageUrl);
        }

        if (url === staleImageUrl) {
          return new Response("Forbidden", {
            status: 403,
            headers: {
              "Content-Type": "text/html",
              "Content-Length": "9",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(`https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`),
        true,
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(staleImageUrl);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
