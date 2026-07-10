import { afterEach, describe, expect, it, vi } from "vitest";
const hoisted = vi.hoisted(() => ({
  resolveInstagramVideoMetadataMock: vi.fn(),
}));

vi.mock("@/lib/instagram-video-resolver", () => ({
  resolveInstagramVideoMetadata: hoisted.resolveInstagramVideoMetadataMock,
}));

import { extractAndProcessEmbeds } from "../embed-fetcher";

const X_URL = "https://x.com/ausso52693/status/2057892777069883519";
const VIDEO_URL =
  "https://video.twimg.com/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT.mp4?tag=14";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.resolveInstagramVideoMetadataMock.mockReset();
});

describe("extractAndProcessEmbeds", () => {
  it("uses actual YouTube watch dimensions for portrait videos", async () => {
    const youtubeUrl = "https://youtu.be/oLb96nwOKDg?si=r0EuY4LzKVy4PziG";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://www.youtube.com/oembed")) {
          return new Response(
            JSON.stringify({
              title: "The Hunter Became the Hunted #DEADLOCK",
              author_name: "72hrs",
              author_url: "https://www.youtube.com/@72hrs",
              thumbnail_url: "https://i.ytimg.com/vi/oLb96nwOKDg/hqdefault.jpg",
              thumbnail_width: 480,
              thumbnail_height: 360,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
          return new Response(
            JSON.stringify({
              streamingData: {
                adaptiveFormats: [
                  { itag: 136, width: 720, height: 1280 },
                  { itag: 299, width: 1080, height: 1920 },
                ],
              },
              playabilityStatus: { status: "OK" },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url === "https://www.youtube.com/watch?v=oLb96nwOKDg&pbj=1") {
          return new Response(
            `
          )]}'
          {"playerResponse":{"streamingData":{"adaptiveFormats":[
            { "itag": 136, "width": 720, "height": 1280 },
            { "itag": 299, "width": 1080, "height": 1920 }
          ]}}}
        `,
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url === "https://www.youtube.com/watch?v=oLb96nwOKDg") {
          return new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(youtubeUrl);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider?.name).toBe("YouTube");
    expect(embeds[0].video?.width).toBe(1080);
    expect(embeds[0].video?.height).toBe(1920);
  });

  it("uses actual YouTube watch dimensions for standard videos", async () => {
    const youtubeUrl = "https://www.youtube.com/watch?v=abc123def45";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://www.youtube.com/oembed")) {
          return new Response(
            JSON.stringify({
              title: "Example horizontal video",
              author_name: "Example Creator",
              author_url: "https://www.youtube.com/@example",
              thumbnail_url: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg",
              thumbnail_width: 480,
              thumbnail_height: 360,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url.startsWith("https://www.youtube.com/youtubei/v1/player?key=")) {
          return new Response(
            JSON.stringify({
              streamingData: {
                formats: [
                  { itag: 22, width: 1280, height: 720 },
                  { itag: 18, width: 640, height: 360 },
                ],
              },
              playabilityStatus: { status: "OK" },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url === "https://www.youtube.com/watch?v=abc123def45&pbj=1") {
          return new Response(
            `
          )]}'
          {"playerResponse":{"streamingData":{"formats":[
            { "itag": 22, "width": 1280, "height": 720 },
            { "itag": 18, "width": 640, "height": 360 }
          ]}}}
        `,
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url === "https://www.youtube.com/watch?v=abc123def45") {
          return new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(youtubeUrl);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.width).toBe(1280);
    expect(embeds[0].video?.height).toBe(720);
  });

  it("preserves X video metadata as a direct video embed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "Example post",
                author: {
                  name: "Example Author",
                  screen_name: "ausso52693",
                  avatar_url:
                    "https://pbs.twimg.com/profile_images/example.jpg",
                },
                created_timestamp: 1779474846,
                media: {
                  videos: [
                    {
                      url: VIDEO_URL,
                      thumbnail_url:
                        "https://pbs.twimg.com/amplify_video_thumb/example.jpg",
                      duration: 8.4,
                      width: 640,
                      height: 702,
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].type).toBe("rich");
    expect(embeds[0].video?.url).toBe(VIDEO_URL);
    expect(embeds[0].video?.kind).toBe("direct");
    expect(embeds[0].video?.durationSeconds).toBe(8.4);
    expect(embeds[0].media?.[0]?.durationSeconds).toBe(8.4);
    expect(embeds[0].thumbnail?.url).toContain("pbs.twimg.com");
  });

  it("captures X engagement metrics when the API provides them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "Example post",
                replies: 30,
                reposts: 1800,
                likes: 34000,
                views: 380000,
                author: {
                  name: "Example Author",
                  screen_name: "ausso52693",
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].metrics).toEqual({
      replies: 30,
      retweets: 1800,
      likes: 34000,
      impressions: 380000,
    });
  });

  it("extracts X external cards and strips duplicate card URLs from the tweet body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "Cupcake has been hanging around with Rem lately, and wanted to Tag Along on the fight for the patreons! You can get your very own Cupcake in game now as the Cupcake Soul Bag is live!!\n\nhttps://gamebanana.com/mods/689999",
                raw_text: {
                  text: "Cupcake has been hanging around with Rem lately, and wanted to Tag Along on the fight for the patreons! You can get your very own Cupcake in game now as the Cupcake Soul Bag is live!!\n\nhttps://t.co/ZJM2uHkovj",
                  facets: [
                    {
                      type: "url",
                      original: "https://t.co/ZJM2uHkovj",
                      replacement: "https://gamebanana.com/mods/689999",
                      display: "gamebanana.com/mods/689999",
                    },
                  ],
                },
                author: {
                  name: "Melee Creeps",
                  screen_name: "MeleeCreepsDL",
                },
                media: {
                  photos: [
                    {
                      url: "https://pbs.twimg.com/media/example-card.jpg",
                      width: 1600,
                      height: 900,
                    },
                  ],
                },
                card: {
                  url: "https://gamebanana.com/mods/689999",
                  title: "MLC soul bag Mod for Deadlock | DL Mods",
                  description:
                    "MLC... A Deadlock (DL) Mod in the Soul Container category, submitted by Ahzealion",
                  domain: "gamebanana.com",
                  image: {
                    url: "https://pbs.twimg.com/card_img/example-card.jpg",
                    width: 800,
                    height: 419,
                  },
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].rawDescription).toBe(
      "Cupcake has been hanging around with Rem lately, and wanted to Tag Along on the fight for the patreons! You can get your very own Cupcake in game now as the Cupcake Soul Bag is live!!",
    );
    expect(embeds[0].externalCard).toEqual({
      url: "https://gamebanana.com/mods/689999",
      title: "MLC soul bag Mod for Deadlock | DL Mods",
      description:
        "MLC... A Deadlock (DL) Mod in the Soul Container category, submitted by Ahzealion",
      domain: "gamebanana.com",
      image: {
        url: "https://pbs.twimg.com/card_img/example-card.jpg",
        width: 800,
        height: 419,
      },
    });
  });

  it("preserves visible outbound links when X text includes media facets but no external card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "Going live tomorrow at 14:00 CET\n\nFirst stream back is going to be chill — talking a little, testing the setup, and playing League.\n\nI’m not asking anyone to forget the past. I just want to move forward the right way and prove change through actions.\n\nhttps://www.twitch.tv/rikohgg",
                raw_text: {
                  text: "Going live tomorrow at 14:00 CET\n\nFirst stream back is going to be chill — talking a little, testing the setup, and playing League.\n\nI’m not asking anyone to forget the past. I just want to move forward the right way and prove change through actions.\n\nhttps://t.co/uCyjSsz9ly https://t.co/ePe7Cvn3tU",
                  facets: [
                    {
                      type: "url",
                      original: "https://t.co/uCyjSsz9ly",
                      replacement: "https://www.twitch.tv/rikohgg",
                      display: "twitch.tv/rikohgg",
                    },
                    {
                      type: "media",
                      original: "https://t.co/ePe7Cvn3tU",
                      replacement:
                        "https://x.com/CookieLoLxx/status/2071956928524103905/photo/1",
                      display: "pic.x.com/ePe7Cvn3tU",
                    },
                  ],
                },
                author: {
                  name: "CookieLoLxx",
                  screen_name: "CookieLoLxx",
                },
                media: {
                  photos: [
                    {
                      url: "https://pbs.twimg.com/media/example-photo-1.jpg",
                      width: 1122,
                      height: 1402,
                    },
                    {
                      url: "https://pbs.twimg.com/media/example-photo-2.jpg",
                      width: 1122,
                      height: 1402,
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/CookieLoLxx/status/2071956928524103905?s=20",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0].rawDescription).toContain("https://www.twitch.tv/rikohgg");
    expect(embeds[0].rawDescription).not.toContain(
      "https://x.com/CookieLoLxx/status/2071956928524103905/photo/1",
    );
  });

  it("preserves X gif metadata as an autoplayable tweet video", async () => {
    const gifUrl = "https://video.twimg.com/tweet_video/HI9uM1OXgAIwHo-.mp4";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "is this shit from fortnite bro",
                author: {
                  name: "GIFs Shitpost",
                  screen_name: "GiFShitpost",
                  avatar_url:
                    "https://pbs.twimg.com/profile_images/example.gif",
                },
                media: {
                  videos: [
                    {
                      url: gifUrl,
                      thumbnail_url:
                        "https://pbs.twimg.com/tweet_video_thumb/HI9uM1OXgAIwHo-.jpg",
                      width: 800,
                      height: 782,
                      type: "gif",
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/GiFShitpost/status/2058251424576741420?s=20",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.url).toBe(gifUrl);
    expect(embeds[0].video?.kind).toBe("direct");
    expect(embeds[0].thumbnail?.url).toContain("tweet_video_thumb");
    expect(embeds[0].rawDescription).toBe("is this shit from fortnite bro");
  });

  it("uses FxTwitter v2 media for fxtwitter replacement GIF links", async () => {
    const statusId = "2065601187911553195";
    const gifUrl = "https://video.twimg.com/tweet_video/HKohayFWcAA3VCp.mp4";
    const thumbnailUrl =
      "https://pbs.twimg.com/tweet_video_thumb/HKohayFWcAA3VCp.jpg";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === `https://api.fxtwitter.com/2/status/${statusId}`) {
          return new Response(
            JSON.stringify({
              code: 200,
              status: {
                text: "gif post",
                author: {
                  name: "Felicia Hardy (Black Cat)",
                  screen_name: "ThiefBlackCats",
                  avatar_url:
                    "https://pbs.twimg.com/profile_images/example.jpg",
                },
                media: {
                  all: [
                    {
                      id: "2065500123107323904",
                      url: gifUrl,
                      thumbnail_url: thumbnailUrl,
                      duration_millis: 1968,
                      width: 806,
                      height: 806,
                      format: "video/mp4",
                      type: "gif",
                      formats: [
                        {
                          url: gifUrl,
                          bitrate: 0,
                          container: "mp4",
                          codec: "h264",
                        },
                      ],
                    },
                  ],
                  videos: [
                    {
                      id: "2065500123107323904",
                      url: gifUrl,
                      thumbnail_url: thumbnailUrl,
                      duration_millis: 1968,
                      width: 806,
                      height: 806,
                      format: "video/mp4",
                      type: "gif",
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      `https://fxtwitter.com/ThiefBlackCats/status/${statusId}`,
    );

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
      durationSeconds: 1.968,
    });
  });

  it("preserves all X photos for Discord-style media grids", async () => {
    const photoUrls = [
      "https://pbs.twimg.com/media/photo-1.jpg",
      "https://pbs.twimg.com/media/photo-2.jpg",
      "https://pbs.twimg.com/media/photo-3.jpg",
      "https://pbs.twimg.com/media/photo-4.jpg",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].media?.map((item) => item.url)).toEqual(photoUrls);
    expect(embeds[0].media?.every((item) => item.type === "image")).toBe(true);
    expect(embeds[0].thumbnail?.url).toBe(photoUrls[0]);
  });

  it("merges X gif alt text from vxtwitter while preserving fxtwitter media order", async () => {
    const imageUrl =
      "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg?name=orig";
    const gifUrl = "https://video.twimg.com/tweet_video/HKes4LvXkAADDvJ.mp4";
    const gifThumb =
      "https://pbs.twimg.com/tweet_video_thumb/HKes4LvXkAADDvJ.jpg";
    const gifAltText = "Yes Thanos GIF";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "",
                author: {
                  name: "Die Chance (5/5)",
                  screen_name: "DieChanc3",
                  avatar_url:
                    "https://pbs.twimg.com/profile_images/example.jpg",
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
                      variants: [
                        {
                          url: gifUrl,
                          bitrate: 0,
                          content_type: "video/mp4",
                        },
                      ],
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
                      variants: [
                        {
                          url: gifUrl,
                          bitrate: 0,
                          content_type: "video/mp4",
                        },
                      ],
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url.startsWith("https://api.vxtwitter.com")) {
          return new Response(
            JSON.stringify({
              media_extended: [
                {
                  type: "image",
                  url: "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg",
                  size: { width: 1557, height: 836 },
                  thumbnail_url:
                    "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg",
                },
                {
                  type: "gif",
                  url: gifUrl,
                  size: { width: 498, height: 270 },
                  thumbnail_url: gifThumb,
                  altText: gifAltText,
                },
              ],
              mediaURLs: [
                "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg",
                gifUrl,
              ],
              user_name: "Die Chance (5/5)",
              user_screen_name: "DieChanc3",
              user_profile_image_url:
                "https://pbs.twimg.com/profile_images/example_normal.jpg",
              date_epoch: 1781123813,
              text: "https://t.co/sGJAaEgcmZ",
              tweetURL:
                "https://twitter.com/DieChanc3/status/2064809045672783978",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/DieChanc3/status/2064809045672783978?s=20",
    );

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
    const statusUrl =
      "https://x.com/FrotniteGuy/status/2065467842300944395?s=20";
    const fxVideoUrl =
      "https://video.twimg.com/amplify_video/2065467720074661889/vid/avc1/720x1280/QgEjUIGoD_gpNbNV.mp4?tag=14";
    const vxVideoUrl =
      "https://video.twimg.com/amplify_video/2065467720074661889/vid/avc1/720x1280/QgEjUIGoD_gpNbNV.mp4";
    const thumbnailUrl =
      "https://pbs.twimg.com/amplify_video_thumb/2065467720074661889/img/1GqcG-NFsBpzgbt5.jpg";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
              code: 200,
              tweet: {
                text: "me after day 2 of non stop pomni fortnite skin gooning",
                author: {
                  name: "Jonesy",
                  screen_name: "FrotniteGuy",
                  avatar_url:
                    "https://pbs.twimg.com/profile_images/example.jpg",
                },
                created_timestamp: 1781280882,
                media: {
                  all: [
                    {
                      type: "video",
                      url: fxVideoUrl,
                      thumbnail_url: thumbnailUrl,
                      width: 720,
                      height: 1280,
                      format: "video/mp4",
                      variants: [
                        {
                          url: fxVideoUrl,
                          bitrate: 2176000,
                          content_type: "video/mp4",
                        },
                      ],
                    },
                  ],
                  videos: [
                    {
                      type: "video",
                      url: fxVideoUrl,
                      thumbnail_url: thumbnailUrl,
                      width: 720,
                      height: 1280,
                      format: "video/mp4",
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url.startsWith("https://api.vxtwitter.com")) {
          return new Response(
            JSON.stringify({
              media_extended: [
                {
                  type: "video",
                  url: vxVideoUrl,
                  size: { width: 720, height: 1280 },
                  thumbnail_url: thumbnailUrl,
                },
              ],
              mediaURLs: [vxVideoUrl],
              user_name: "Jonesy",
              user_screen_name: "FrotniteGuy",
              user_profile_image_url:
                "https://pbs.twimg.com/profile_images/example_normal.jpg",
              date_epoch: 1781280882,
              text: "me after day 2 of non stop pomni fortnite skin gooning",
              tweetURL:
                "https://twitter.com/FrotniteGuy/status/2065467842300944395",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

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

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
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
                    avatar_url:
                      "https://pbs.twimg.com/profile_images/original.jpg",
                  },
                  media_extended: [
                    {
                      type: "image",
                      url: quotedPhoto,
                      size: { width: 1600, height: 900 },
                    },
                  ],
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/quoter/status/2057892777069883519",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0].referencedTweet?.type).toBe("quoted");
    expect(embeds[0].referencedTweet?.rawDescription).toBe("original media");
    expect(embeds[0].referencedTweet?.author?.name).toBe(
      "Original Author (@original)",
    );
    expect(embeds[0].referencedTweet?.media).toEqual([
      {
        type: "image",
        url: quotedPhoto,
        width: 1600,
        height: 900,
        thumbnailUrl: undefined,
        contentType: undefined,
      },
    ]);
  });

  it("removes quoted tweet URLs from X body text while preserving quoted image galleries", async () => {
    const quotedUrl =
      "https://x.com/PolymarketMoney/status/2064174573487058989";
    const photoUrls = [
      "https://pbs.twimg.com/media/HKVrx9hWUAAqkhP.png?name=orig",
      "https://pbs.twimg.com/media/HKVrzmIXQAIqTKJ.png?name=orig",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/samlambert/status/2064194313677127730?s=20",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0].rawDescription).toBe("12/31/1999");
    expect(embeds[0].referencedTweet?.media?.map((item) => item.url)).toEqual(
      photoUrls,
    );
  });

  it("preserves retweeted tweet media inside X embeds", async () => {
    const retweetedVideo = "https://video.twimg.com/ext_tw_video/example.mp4";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.fxtwitter.com")) {
          return new Response(
            JSON.stringify({
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
                    videos: [
                      {
                        url: retweetedVideo,
                        thumbnail_url:
                          "https://pbs.twimg.com/ext_tw_video_thumb/example.jpg",
                        width: 1280,
                        height: 720,
                        format: "video/mp4",
                      },
                    ],
                  },
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(
      "https://x.com/retweeter/status/2057892777069883519",
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (
          url.startsWith("https://api.fxtwitter.com") ||
          url.startsWith("https://api.vxtwitter.com")
        ) {
          return new Response("not found", { status: 404 });
        }

        if (url.startsWith("https://vxtwitter.com")) {
          return new Response(
            `
          <meta property="og:title" content="Example (@ausso52693)" />
          <meta property="og:description" content="Example post" />
          <meta property="og:image" content="https://pbs.twimg.com/amplify_video_thumb/example.jpg" />
          <meta property="og:video" content="https://vxtwitter.com/tvid/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT" />
          <meta property="og:video:type" content="video/mp4" />
        `,
            {
              status: 200,
              headers: { "content-type": "text/html" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    );

    const embeds = await extractAndProcessEmbeds(X_URL);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].video?.url).toBe(
      "https://vxtwitter.com/tvid/amplify_video/2057892165804601344/vid/avc1/640x702/aNm7dAdvqq0JbrjT",
    );
  });

  it("prefers refreshed TikTok proxy covers while storing stable player URLs", async () => {
    const tikTokVideoUrl =
      "https://v16m.tiktokcdn-us.com/example/video/tos/no1a/tos-no1a-ve-0068-no/id/?mime_type=video_mp4";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Response.json({
            title: "official title",
            author_name: "Johnny",
            thumbnail_url:
              "https://p16-common-sign.tiktokcdn-us.com/stale.jpeg",
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
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.tiktok.com/@mrniceguyg/video/7617216826585468182",
    );

    expect(embeds[0].thumbnail?.url).toBe(
      "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
    );
    expect(embeds[0].video?.url).toBe(
      "https://www.tiktok.com/player/v1/7617216826585468182",
    );
    expect(embeds[0].video?.kind).toBe("player");
    expect(embeds[0].video?.contentType).toBeUndefined();
  });

  it("prefers the full-frame TikTok poster when refreshed proxy metadata provides one", async () => {
    const tikTokVideoUrl =
      "https://v16m.tiktokcdn-us.com/example/video/tos/no1a/tos-no1a-ve-0068-no/id/?mime_type=video_mp4";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Response.json({
            title: "official title",
            author_name: "dre2funtyyy",
            thumbnail_url:
              "https://p16-common-sign.tiktokcdn-us.com/oembed-fullframe.image",
            thumbnail_width: 720,
            thumbnail_height: 1280,
            html: '<blockquote data-video-id="7657740052608339214"></blockquote>',
          });
        }
        if (url.startsWith("https://www.tikwm.com/api/")) {
          return Response.json({
            code: 0,
            data: {
              id: "7657740052608339214",
              title: "fresh title",
              cover:
                "https://p19-common-sign.tiktokcdn-us.com/cropped-center.jpeg",
              origin_cover:
                "https://p16-common-sign.tiktokcdn-us.com/full-frame-cover.webp",
              ai_dynamic_cover:
                "https://p19-common-sign.tiktokcdn-us.com/dynamic-cover.webp",
              play: tikTokVideoUrl,
              duration: 12,
              author: { nickname: "dre2funtyyy", unique_id: "dre2funtyyy" },
            },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.tiktok.com/@dre2funtyyy/video/7657740052608339214",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0].thumbnail).toEqual({
      url: "https://p16-common-sign.tiktokcdn-us.com/full-frame-cover.webp",
      width: 720,
      height: 1280,
    });
    expect(embeds[0].media?.[0]).toMatchObject({
      type: "video",
      thumbnailUrl:
        "https://p16-common-sign.tiktokcdn-us.com/full-frame-cover.webp",
    });
  });

  it("builds TikTok slideshow embeds from photo-mode metadata even when oEmbed fails", async () => {
    const tikTokAudioUrl =
      "https://v16-ies-music.tiktokcdn-us.com/example/audio-track/?mime_type=audio_mpeg";
    const tikTokCoverUrl =
      "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp";
    const tikTokAvatarUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/avatar.jpeg";
    const tikTokArtworkUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/music-cover.jpeg";
    const tikTokImageUrls = [
      "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
      "https://p16-common-sign.tiktokcdn-us.com/example/photo-2.jpeg",
      "https://p19-common-sign.tiktokcdn-us.com/example/photo-3.jpeg",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Response.json(
            {
              message: "Something went wrong",
              code: 400,
            },
            { status: 400 },
          );
        }
        if (url.startsWith("https://www.tikwm.com/api/")) {
          return Response.json({
            code: 0,
            data: {
              id: "7649484991986027806",
              title: "",
              content_desc: [],
              cover: tikTokCoverUrl,
              origin_cover: tikTokCoverUrl,
              ai_dynamic_cover: tikTokCoverUrl,
              duration: 0,
              play: tikTokAudioUrl,
              wmplay: tikTokAudioUrl,
              music: tikTokAudioUrl,
              music_info: {
                title: "original sound - realtonyay",
                author: "Tonya",
                play: tikTokAudioUrl,
                cover: tikTokArtworkUrl,
              },
              play_count: 12416,
              digg_count: 2311,
              comment_count: 19,
              share_count: 210,
              create_time: 1781034537,
              author: {
                unique_id: "feetlattee",
                nickname: "natalia",
                avatar: tikTokAvatarUrl,
              },
              images: tikTokImageUrls,
            },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.tiktok.com/t/ZTSBAR6M7/",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({
      url: "https://www.tiktok.com/t/ZTSBAR6M7/",
      type: "rich",
      provider: {
        name: "TikTok",
        url: "https://www.tiktok.com",
      },
      author: {
        name: "natalia",
        url: "https://www.tiktok.com/@feetlattee",
        iconURL: tikTokAvatarUrl,
      },
      thumbnail: {
        url: tikTokCoverUrl,
      },
      audio: {
        title: "original sound - realtonyay",
        artist: "Tonya",
        url: tikTokAudioUrl,
        artworkUrl: tikTokArtworkUrl,
      },
      metrics: {
        likes: 2311,
        comments: 19,
        views: 12416,
      },
      footer: {
        text: "TikTok",
      },
    });
    expect(embeds[0].video).toBeUndefined();
    expect(embeds[0].media?.map((item) => item.url)).toEqual(tikTokImageUrls);
    expect(embeds[0].media?.every((item) => item.type === "image")).toBe(true);
  });

  it("builds TikTok live-photo slideshows as video media with still-image thumbnails", async () => {
    const tikTokAudioUrl =
      "https://v16-ies-music.tiktokcdn-us.com/example/audio-track/?mime_type=audio_mpeg";
    const tikTokAvatarUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/avatar.jpeg";
    const tikTokArtworkUrl =
      "https://p19-common-sign.tiktokcdn-us.com/example/music-cover.jpeg";
    const tikTokHeicCoverUrl =
      "https://p16-common-sign.tiktokcdn-us.com/example/live-cover.heic";
    const tikTokImageUrls = [
      "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
      "https://p16-common-sign.tiktokcdn-us.com/example/photo-2.jpeg",
    ];
    const tikTokLiveImageUrls = [
      "https://v16m.tiktokcdn-us.com/example/live-photo-1.mp4?mime_type=video_mp4",
      "https://v16m.tiktokcdn-us.com/example/live-photo-2.mp4?mime_type=video_mp4",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.tiktok.com/oembed")) {
          return Response.json(
            {
              message: "Something went wrong",
              code: 400,
            },
            { status: 400 },
          );
        }
        if (url.startsWith("https://www.tikwm.com/api/")) {
          return Response.json({
            code: 0,
            data: {
              id: "7654964663997730066",
              title: "",
              content_desc: [],
              cover: tikTokHeicCoverUrl,
              origin_cover: tikTokHeicCoverUrl,
              ai_dynamic_cover: tikTokHeicCoverUrl,
              duration: 0,
              play: tikTokAudioUrl,
              wmplay: tikTokAudioUrl,
              music: tikTokAudioUrl,
              music_info: {
                title: "original sound - usahieudang199515",
                author: "Pets.VN",
                play: tikTokAudioUrl,
                cover: tikTokArtworkUrl,
              },
              play_count: 5660359,
              digg_count: 1304699,
              comment_count: 3315,
              share_count: 947286,
              create_time: 1782310354,
              author: {
                unique_id: "nt_hani",
                nickname: "hani",
                avatar: tikTokAvatarUrl,
              },
              images: tikTokImageUrls,
              live_images: tikTokLiveImageUrls,
            },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.tiktok.com/t/ZTSH56wLh/",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({
      url: "https://www.tiktok.com/t/ZTSH56wLh/",
      type: "rich",
      provider: {
        name: "TikTok",
        url: "https://www.tiktok.com",
      },
      author: {
        name: "hani",
        url: "https://www.tiktok.com/@nt_hani",
        iconURL: tikTokAvatarUrl,
      },
      thumbnail: {
        url: tikTokImageUrls[0],
      },
      audio: {
        title: "original sound - usahieudang199515",
        artist: "Pets.VN",
        url: tikTokAudioUrl,
        artworkUrl: tikTokArtworkUrl,
      },
      metrics: {
        likes: 1304699,
        comments: 3315,
        views: 5660359,
      },
    });
    expect(embeds[0].video).toBeUndefined();
    expect(embeds[0].media).toEqual([
      {
        type: "video",
        url: tikTokLiveImageUrls[0],
        thumbnailUrl: tikTokImageUrls[0],
        contentType: "video/mp4",
      },
      {
        type: "video",
        url: tikTokLiveImageUrls[1],
        thumbnailUrl: tikTokImageUrls[1],
        contentType: "video/mp4",
      },
    ]);
  });

  it("builds Instagram reel embeds from public oEmbed metadata", async () => {
    hoisted.resolveInstagramVideoMetadataMock.mockResolvedValue({
      videoUrl: "https://scontent-ord5-1.cdninstagram.com/video.mp4?sig=1",
      thumbnailUrl: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
      title: "craziest work",
      durationSeconds: 128.4,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
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
        return new Response("not found", { status: 404 });
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.instagram.com/reel/DXU4PV2AGJU/",
    );

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

  it("builds Instagram post embeds when oEmbed is unavailable but resolver metadata exists", async () => {
    hoisted.resolveInstagramVideoMetadataMock.mockResolvedValue({
      videoUrl: null,
      thumbnailUrl:
        "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
      title: "rukia!",
      durationSeconds: null,
      media: [
        {
          type: "image",
          url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
          width: 2728,
          height: 1817,
        },
        {
          type: "image",
          url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925",
          width: 2727,
          height: 1816,
        },
      ],
      authorName: "tasyiu",
      authorUrl: "https://www.instagram.com/tasyiu",
      authorAvatarUrl:
        "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
      authorVerified: true,
      likeCount: 1073,
      commentCount: 15,
      viewCount: null,
      timestamp: "2026-06-24T03:40:02.000Z",
      audio: {
        title: "My Destiny (2026 Edit)",
        artist: "Delinquent, KCAT, Mike Delinquent Project",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.startsWith("https://www.instagram.com/api/v1/oembed/")) {
          return new Response("not found", { status: 404 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const embeds = await extractAndProcessEmbeds(
      "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
    );

    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({
      url: "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
      type: "rich",
      rawTitle: "rukia!",
      provider: {
        name: "Instagram",
        url: "https://www.instagram.com",
      },
      author: {
        name: "tasyiu",
        url: "https://www.instagram.com/tasyiu",
        iconURL:
          "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
        isVerified: true,
      },
      thumbnail: {
        url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
        width: 2728,
        height: 1817,
      },
      media: [
        {
          type: "image",
          url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
          width: 2728,
          height: 1817,
        },
        {
          type: "image",
          url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925",
          width: 2727,
          height: 1816,
        },
      ],
      metrics: {
        likes: 1073,
        comments: 15,
      },
      footer: {
        text: "Instagram",
      },
    });
  });
});
