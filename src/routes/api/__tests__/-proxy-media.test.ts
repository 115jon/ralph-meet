import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inferMediaContentType,
  isAllowedMediaUrl,
  normalizeRefreshableMediaKey,
  pickRefreshedMediaUrl,
  pickRefreshedMediaUrls,
  proxyMedia,
} from "../proxy-media";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy media helpers", () => {
  it("preserves explicit media content types", () => {
    expect(inferMediaContentType("video/mp4; charset=binary")).toBe(
      "video/mp4; charset=binary",
    );
    expect(inferMediaContentType("image/jpeg")).toBe("image/jpeg");
    expect(inferMediaContentType("audio/mp4")).toBe("audio/mp4");
  });

  it("infers X/Twitter MP4 videos when upstream returns a vague content type", () => {
    const url =
      "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/file.mp4";
    expect(inferMediaContentType("application/octet-stream", url)).toBe(
      "video/mp4",
    );
    expect(inferMediaContentType(null, url)).toBe("video/mp4");
  });

  it("infers TikTok play URLs as MP4 when upstream returns a vague content type", () => {
    expect(
      inferMediaContentType(
        null,
        "https://v16m.tiktokcdn-us.com/example/video/tos/no1a/tos-no1a-ve/id/",
      ),
    ).toBe("video/mp4");
    expect(
      inferMediaContentType(
        "application/octet-stream",
        "https://api16-normal-useast5.tiktokv.us/aweme/v1/play/?video_id=abc",
      ),
    ).toBe("video/mp4");
  });

  it("infers Instagram audio URLs when upstream returns a vague content type", () => {
    expect(
      inferMediaContentType(
        null,
        "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5",
      ),
    ).toBe("audio/mp4");
    expect(
      inferMediaContentType(
        null,
        "https://scontent-ord5-1.cdninstagram.com/path/progressive/?mime_type=audio%2Fmpeg",
      ),
    ).toBe("audio/mpeg");
  });

  it("infers Google avatar URLs as JPEG images", () => {
    expect(
      inferMediaContentType(
        null,
        "https://lh3.googleusercontent.com/a/example-avatar=s96-c",
      ),
    ).toBe("image/jpeg");
  });

  it("falls back to octet-stream for unknown media", () => {
    expect(
      inferMediaContentType(null, "https://vxtwitter.com/tvid/unknown"),
    ).toBe("application/octet-stream");
  });

  describe("isAllowedMediaUrl", () => {
    it("allows twimg and vxtwitter domains", () => {
      expect(isAllowedMediaUrl(new URL("https://video.twimg.com/path"))).toBe(
        true,
      );
      expect(isAllowedMediaUrl(new URL("https://pbs.twimg.com/path"))).toBe(
        true,
      );
      expect(isAllowedMediaUrl(new URL("https://vxtwitter.com/tvid/123"))).toBe(
        true,
      );
    });

    it("allows tiktok domains", () => {
      expect(
        isAllowedMediaUrl(
          new URL("https://api16-normal-useast5.tiktokv.us/path"),
        ),
      ).toBe(true);
      expect(
        isAllowedMediaUrl(new URL("https://anything.tiktokv.us/path")),
      ).toBe(true);
      expect(
        isAllowedMediaUrl(new URL("https://anything.tiktokcdn-us.com/path")),
      ).toBe(true);
      expect(
        isAllowedMediaUrl(new URL("https://anything.tiktokcdn-eu.com/path")),
      ).toBe(true);
      expect(
        isAllowedMediaUrl(new URL("https://anything.tiktokcdn.com/path")),
      ).toBe(true);
    });

    it("allows instagram cdn domains", () => {
      expect(
        isAllowedMediaUrl(
          new URL("https://scontent-ord5-1.cdninstagram.com/path/thumb.jpg"),
        ),
      ).toBe(true);
    });

    it("allows klipy domains", () => {
      expect(isAllowedMediaUrl(new URL("https://static.klipy.com/path"))).toBe(
        true,
      );
      expect(isAllowedMediaUrl(new URL("https://media.klipy.com/path"))).toBe(
        true,
      );
    });

    it("allows tenor domains", () => {
      expect(isAllowedMediaUrl(new URL("https://tenor.com/path"))).toBe(true);
      expect(isAllowedMediaUrl(new URL("https://media.tenor.com/path"))).toBe(
        true,
      );
      expect(isAllowedMediaUrl(new URL("https://media1.tenor.com/path"))).toBe(
        true,
      );
    });

    it("allows Google user-content avatar domains", () => {
      expect(
        isAllowedMediaUrl(
          new URL("https://lh3.googleusercontent.com/a/example-avatar=s96-c"),
        ),
      ).toBe(true);
    });

    it("denies unallowed domains", () => {
      expect(isAllowedMediaUrl(new URL("https://evil.com/path"))).toBe(false);
      expect(isAllowedMediaUrl(new URL("https://notklipy.com/path"))).toBe(
        false,
      );
      expect(isAllowedMediaUrl(new URL("https://nottenor.com/path"))).toBe(
        false,
      );
      expect(
        isAllowedMediaUrl(new URL("https://evil-tiktok.com/video.mp4")),
      ).toBe(false);
      expect(isAllowedMediaUrl(new URL("http://static.klipy.com/path"))).toBe(
        false,
      ); // must be https
      expect(isAllowedMediaUrl(new URL("http://tenor.com/path"))).toBe(false); // must be https
    });

    it("rejects redirects to hosts outside the media allowlist", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://evil.example/secret" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          "https://meet.test/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Fpath",
        ),
        true,
      );

      expect(response.status).toBe(502);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://video.twimg.com/path",
        expect.objectContaining({ redirect: "manual" }),
      );
    });

    it("caps redirects even when every destination is allowlisted", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString());
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://video.twimg.com/path?hop=${
              Number(url.searchParams.get("hop") ?? "0") + 1
            }`,
          },
        });
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          "https://meet.test/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Fpath",
        ),
        true,
      );

      expect(response.status).toBe(508);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("refresh matching", () => {
    it("matches refreshed X videos by stable path even when query params change", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "video",
              url: "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14",
              thumbnailUrl:
                "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg",
            },
          ],
          "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=27",
        ),
      ).toBe(
        "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14",
      );
    });

    it("matches refreshed thumbnails by stable image path", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "video",
              url: "https://video.twimg.com/amplify_video/example.mp4?tag=14",
              thumbnailUrl:
                "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg",
            },
          ],
          "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg?name=orig",
        ),
      ).toBe(
        "https://pbs.twimg.com/amplify_video_thumb/2057892165804601344/img/fresh.jpg",
      );
    });

    it("matches refreshed Instagram audio by stable path", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "audio",
              url: "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5",
            },
          ],
          "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?stp=dst-audio",
        ),
      ).toBe(
        "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5",
      );
    });

    it("normalizes refreshable media keys by host and path", () => {
      expect(
        normalizeRefreshableMediaKey(
          "https://video.twimg.com/tweet_video/test.mp4?tag=12",
        ),
      ).toBe("video.twimg.com/tweet_video/test.mp4");
      expect(
        normalizeRefreshableMediaKey(
          "https://scontent-ord5-1.cdninstagram.com/v/t51.82787-15/thumb.jpg?stp=dst-jpg&ccb=7-5",
        ),
      ).toBe("scontent-ord5-1.cdninstagram.com/v/t51.82787-15/thumb.jpg");
      expect(
        normalizeRefreshableMediaKey(
          "https://v16m.tiktokcdn-us.com/example/video/file/?token=1",
        ),
      ).toBe("v16m.tiktokcdn-us.com/example/video/file/");
      expect(
        normalizeRefreshableMediaKey(
          "https://p16-common-sign.tiktokcdn-eu.com/example/image/file.webp?token=1",
        ),
      ).toBe("p16-common-sign.tiktokcdn-eu.com/example/image/file.webp");
    });

    it("matches refreshed TikTok avatar urls by stable path when the signature changes", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "image",
              url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=fresh&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783170000&x-signature=freshsig",
            },
            {
              type: "image",
              url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast5-i-photomode-tx/972da93247aa452099fd6b20757465df~tplv-photomode-image-cover:640:0:q70.webp?refresh_token=coverfresh",
            },
          ],
          "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=stale&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783080000&x-signature=stalesig",
        ),
      ).toBe(
        "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-avt-0068-tx2/5556529641ec74402d635dbaf7834cfc~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?dr=8834&idc=useast5&ps=87d6e48a&refresh_token=fresh&s=AWEME_DETAIL&sc=avatar&shcp=1d1a97fc&shp=d05b14bd&t=223449c4&x-expires=1783170000&x-signature=freshsig",
      );
    });

    it("keeps alternate TikTok image candidates available after the stable-path match", () => {
      expect(
        pickRefreshedMediaUrls(
          [
            {
              type: "image",
              url: "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:1080:1080:q70.jpeg?x-expires=1783458000&x-signature=freshsig",
            },
            {
              type: "image",
              url: "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783458000&x-signature=coverfresh",
            },
          ],
          "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:1080:1080:q70.jpeg?x-expires=1783170000&x-signature=stalesig",
        ),
      ).toEqual([
        "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:1080:1080:q70.jpeg?x-expires=1783458000&x-signature=freshsig",
        "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783458000&x-signature=coverfresh",
      ]);
    });

    it("matches refreshed TikTok assets across regional CDN hosts by stable path", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "image",
              url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-origin.image?x-expires=1783612800&x-signature=freshsig",
            },
          ],
          "https://p16-common-sign.tiktokcdn-eu.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-origin.image?x-expires=1783285200&x-signature=stalesig",
        ),
      ).toBe(
        "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-origin.image?x-expires=1783612800&x-signature=freshsig",
      );
    });

    it("prefers refreshed TikTok image candidates for origin.image requests", () => {
      expect(
        pickRefreshedMediaUrl(
          [
            {
              type: "video",
              url: "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&fresh=1",
              thumbnailUrl:
                "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783612800&x-signature=freshsig",
            },
            {
              type: "image",
              url: "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783612800&x-signature=freshsig",
            },
          ],
          "https://p16-common-sign.tiktokcdn-eu.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-origin.image?x-expires=1783285200&x-signature=stalesig&sc=cover",
        ),
      ).toBe(
        "https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783612800&x-signature=freshsig",
      );
    });
  });

  describe("TikTok proxy refresh", () => {
    const sourceUrl =
      "https://www.tiktok.com/@feetlattee/photo/7649484991986027806";
    const staleImageUrl =
      "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-i-photomode-tx2/d9d1c6f4367e4ad59e911bfc44654fcb~tplv-photomode-image.jpeg?x-expires=1783080000&x-signature=stalesig";
    const freshImageUrl =
      "https://p19-common-sign.tiktokcdn-us.com/tos-useast8-i-photomode-tx2/d9d1c6f4367e4ad59e911bfc44654fcb~tplv-photomode-image.jpeg?x-expires=1783170000&x-signature=freshsig";

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

    it("streams refreshed TikTok image assets through the proxy instead of redirecting", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (
          url.startsWith("https://www.tiktok.com/player/api/v1/items?item_ids=")
        ) {
          return new Response("not found", { status: 404 });
        }

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return makeTikwmResponse(freshImageUrl);
        }

        if (url === freshImageUrl) {
          return new Response("image-bytes", {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "11",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      await expect(response.text()).resolves.toBe("image-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("still streams the TikTok image when refresh resolves to the same url", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (
          url.startsWith("https://www.tiktok.com/player/api/v1/items?item_ids=")
        ) {
          return new Response("not found", { status: 404 });
        }

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return makeTikwmResponse(staleImageUrl);
        }

        if (url === staleImageUrl) {
          return new Response("image-bytes", {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "11",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      await expect(response.text()).resolves.toBe("image-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("falls back to another refreshed TikTok image when the first refreshed image still 403s", async () => {
      const sourceUrl =
        "https://www.tiktok.com/@killa_cop_/video/7646427256587308308";
      const staleArtworkUrl =
        "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:1080:1080:q70.jpeg?x-expires=1783170000&x-signature=stalesig";
      const freshArtworkUrl =
        "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:1080:1080:q70.jpeg?x-expires=1783458000&x-signature=freshsig";
      const freshCoverUrl =
        "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/example-cover~tplv-tiktokx-shrink-aq:360:360:q75.webp?x-expires=1783458000&x-signature=coverfresh";

      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (
          url.startsWith("https://www.tiktok.com/player/api/v1/items?item_ids=")
        ) {
          return new Response("not found", { status: 404 });
        }

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return Response.json({
            code: 0,
            data: {
              id: "7646427256587308308",
              hdplay:
                "https://v19.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&fresh=1",
              cover: freshCoverUrl,
              origin_cover: freshCoverUrl,
              music_info: {
                cover: freshArtworkUrl,
              },
              author: {
                unique_id: "killa_cop_",
                avatar:
                  "https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/example~tplv-tiktokx-cropcenter-q:300:300:q70.jpeg?x-expires=1783458000&x-signature=authorfresh",
              },
            },
          });
        }

        if (url === freshArtworkUrl) {
          return new Response(null, {
            status: 403,
            headers: {
              "Content-Type": "image/jpeg",
            },
          });
        }

        if (url === freshCoverUrl) {
          return new Response("cover-bytes", {
            headers: {
              "Content-Type": "image/webp",
              "Content-Length": "11",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleArtworkUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/webp");
      await expect(response.text()).resolves.toBe("cover-bytes");
    });

    it("uses a short cache lifetime for successful TikTok image responses", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-06T22:00:00.000Z"));

      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return makeTikwmResponse(freshImageUrl);
        }
        if (
          url.startsWith("https://www.tiktok.com/player/api/v1/items?item_ids=")
        ) {
          return new Response("not found", { status: 404 });
        }
        if (url === freshImageUrl) {
          return new Response("image-bytes", {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "11",
              "Cache-Control": "max-age=31536000",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(freshImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get("Cache-Control");
      expect(cacheControl).toMatch(/^private, max-age=\d+$/);
      expect(Number(cacheControl?.split("=").at(-1))).toBeLessThanOrEqual(300);
      await expect(response.text()).resolves.toBe("image-bytes");
    });

    it("streams TikTok CDN images even when no source url is available", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url === staleImageUrl) {
          return new Response("image-bytes", {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": "11",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      await expect(response.text()).resolves.toBe("image-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("streams refreshed TikTok video assets through the proxy instead of redirecting", async () => {
      const sourceUrl =
        "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383";
      const staleVideoUrl =
        "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&stale=1";
      const freshVideoUrl =
        "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&fresh=1";

      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();

        if (
          url.startsWith("https://www.tiktok.com/player/api/v1/items?item_ids=")
        ) {
          return new Response("not found", { status: 404 });
        }

        if (url.startsWith("https://www.tikwm.com/api/?url=")) {
          return Response.json({
            code: 0,
            data: {
              id: "7644364274630020383",
              hdplay: freshVideoUrl,
              cover:
                "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
              author: {
                unique_id: "kingoftheskys1",
              },
            },
          });
        }

        if (url === freshVideoUrl) {
          return new Response("video-bytes", {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": "11",
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleVideoUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
        ),
        true,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("video/mp4");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.text()).resolves.toBe("video-bytes");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("uses an upstream GET for TikTok video HEAD requests so signed assets still resolve", async () => {
      const sourceUrl =
        "https://www.tiktok.com/@kingoftheskys1/video/7644364274630020383";
      const staleVideoUrl =
        "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&stale=1";
      const freshVideoUrl =
        "https://v16m.tiktokcdn-us.com/example/video.mp4?mime_type=video_mp4&fresh=1";
      const upstreamMethods: string[] = [];

      const fetchMock = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = input.toString();

          if (
            url.startsWith(
              "https://www.tiktok.com/player/api/v1/items?item_ids=",
            )
          ) {
            return new Response("not found", { status: 404 });
          }

          if (url.startsWith("https://www.tikwm.com/api/?url=")) {
            upstreamMethods.push(init?.method ?? "GET");
            return Response.json({
              code: 0,
              data: {
                id: "7644364274630020383",
                hdplay: freshVideoUrl,
                cover:
                  "https://p19-common-sign.tiktokcdn-us.com/example/video-cover.webp",
                author: {
                  unique_id: "kingoftheskys1",
                },
              },
            });
          }

          upstreamMethods.push(init?.method ?? "GET");
          if (url === freshVideoUrl) {
            return new Response("video-bytes", {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": "11",
              },
            });
          }

          throw new Error(`Unexpected fetch: ${url}`);
        },
      );

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const response = await proxyMedia(
        new Request(
          `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleVideoUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
          {
            method: "HEAD",
          },
        ),
        false,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("video/mp4");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(upstreamMethods).toContain("GET");
    });
  });
});
