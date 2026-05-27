import { afterEach, describe, expect, it, vi } from "vitest";
import { extractAndProcessEmbeds } from "../embed-fetcher";

const X_URL = "https://x.com/ausso52693/status/2057892777069883519";
const VIDEO_URL = "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractAndProcessEmbeds", () => {
  it("preserves X video metadata as a direct video embed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "Example post",
            author: {
              name: "Example Author",
              screen_name: "ausso52693",
              avatar_url: "https://pbs.twimg.com/profile_images/example.jpg",
            },
            created_timestamp: 1779474846,
            media: {
              videos: [{
                url: VIDEO_URL,
                thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/example.jpg",
                width: 640,
                height: 702,
              }],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].type).toBe("rich");
    expect(embeds[0].video?.url).toBe(VIDEO_URL);
    expect(embeds[0].video?.kind).toBe("direct");
    expect(embeds[0].thumbnail?.url).toContain("pbs.twimg.com");
  });

  it("preserves X gif metadata as an autoplayable tweet video", async () => {
    const gifUrl = "https://video.twimg.com/tweet_video/HI9uM1OXgAIwHo-.mp4";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "is this shit from fortnite bro",
            author: {
              name: "GIFs Shitpost",
              screen_name: "GiFShitpost",
              avatar_url: "https://pbs.twimg.com/profile_images/example.gif",
            },
            media: {
              videos: [{
                url: gifUrl,
                thumbnail_url: "https://pbs.twimg.com/tweet_video_thumb/HI9uM1OXgAIwHo-.jpg",
                width: 800,
                height: 782,
                type: "gif",
              }],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds("https://x.com/GiFShitpost/status/2058251424576741420?s=20");

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.url).toBe(gifUrl);
    expect(embeds[0].video?.kind).toBe("direct");
    expect(embeds[0].thumbnail?.url).toContain("tweet_video_thumb");
    expect(embeds[0].rawDescription).toBe("is this shit from fortnite bro");
  });

  it("uses vxtwitter OG media when JSON APIs only expose the legacy Twitter player URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com") || url.startsWith("https://api.vxtwitter.com")) {
        return new Response("not found", { status: 404 });
      }

      if (url.startsWith("https://vxtwitter.com")) {
        return new Response(`
          <meta property="og:title" content="Example (@ausso52693)" />
          <meta property="og:description" content="Example post" />
          <meta property="og:image" content="https://pbs.twimg.com/amplify_video_thumb/example.jpg" />
          <meta property="og:video" content="https://vxtwitter.com/tvid/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT" />
          <meta property="og:video:type" content="video/mp4" />
        `, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.url).toBe("https://vxtwitter.com/tvid/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT");
  });

  it("prefers refreshed TikTok proxy covers over official oEmbed thumbnails", async () => {
    const tikTokVideoUrl = "https://v16m.tiktokcdn-us.com/example/video/tos/no1a/tos-no1a-ve-0068-no/id/?mime_type=video_mp4";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://www.tiktok.com/oembed")) {
        return Response.json({
          title: "official title",
          author_name: "Johnny",
          thumbnail_url: "https://p16-common-sign.tiktokcdn-us.com/stale.jpeg",
          thumbnail_width: 576,
          thumbnail_height: 1024,
          html: '<blockquote data-video-id="7617216826585468182"></blockquote>',
        });
      }
      if (url.startsWith("https://www.tikwm.com/api/")) {
        return Response.json({
          code: 0,
          data: {
            title: "fresh title",
            cover: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
            play: tikTokVideoUrl,
            author: { nickname: "Johnny" },
          },
        });
      }
      return new Response("not found", { status: 404 });
    }));

    const embeds = await extractAndProcessEmbeds("https://www.tiktok.com/@mrniceguyg/video/7617216826585468182");

    expect(embeds[0].thumbnail?.url).toBe("https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg");
    expect(embeds[0].video?.url).toBe(tikTokVideoUrl);
    expect(embeds[0].video?.kind).toBe("direct");
    expect(embeds[0].video?.contentType).toBe("video/mp4");
  });
});
