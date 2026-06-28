import { afterEach, describe, expect, it, vi } from "vitest";
import { extractAndProcessEmbeds } from "../embed-fetcher";

const X_URL = "https://x.com/ausso52693/status/2057892777069883519";
const VIDEO_URL = "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractAndProcessEmbeds", () => {
  it("uses actual YouTube watch dimensions for portrait videos", async () => {
    const youtubeUrl = "https://youtu.be/oLb96nwOKDg?si=r0EuY4LzKVy4PziG";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://www.youtube.com/oembed")) {
        return new Response(JSON.stringify({
          title: "The Hunter Became the Hunted #DEADLOCK",
          author_name: "72hrs",
          author_url: "https://www.youtube.com/@72hrs",
          thumbnail_url: "https://i.ytimg.com/vi/oLb96nwOKDg/hqdefault.jpg",
          thumbnail_width: 480,
          thumbnail_height: 360,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
        return new Response(JSON.stringify({
          streamingData: {
            adaptiveFormats: [
              { itag: 136, width: 720, height: 1280 },
              { itag: 299, width: 1080, height: 1920 },
            ],
          },
          playabilityStatus: { status: "OK" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://www.youtube.com/watch?v=oLb96nwOKDg&pbj=1") {
        return new Response(`
          )]}'
          {"playerResponse":{"streamingData":{"adaptiveFormats":[
            { "itag": 136, "width": 720, "height": 1280 },
            { "itag": 299, "width": 1080, "height": 1920 }
          ]}}}
        `, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://www.youtube.com/watch?v=oLb96nwOKDg") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds(youtubeUrl);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider?.name).toBe("YouTube");
    expect(embeds[0].video?.width).toBe(1080);
    expect(embeds[0].video?.height).toBe(1920);
  });

  it("uses actual YouTube watch dimensions for standard videos", async () => {
    const youtubeUrl = "https://www.youtube.com/watch?v=abc123def45";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://www.youtube.com/oembed")) {
        return new Response(JSON.stringify({
          title: "Example horizontal video",
          author_name: "Example Creator",
          author_url: "https://www.youtube.com/@example",
          thumbnail_url: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg",
          thumbnail_width: 480,
          thumbnail_height: 360,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
        return new Response(JSON.stringify({
          streamingData: {
            formats: [
              { itag: 22, width: 1280, height: 720 },
              { itag: 18, width: 640, height: 360 },
            ],
          },
          playabilityStatus: { status: "OK" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://www.youtube.com/watch?v=abc123def45&pbj=1") {
        return new Response(`
          )]}'
          {"playerResponse":{"streamingData":{"formats":[
            { "itag": 22, "width": 1280, "height": 720 },
            { "itag": 18, "width": 640, "height": 360 }
          ]}}}
        `, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://www.youtube.com/watch?v=abc123def45") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds(youtubeUrl);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.width).toBe(1280);
    expect(embeds[0].video?.height).toBe(720);
  });

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

  it("uses FxTwitter v2 media for fxtwitter replacement GIF links", async () => {
    const statusId = "2065601187911553195";
    const gifUrl = "https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4";
    const thumbnailUrl = "https://pbs.twimg.com/tweet_video_thumb/HKohayFWcAA3VCp.jpg";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === `https://api.fxtwitter.com/2/status/${statusId}`) {
        return new Response(JSON.stringify({
          code: 200,
          status: {
            text: "gif post",
            author: {
              name: "Felicia Hardy (Black Cat)",
              screen_name: "ThiefBlackCats",
              avatar_url: "https://pbs.twimg.com/profile_images/example.jpg",
            },
            media: {
              all: [{
                id: "2065500123107323904",
                url: gifUrl,
                thumbnail_url: thumbnailUrl,
                width: 806,
                height: 806,
                format: "video/mp4",
                type: "gif",
                formats: [{
                  url: gifUrl,
                  bitrate: 0,
                  container: "mp4",
                  codec: "h264",
                }],
              }],
              videos: [{
                id: "2065500123107323904",
                url: gifUrl,
                thumbnail_url: thumbnailUrl,
                width: 806,
                height: 806,
                format: "video/mp4",
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

    const embeds = await extractAndProcessEmbeds(`https://fxtwitter.com/ThiefBlackCats/status/${statusId}`);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider?.name).toBe("X");
    expect(embeds[0].video?.url).toBe(gifUrl);
    expect(embeds[0].video?.contentType).toBe("video/mp4");
    expect(embeds[0].media?.[0]).toMatchObject({
      type: "video",
      url: gifUrl,
      thumbnailUrl,
      width: 806,
      height: 806,
      isGif: true,
    });
  });

  it("preserves all X photos for Discord-style media grids", async () => {
    const photoUrls = [
      "https://pbs.twimg.com/media/photo-1.jpg",
      "https://pbs.twimg.com/media/photo-2.jpg",
      "https://pbs.twimg.com/media/photo-3.jpg",
      "https://pbs.twimg.com/media/photo-4.jpg",
    ];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "photo dump",
            author: {
              name: "Example Author",
              screen_name: "ausso52693",
            },
            media: {
              photos: photoUrls.map((photoUrl, index) => ({
                url: photoUrl,
                width: 1200 + index,
                height: 800 + index,
              })),
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
    expect(embeds[0].media?.map((item) => item.url)).toEqual(photoUrls);
    expect(embeds[0].media?.every((item) => item.type === "image")).toBe(true);
    expect(embeds[0].thumbnail?.url).toBe(photoUrls[0]);
  });

  it("merges X gif alt text from vxtwitter while preserving fxtwitter media order", async () => {
    const imageUrl = "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg?name=orig";
    const gifUrl = "https://video.twimg.com/tweet_video/HKes4LvXkAADDvJ.mp4";
    const gifThumb = "https://pbs.twimg.com/tweet_video_thumb/HKes4LvXkAADDvJ.jpg";
    const gifAltText = "Yes Thanos GIF";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "",
            author: {
              name: "Die Chance (5/5)",
              screen_name: "DieChanc3",
              avatar_url: "https://pbs.twimg.com/profile_images/example.jpg",
            },
            media: {
              all: [
                {
                  type: "photo",
                  url: imageUrl,
                  width: 1557,
                  height: 836,
                },
                {
                  type: "gif",
                  url: gifUrl,
                  thumbnail_url: gifThumb,
                  width: 498,
                  height: 270,
                  format: "video/mp4",
                  variants: [{
                    url: gifUrl,
                    bitrate: 0,
                    content_type: "video/mp4",
                  }],
                },
              ],
              photos: [
                {
                  type: "photo",
                  url: imageUrl,
                  width: 1557,
                  height: 836,
                },
              ],
              videos: [
                {
                  type: "gif",
                  url: gifUrl,
                  thumbnail_url: gifThumb,
                  width: 498,
                  height: 270,
                  format: "video/mp4",
                  variants: [{
                    url: gifUrl,
                    bitrate: 0,
                    content_type: "video/mp4",
                  }],
                },
              ],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://api.vxtwitter.com")) {
        return new Response(JSON.stringify({
          media_extended: [
            {
              type: "image",
              url: "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg",
              size: { width: 1557, height: 836 },
              thumbnail_url: "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg",
            },
            {
              type: "gif",
              url: gifUrl,
              size: { width: 498, height: 270 },
              thumbnail_url: gifThumb,
              altText: gifAltText,
            },
          ],
          mediaURLs: ["https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg", gifUrl],
          user_name: "Die Chance (5/5)",
          user_screen_name: "DieChanc3",
          user_profile_image_url: "https://pbs.twimg.com/profile_images/example_normal.jpg",
          date_epoch: 1781123813,
          text: "https://t.co/sGJAaEgcmZ",
          tweetURL: "https://twitter.com/DieChanc3/status/2064809045672783978",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds("https://x.com/DieChanc3/status/2064809045672783978?s=20");

    expect(embeds).toHaveLength(1);
    expect(embeds[0].media).toHaveLength(2);
    expect(embeds[0].media?.[0]).toMatchObject({
      type: "image",
      url: imageUrl,
      width: 1557,
      height: 836,
    });
    expect(embeds[0].media?.[1]).toMatchObject({
      type: "video",
      url: gifUrl,
      width: 498,
      height: 270,
      thumbnailUrl: gifThumb,
      isGif: true,
      altText: gifAltText,
    });
    expect(embeds[0].thumbnail?.url).toBe(imageUrl);
    expect(embeds[0].video?.url).toBe(gifUrl);
  });

  it("dedupes the same X video when fxtwitter and vxtwitter disagree on query params", async () => {
    const statusUrl = "https://x.com/FrotniteGuy/status/2065467842300944395?s=20";
    const fxVideoUrl = "https://video.twimg.com/amplify_video/2065467720074661889/vid/avc1/720x1280/QgEjUIGoD_gpNbNV.mp4?tag=14";
    const vxVideoUrl = "https://video.twimg.com/amplify_video/2065467720074661889/vid/avc1/720x1280/QgEjUIGoD_gpNbNV.mp4";
    const thumbnailUrl = "https://pbs.twimg.com/amplify_video_thumb/2065467720074661889/img/1GqcG-NFsBpzgbt5.jpg";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "me after day 2 of non stop pomni fortnite skin gooning",
            author: {
              name: "Jonesy",
              screen_name: "FrotniteGuy",
              avatar_url: "https://pbs.twimg.com/profile_images/example.jpg",
            },
            created_timestamp: 1781280882,
            media: {
              all: [{
                type: "video",
                url: fxVideoUrl,
                thumbnail_url: thumbnailUrl,
                width: 720,
                height: 1280,
                format: "video/mp4",
                variants: [{
                  url: fxVideoUrl,
                  bitrate: 2176000,
                  content_type: "video/mp4",
                }],
              }],
              videos: [{
                type: "video",
                url: fxVideoUrl,
                thumbnail_url: thumbnailUrl,
                width: 720,
                height: 1280,
                format: "video/mp4",
              }],
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://api.vxtwitter.com")) {
        return new Response(JSON.stringify({
          media_extended: [{
            type: "video",
            url: vxVideoUrl,
            size: { width: 720, height: 1280 },
            thumbnail_url: thumbnailUrl,
          }],
          mediaURLs: [vxVideoUrl],
          user_name: "Jonesy",
          user_screen_name: "FrotniteGuy",
          user_profile_image_url: "https://pbs.twimg.com/profile_images/example_normal.jpg",
          date_epoch: 1781280882,
          text: "me after day 2 of non stop pomni fortnite skin gooning",
          tweetURL: "https://twitter.com/FrotniteGuy/status/2065467842300944395",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds(statusUrl);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].media).toHaveLength(1);
    expect(embeds[0].media?.[0]).toMatchObject({
      type: "video",
      url: fxVideoUrl,
      thumbnailUrl,
      width: 720,
      height: 1280,
      contentType: "video/mp4",
    });
    expect(embeds[0].video?.url).toBe(fxVideoUrl);
  });

  it("preserves quoted tweet media inside X embeds", async () => {
    const quotedPhoto = "https://pbs.twimg.com/media/quoted-photo.jpg";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "look at this",
            author: {
              name: "Quoter",
              screen_name: "quoter",
            },
            quote: {
              id: "2057892777069883520",
              text: "original media",
              author: {
                name: "Original Author",
                screen_name: "original",
                avatar_url: "https://pbs.twimg.com/profile_images/original.jpg",
              },
              media_extended: [{
                type: "image",
                url: quotedPhoto,
                size: { width: 1600, height: 900 },
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

    const embeds = await extractAndProcessEmbeds("https://x.com/quoter/status/2057892777069883519");

    expect(embeds).toHaveLength(1);
    expect(embeds[0].referencedTweet?.type).toBe("quoted");
    expect(embeds[0].referencedTweet?.rawDescription).toBe("original media");
    expect(embeds[0].referencedTweet?.author?.name).toBe("Original Author (@original)");
    expect(embeds[0].referencedTweet?.media).toEqual([{
      type: "image",
      url: quotedPhoto,
      width: 1600,
      height: 900,
      thumbnailUrl: undefined,
      contentType: undefined,
    }]);
  });

  it("removes quoted tweet URLs from X body text while preserving quoted image galleries", async () => {
    const quotedUrl = "https://x.com/PolymarketMoney/status/2064174573487058989";
    const photoUrls = [
      "https://pbs.twimg.com/media/HKVrx9hWUAAqkhP.png?name=orig",
      "https://pbs.twimg.com/media/HKVrzmIXQAIqTKJ.png?name=orig",
    ];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: `12/31/1999\n${quotedUrl}`,
            author: {
              name: "Sam Lambert",
              screen_name: "samlambert",
            },
            quote: {
              url: quotedUrl,
              text: "JUST IN: Anthropic will reportedly release its new AI model Mythos tomorrow.",
              author: {
                name: "Polymarket Money",
                screen_name: "PolymarketMoney",
              },
              media: {
                photos: photoUrls.map((photoUrl) => ({
                  type: "photo",
                  url: photoUrl,
                })),
              },
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds("https://x.com/samlambert/status/2064194313677127730?s=20");

    expect(embeds).toHaveLength(1);
    expect(embeds[0].rawDescription).toBe("12/31/1999");
    expect(embeds[0].referencedTweet?.media?.map((item) => item.url)).toEqual(photoUrls);
  });

  it("preserves retweeted tweet media inside X embeds", async () => {
    const retweetedVideo = "https://video.twimg.com/ext_tw_video/example.mp4";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://api.fxtwitter.com")) {
        return new Response(JSON.stringify({
          code: 200,
          tweet: {
            text: "RT @original: original video",
            author: {
              name: "Retweeter",
              screen_name: "retweeter",
            },
            retweet: {
              id: "2057892777069883521",
              text: "original video",
              author: {
                name: "Original Author",
                screen_name: "original",
              },
              media: {
                videos: [{
                  url: retweetedVideo,
                  thumbnail_url: "https://pbs.twimg.com/ext_tw_video_thumb/example.jpg",
                  width: 1280,
                  height: 720,
                  format: "video/mp4",
                }],
              },
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    const embeds = await extractAndProcessEmbeds("https://x.com/retweeter/status/2057892777069883519");

    expect(embeds).toHaveLength(1);
    expect(embeds[0].referencedTweet?.type).toBe("retweeted");
    expect(embeds[0].referencedTweet?.media?.[0]).toMatchObject({
      type: "video",
      url: retweetedVideo,
      width: 1280,
      height: 720,
      thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/example.jpg",
      contentType: "video/mp4",
    });
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

  it("prefers refreshed TikTok proxy covers while storing stable player URLs", async () => {
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
    expect(embeds[0].video?.url).toBe("https://www.tiktok.com/player/v1/7617216826585468182");
    expect(embeds[0].video?.kind).toBe("player");
    expect(embeds[0].video?.contentType).toBeUndefined();
  });

  it("builds Instagram reel embeds from public oEmbed metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
        return Response.json({
          title: "craziest work",
          author_name: "chardanceswag",
          author_url: "https://www.instagram.com/chardanceswag",
          provider_name: "Instagram",
          provider_url: "https://www.instagram.com",
          thumbnail_url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
          thumbnail_width: 640,
          thumbnail_height: 1137,
        });
      }
      if (url.startsWith("https://meet.115jon.site/api/instagram-video?videoUrl=")) {
        return Response.json({
          videoUrl: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
          thumbnailUrl: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
          title: "craziest work",
          durationSeconds: 128.4,
        });
      }
      return new Response("not found", { status: 404 });
    }));

    const embeds = await extractAndProcessEmbeds("https://www.instagram.com/reel/DXU4PV2AGJU/");

    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({
      url: "https://www.instagram.com/reel/DXU4PV2AGJU/",
      type: "rich",
      rawTitle: "craziest work",
      author: {
        name: "chardanceswag",
        url: "https://www.instagram.com/chardanceswag",
      },
      provider: {
        name: "Instagram",
        url: "https://www.instagram.com",
      },
      thumbnail: {
        url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
        width: 640,
        height: 1137,
      },
      video: {
        url: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
        width: 720,
        height: 1280,
        kind: "direct",
        contentType: "video/mp4",
      },
      footer: {
        text: "Instagram",
      },
    });
  });
});
