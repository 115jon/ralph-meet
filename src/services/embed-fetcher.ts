import type { EmbedInfo } from "@/lib/types";
import { fetchInstagramOEmbedMetadata, fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
import { clog } from "@/lib/console-logger";

const log = clog("EmbedFetcher");
const twitterLog = clog("embed:twitter");

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const X_ICON_URL = "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png";
const X_EMBED_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "d.fxtwitter.com",
  "fixupx.com",
  "d.fixupx.com",
  "vxtwitter.com",
  "d.vxtwitter.com",
  "fixvx.com",
  "d.fixvx.com",
]);

let embedCounter = 0;
function nextEmbedId(): string {
  return `embed_${++embedCounter}`;
}

export async function extractAndProcessEmbeds(content: string): Promise<EmbedInfo[]> {
  const matches = content.match(URL_REGEX);
  if (!matches || matches.length === 0) return [];

  // Limit to 3 embeds max per message to prevent abuse
  const urls = [...new Set(matches)].slice(0, 3);

  const embedPromises = urls.map(url => fetchEmbedMetadata(url));
  const results = await Promise.allSettled(embedPromises);

  const embeds: EmbedInfo[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      embeds.push(result.value);
    }
  }

  return embeds;
}

async function fetchEmbedMetadata(url: string): Promise<EmbedInfo | null> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  try {
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return await fetchYouTubeData(url);
    }

    if (isXPostHostname(hostname)) {
      return await fetchTwitterData(url);
    }

    if (hostname.includes("instagram.com")) {
      return await fetchInstagramData(url);
    }

    if (hostname.includes("tiktok.com")) {
      return await fetchTikTokDataRefreshed(url);
    }

    if (hostname.includes("spotify.com") || hostname.includes("open.spotify.com")) {
      return await fetchSpotifyData(url);
    }

    // Default OpenGraph fallback
    return await fetchOpenGraphData(url);
  } catch (err) {
    log.error(`Failed to fetch metadata for ${url}:`, err);
    return null; // Silent fail, just don't embed
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isXPostHostname(hostname: string): boolean {
  return X_EMBED_HOSTS.has(normalizeHostname(hostname));
}

function extractTweetStatusId(parsed: URL): string | null {
  return parsed.pathname.match(/\/status(?:es)?\/(\d{2,20})(?:\.(?:mp4|jpe?g|png|webp))?(?:\/|$)/i)?.[1] ?? null;
}

function normalizeTwitterStatusPath(pathname: string): string {
  return pathname.replace(/\.(?:mp4|jpe?g|png|webp)$/i, "");
}

function buildTwitterApiUrls(parsed: URL): string[] {
  const statusId = extractTweetStatusId(parsed);
  const statusPath = normalizeTwitterStatusPath(parsed.pathname);
  return [
    statusId ? `https://api.fxtwitter.com/2/status/${statusId}` : null,
    `https://api.fxtwitter.com${statusPath}`,
    `https://api.vxtwitter.com${statusPath}`,
  ].filter((url, index, urls): url is string => !!url && urls.indexOf(url) === index);
}

function extractTweetScreenName(parsed: URL): string {
  const screenName = normalizeTwitterStatusPath(parsed.pathname).split("/").filter(Boolean)[0];
  return screenName && screenName !== "i" ? screenName : "x";
}

// ── Provider Fetchers ─────────────────────────────────────────────────────────

async function fetchYouTubeData(url: string): Promise<EmbedInfo | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) return null;

  const data = await res.json() as any;
  const videoIdMatch =
    url.match(/[?&]v=([^&]+)/) ||
    url.match(/youtu\.be\/([^?]+)/) ||
    url.match(/youtube\.com\/shorts\/([^?&/]+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;

  if (!videoId) return null;

  const isShort = /youtube\.com\/shorts\//i.test(url);
  const videoDimensions = await fetchYouTubeVideoDimensions(videoId, url);
  const fallbackDimensions = isShort ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  const resolvedDimensions = videoDimensions ?? fallbackDimensions;

  return {
    id: nextEmbedId(),
    url,
    type: "video",
    rawTitle: data.title,
    author: {
      name: data.author_name,
      url: data.author_url,
    },
    provider: {
      name: "YouTube",
      url: "https://www.youtube.com",
    },
    color: "#FF0000",
    thumbnail: {
      url: data.thumbnail_url,
      width: data.thumbnail_width ?? 480,
      height: data.thumbnail_height ?? 360,
    },
    video: {
      url: `https://www.youtube.com/embed/${videoId}`,
      width: resolvedDimensions.width,
      height: resolvedDimensions.height,
      kind: "player",
    },
    fields: [],
  };
}

async function fetchYouTubeVideoDimensions(videoId: string, sourceUrl: string): Promise<{ width: number; height: number } | null> {
  try {
    const innertubeDimensions = await fetchYouTubeInnertubeDimensions(videoId);
    if (innertubeDimensions) {
      return innertubeDimensions;
    }

    const watchUrl = buildYouTubeWatchUrl(videoId, sourceUrl);
    const res = await fetch(`${watchUrl}&pbj=1`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
        "x-youtube-client-name": "1",
        "x-youtube-client-version": "2.20260611.01.00",
      },
    });
    if (res.ok) {
      const playerResponse = extractYouTubePbjPlayerResponse(await res.text());
      const dimensions = extractLargestYouTubeFormatDimensions(playerResponse);
      if (dimensions) return dimensions;
    }

    const htmlRes = await fetch(watchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
      },
    });
    if (!htmlRes.ok) return null;

    const playerResponse = extractYouTubePlayerResponse(await htmlRes.text());
    return extractLargestYouTubeFormatDimensions(playerResponse);
  } catch {
    return null;
  }
}

async function fetchYouTubeInnertubeDimensions(videoId: string): Promise<{ width: number; height: number } | null> {
  const clients = [
    {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    },
    {
      clientName: "IOS",
      clientVersion: "20.10.4",
      userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_0 like Mac OS X)",
    },
  ] as const;

  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              hl: "en",
              gl: "US",
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) {
        continue;
      }

      const playerResponse = await res.json() as any;
      const dimensions = extractLargestYouTubeFormatDimensions(playerResponse);
      if (dimensions) {
        return dimensions;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildYouTubeWatchUrl(videoId: string, sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const isShort = parsed.hostname.toLowerCase().includes("youtube.com") && parsed.pathname.startsWith("/shorts/");
    return isShort
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
}

function extractYouTubePlayerResponse(html: string): any | null {
  const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractYouTubePbjPlayerResponse(rawBody: string): any | null {
  const sanitizedBody = rawBody.replace(/^\s*\)\]\}'\s*/, "").trim();

  try {
    const parsed = JSON.parse(sanitizedBody);
    if (parsed?.playerResponse) {
      return parsed.playerResponse;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item?.playerResponse) {
          return item.playerResponse;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function extractLargestYouTubeFormatDimensions(playerResponse: any): { width: number; height: number } | null {
  if (!playerResponse) return null;

  const formats = [
    ...(playerResponse.streamingData?.formats || []),
    ...(playerResponse.streamingData?.adaptiveFormats || []),
  ];

  let bestDimensions: { width: number; height: number; pixels: number } | null = null;
  for (const format of formats) {
    const width = Number(format?.width);
    const height = Number(format?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      continue;
    }

    const pixels = width * height;
    if (!bestDimensions || pixels > bestDimensions.pixels) {
      bestDimensions = { width, height, pixels };
    }
  }

  if (!bestDimensions) return null;
  return { width: bestDimensions.width, height: bestDimensions.height };
}

async function fetchTwitterData(url: string): Promise<EmbedInfo | null> {
  const parsed = new URL(url);
  let fallbackTweet: any | null = null;

  // APIs that return JSON — documented FxTwitter v2 first, legacy + Vx fallbacks.
  const apis = buildTwitterApiUrls(parsed);

  for (const apiUrl of apis) {
    try {
      twitterLog.info(`Trying API: ${apiUrl}`);
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'RalphMeet/1.0 (+https://ralph.dev)' },
      });
      twitterLog.info(`API response status: ${res.status}, content-type: ${res.headers.get('content-type')}`);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        twitterLog.info(`API ${res.status} body (first 200): ${errBody.substring(0, 200)}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        twitterLog.info(`API returned non-JSON content-type: ${contentType}`);
        continue;
      }

      const data = await res.json() as any;
      // v2 returns { status }, legacy fxtwitter returns { tweet }, vxtwitter returns a bare object.
      const tweet = data.status || data.tweet || data;

      if (tweet) {
        fallbackTweet = mergeTweetMetadata(fallbackTweet, tweet);
      }
    } catch (e) {
      twitterLog.error(`API ${apiUrl} failed:`, e);
    }
  }

  if (fallbackTweet) {
    return buildTwitterEmbed(fallbackTweet, url, extractTweetScreenName(parsed));
  }

  // Fallback: scrape OG tags from vxtwitter.com
  try {
    const vxUrl = `https://vxtwitter.com${normalizeTwitterStatusPath(parsed.pathname)}`;
    twitterLog.info(`Fallback: scraping vxtwitter OG: ${vxUrl}`);
    const res = await fetch(vxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
      }
    });

    if (res.ok) {
      const html = await res.text();
      twitterLog.info(`OG fallback HTML length: ${html.length}`);

      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
      const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const videoMatch = html.match(/<meta property="og:video(?::url)?" content="([^"]+)"/i);
      const videoTypeMatch = html.match(/<meta property="og:video:type" content="([^"]+)"/i);

      twitterLog.info(`OG: title=${!!titleMatch} desc=${!!descMatch} img=${!!imgMatch} video=${!!videoMatch}`);

      if (titleMatch || descMatch) {
        // vxtwitter OG titles are typically "Name (@handle)" or just "Name"
        const authorParse = titleMatch?.[1]?.match(/^(.+?)\s*\((@\w+)\)/);
        // Extract screen name from URL path as fallback
        const pathScreenName = parsed.pathname.split("/")[1];

        let authorObj: { name: string; url: string };
        if (authorParse) {
          authorObj = {
            name: `${authorParse[1].trim()} (${authorParse[2]})`,
            url: `https://twitter.com/${authorParse[2].replace("@", "")}`,
          };
        } else {
          // Use path screen name to construct a reasonable author
          authorObj = {
            name: `${pathScreenName} (@${pathScreenName})`,
            url: `https://twitter.com/${pathScreenName}`,
          };
        }

        const embed: EmbedInfo = {
          id: nextEmbedId(),
          url,
          type: "rich",
          rawDescription: descMatch?.[1],
          author: authorObj,
          provider: {
            name: "X",
            url: "https://x.com",
          },
          footer: {
            text: "X",
            iconURL: "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png",
          },
          color: "#1D9BF0",
          fields: [],
        };

        if (imgMatch?.[1]) {
          embed.thumbnail = {
            url: imgMatch[1],
            width: 1280,
            height: 720,
          };
        }

        // If OG has a video tag, add it
        if (videoMatch?.[1] || imgMatch?.[1]) {
          // vxtwitter OG video tags point to direct mp4 or embed URLs
          const hasVideo = videoMatch?.[1] && videoTypeMatch?.[1]?.includes("text/html");
          if (hasVideo) {
            embed.video = {
              url: videoMatch![1],
              width: 1280,
              height: 720,
              kind: "player",
            };
          } else if (videoMatch?.[1]) {
            // Direct mp4 video from OG metadata.
            embed.video = {
              url: videoMatch[1],
              width: 1280,
              height: 720,
              kind: "direct",
              contentType: videoTypeMatch?.[1] || "video/mp4",
            };
          }
        }

        return embed;
      }
    }
  } catch (e) {
    twitterLog.error("OG fallback failed:", e);
  }

  return null;
}

function extractTweetMedia(tweet: any): NonNullable<EmbedInfo["media"]> {
  const media: NonNullable<EmbedInfo["media"]> = [];
  const seen = new Map<string, number>();

  const add = (item: any, fallbackType?: "image" | "video") => {
    const normalizedType = normalizeTweetMediaType(item?.type) || fallbackType;
    const url = item?.url || item?.media_url_https || item?.media_url || item?.src;
    if (!normalizedType || !url) return;

    const rawType = typeof item?.type === "string" ? item.type.toLowerCase() : undefined;
    const thumbnailUrl = item?.thumbnail_url || item?.thumb || item?.preview_image_url;
    const contentType = item?.format || item?.content_type || item?.variants?.[0]?.content_type;
    const dedupeKey = getTweetMediaDedupKey(url);
    const existingIndex = seen.get(dedupeKey);
    const width = item?.width || item?.size?.width || item?.sizes?.large?.w;
    const height = item?.height || item?.size?.height || item?.sizes?.large?.h;
    const altText = item?.altText || item?.alt_text;

    if (existingIndex !== undefined) {
      const existing = media[existingIndex];
      media[existingIndex] = {
        ...existing,
        width: existing.width ?? width,
        height: existing.height ?? height,
        thumbnailUrl: existing.thumbnailUrl ?? (normalizedType === "video" ? thumbnailUrl : undefined),
        contentType: existing.contentType ?? (normalizedType === "video" ? contentType : undefined),
        isGif: existing.isGif ?? (rawType === "animated_gif" || rawType === "gif" ? true : undefined),
        altText: existing.altText ?? altText,
      };
      return;
    }

    seen.set(dedupeKey, media.length);
    media.push({
      type: normalizedType,
      url,
      width,
      height,
      thumbnailUrl: normalizedType === "video" ? thumbnailUrl : undefined,
      contentType: normalizedType === "video" ? contentType : undefined,
      isGif: rawType === "animated_gif" || rawType === "gif" ? true : undefined,
      altText,
    });
  };

  for (const item of tweet.media?.all || []) add(item);
  for (const item of tweet.media_extended || []) add(item);
  for (const item of tweet.media?.photos || []) add(item, "image");
  for (const item of tweet.media?.videos || []) add(item, "video");
  for (const item of tweet.mediaURLs || []) add({ url: item, type: "image" });

  return media;
}

function getTweetMediaDedupKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === "video.twimg.com") {
      return `${hostname}${pathname}`;
    }

    if (hostname === "pbs.twimg.com" && (
      pathname.startsWith("/media/") ||
      pathname.startsWith("/tweet_video_thumb/") ||
      pathname.startsWith("/ext_tw_video_thumb/") ||
      pathname.startsWith("/amplify_video_thumb/")
    )) {
      return `${hostname}${pathname}`;
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function buildTwitterEmbed(tweet: any, url: string, fallbackScreenName: string): EmbedInfo | null {
  const media = extractTweetMedia(tweet);
  const rawDescription = extractTweetText(tweet);
  if (media.length === 0 && !rawDescription) {
    return null;
  }

  const firstVideo = media.find((item) => item.type === "video");
  const firstMedia = media[0];
  const author = extractTweetAuthor(tweet, fallbackScreenName);
  const timestamp = extractTweetTimestamp(tweet);

  const embed: EmbedInfo = {
    id: nextEmbedId(),
    url,
    type: "rich",
    rawDescription,
    author: {
      name: `${author.name} (@${author.screenName})`,
      url: `https://twitter.com/${author.screenName}`,
      iconURL: author.avatar,
    },
    provider: {
      name: "X",
      url: "https://x.com",
    },
    footer: {
      text: "X",
      iconURL: X_ICON_URL,
    },
    color: "#1D9BF0",
    timestamp,
    fields: [],
  };

  if (media.length > 0) {
    embed.media = media;
  }

  if (firstMedia) {
    embed.thumbnail = {
      url: firstMedia.thumbnailUrl || firstMedia.url,
      width: firstMedia.width || 1280,
      height: firstMedia.height || 720,
    };
  }

  if (firstVideo) {
    embed.video = {
      url: firstVideo.url,
      width: firstVideo.width || 1280,
      height: firstVideo.height || 720,
      kind: "direct",
      contentType: firstVideo.contentType || "video/mp4",
    };
  }

  const referencedTweet = extractReferencedTweet(tweet, url);
  if (referencedTweet) {
    embed.referencedTweet = referencedTweet;
  }

  return embed;
}

function mergeTweetMetadata(baseTweet: any, incomingTweet: any): any {
  if (!baseTweet) return incomingTweet;
  if (!incomingTweet) return baseTweet;

  const mergedTweet = {
    ...baseTweet,
    ...incomingTweet,
    text: baseTweet.text ?? incomingTweet.text,
    full_text: baseTweet.full_text ?? incomingTweet.full_text,
    description: baseTweet.description ?? incomingTweet.description,
    raw_text: baseTweet.raw_text ?? incomingTweet.raw_text,
    author: {
      ...(baseTweet.author || {}),
      ...(incomingTweet.author || {}),
    },
    media: mergeTweetMedia(baseTweet.media, incomingTweet.media),
    media_extended: mergeTweetMediaLists(baseTweet.media_extended, incomingTweet.media_extended),
    quote: mergeReferencedTweet(baseTweet.quote, incomingTweet.quote),
    quoted_tweet: mergeReferencedTweet(baseTweet.quoted_tweet, incomingTweet.quoted_tweet),
    quotedTweet: mergeReferencedTweet(baseTweet.quotedTweet, incomingTweet.quotedTweet),
    qrt: mergeReferencedTweet(baseTweet.qrt, incomingTweet.qrt),
    retweet: mergeReferencedTweet(baseTweet.retweet, incomingTweet.retweet),
    retweeted_tweet: mergeReferencedTweet(baseTweet.retweeted_tweet, incomingTweet.retweeted_tweet),
    retweetedTweet: mergeReferencedTweet(baseTweet.retweetedTweet, incomingTweet.retweetedTweet),
    original_tweet: mergeReferencedTweet(baseTweet.original_tweet, incomingTweet.original_tweet),
  };

  return mergedTweet;
}

function mergeReferencedTweet(baseTweet: any, incomingTweet: any): any {
  if (!baseTweet) return incomingTweet;
  if (!incomingTweet) return baseTweet;
  return mergeTweetMetadata(baseTweet, incomingTweet);
}

function mergeTweetMedia(baseMedia: any, incomingMedia: any): any {
  if (!baseMedia) return incomingMedia;
  if (!incomingMedia) return baseMedia;

  const mergedMedia = {
    ...baseMedia,
    ...incomingMedia,
  };

  for (const key of ["all", "photos", "videos"]) {
    if (baseMedia[key] || incomingMedia[key]) {
      mergedMedia[key] = mergeTweetMediaLists(baseMedia[key], incomingMedia[key]);
    }
  }

  return mergedMedia;
}

function mergeTweetMediaLists(baseList: any[] | undefined, incomingList: any[] | undefined): any[] | undefined {
  if (!baseList?.length) return incomingList;
  if (!incomingList?.length) return baseList;

  const merged = new Map<string, any>();

  const getKey = (item: any, index: number) => {
    const rawUrl = item?.url || item?.media_url_https || item?.media_url;
    return String(item?.id || item?.id_str || (rawUrl ? getTweetMediaDedupKey(rawUrl) : index));
  };

  for (const [index, item] of baseList.entries()) {
    merged.set(getKey(item, index), item);
  }

  for (const [index, item] of incomingList.entries()) {
    const key = getKey(item, index);
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  }

  return Array.from(merged.values());
}

function normalizeTweetMediaType(type?: string): "image" | "video" | null {
  if (!type) return null;
  const normalized = type.toLowerCase();
  if (normalized === "photo" || normalized === "image") return "image";
  if (normalized === "video" || normalized === "animated_gif" || normalized === "gif") return "video";
  return null;
}

function extractTweetAuthor(tweet: any, fallbackScreenName = "x"): { name: string; screenName: string; avatar?: string } {
  const screenName = tweet.author?.screen_name || tweet.user_screen_name || tweet.user?.screen_name || fallbackScreenName;

  return {
    name: tweet.author?.name || tweet.user_name || tweet.user?.name || "X User",
    screenName,
    avatar:
      tweet.author?.avatar_url ||
      tweet.user_profile_image_url ||
      tweet.author?.profile_image_url ||
      tweet.user?.profile_image_url,
  };
}

function extractTweetTimestamp(tweet: any): string | undefined {
  if (tweet.created_timestamp) return new Date(tweet.created_timestamp * 1000).toISOString();
  if (tweet.date_epoch) return new Date(tweet.date_epoch * 1000).toISOString();
  if (tweet.created_at) {
    const parsed = new Date(tweet.created_at);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  return undefined;
}

function extractReferencedTweet(tweet: any, sourceUrl: string): EmbedInfo["referencedTweet"] | undefined {
  const quotedTweet = tweet.quote || tweet.quoted_tweet || tweet.quotedTweet || tweet.qrt;
  const retweetedTweet = tweet.retweet || tweet.retweeted_tweet || tweet.retweetedTweet || tweet.original_tweet;
  const referencedTweet = quotedTweet || retweetedTweet;
  if (!referencedTweet) return undefined;

  const media = extractTweetMedia(referencedTweet);
  const author = extractTweetAuthor(referencedTweet);
  const referencedUrl = referencedTweet.url || referencedTweet.tweet_url || referencedTweet.link || buildReferencedTweetUrl(author.screenName, referencedTweet.id);

  return {
    type: quotedTweet ? "quoted" : "retweeted",
    url: referencedUrl || sourceUrl,
    rawDescription: extractTweetText(referencedTweet),
    author: {
      name: `${author.name} (@${author.screenName})`,
      url: `https://twitter.com/${author.screenName}`,
      iconURL: author.avatar,
    },
    media: media.length > 0 ? media : undefined,
    timestamp: extractTweetTimestamp(referencedTweet),
  };
}

function buildReferencedTweetUrl(screenName?: string, id?: string | number): string | undefined {
  if (!screenName || !id) return undefined;
  return `https://twitter.com/${screenName}/status/${id}`;
}

function extractTweetText(tweet: any): string | undefined {
  const text = tweet.text || tweet.full_text || tweet.description;
  if (!text) return undefined;

  const referencedUrls = [
    tweet.quote?.url,
    tweet.quoted_tweet?.url,
    tweet.quotedTweet?.url,
    tweet.qrt?.url,
  ].filter(Boolean);

  if (referencedUrls.length === 0) return text;

  const filteredLines = text
    .split("\n")
    .filter((line: string) => !referencedUrls.some((url: string) => line.trim() === url));

  return filteredLines.join("\n").trim() || undefined;
}

async function fetchInstagramData(url: string): Promise<EmbedInfo | null> {
  const data = await fetchInstagramOEmbedMetadata(url);
  if (!data) return null;

  return {
    id: nextEmbedId(),
    url,
    type: "rich",
    rawTitle: data.title,
    author: data.authorName ? {
      name: data.authorName,
      url: data.authorUrl,
    } : undefined,
    provider: {
      name: data.providerName || "Instagram",
      url: data.providerUrl || "https://www.instagram.com",
    },
    color: "#E1306C",
    thumbnail: data.thumbnailUrl ? {
      url: data.thumbnailUrl,
      width: data.thumbnailWidth,
      height: data.thumbnailHeight,
    } : undefined,
    footer: {
      text: "Instagram",
    },
    fields: [],
  };
}

async function fetchTikTokDataRefreshed(url: string): Promise<EmbedInfo | null> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const [oembedResult, proxyResult] = await Promise.allSettled([
    fetch(oembedUrl),
    fetchTikTokProxyMetadata(url),
  ]);

  const res = oembedResult.status === "fulfilled" ? oembedResult.value : null;
  const proxyData = proxyResult.status === "fulfilled" ? proxyResult.value : null;
  if (!res?.ok && !proxyData) return null;

  const data = res?.ok ? await res.json() as any : {};
  const videoIdMatch = data.html?.match(/data-video-id="([^"]+)"/) || url.match(/video\/(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;
  if (!videoId) return null;

  return {
    id: nextEmbedId(),
    url,
    type: "video",
    rawTitle: `TikTok - ${data.author_name || proxyData?.authorName || "Unknown"}`,
    rawDescription: data.title || proxyData?.title,
    author: data.author_name || proxyData?.authorName ? {
      name: data.author_name || proxyData?.authorName,
      url: data.author_url,
    } : undefined,
    provider: {
      name: "TikTok",
      url: data.provider_url || "https://www.tiktok.com",
    },
    color: "#FF0050",
    video: {
      url: `https://www.tiktok.com/player/v1/${videoId}`,
      width: 325,
      height: 738,
      kind: "player",
    },
    thumbnail: proxyData?.coverUrl || data.thumbnail_url ? {
      url: proxyData?.coverUrl || data.thumbnail_url,
      width: data.thumbnail_width ?? 300,
      height: data.thumbnail_height ?? 400,
    } : undefined,
    fields: [],
  };
}

async function _fetchTikTokDataLegacy(url: string): Promise<EmbedInfo | null> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl);
  if (!res.ok) return null;

  const data = await res.json() as any;

  // Extract video ID from the oEmbed HTML or URL
  const videoIdMatch = data.html?.match(/data-video-id="([^"]+)"/) || url.match(/video\/(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;
  if (!videoId) return null;

  const embed: EmbedInfo = {
    id: nextEmbedId(),
    url,
    type: "video",
    rawTitle: `TikTok · ${data.author_name || "Unknown"}`,
    rawDescription: data.title,
    author: data.author_name ? {
      name: data.author_name,
      url: data.author_url,
    } : undefined,
    provider: {
      name: "TikTok",
      url: data.provider_url || "https://www.tiktok.com",
    },
    color: "#FF0050",
    video: {
      url: `https://www.tiktok.com/player/v1/${videoId}`,
      width: 325,
      height: 738,
      kind: "player",
    },
    thumbnail: data.thumbnail_url ? {
      url: data.thumbnail_url,
      width: data.thumbnail_width,
      height: data.thumbnail_height,
    } : undefined,
    fields: [],
  };

  return embed;
}

async function fetchOpenGraphData(url: string): Promise<EmbedInfo | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) {
      return null;
    }

    const html = await res.text();

    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i) || html.match(/<meta name="description" content="([^"]+)"/i);
    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const siteNameMatch = html.match(/<meta property="og:site_name" content="([^"]+)"/i);
    const typeMatch = html.match(/<meta property="og:type" content="([^"]+)"/i);

    if (!titleMatch) return null;

    const hostname = new URL(url).hostname;

    const embed: EmbedInfo = {
      id: nextEmbedId(),
      url,
      type: typeMatch?.[1]?.includes("video") ? "video" : "link",
      rawTitle: titleMatch?.[1] || hostname,
      rawDescription: descMatch?.[1],
      fields: [],
    };

    if (siteNameMatch?.[1]) {
      embed.provider = {
        name: siteNameMatch[1],
        url: `https://${hostname}`,
      };
    }

    if (imgMatch?.[1]) {
      embed.thumbnail = {
        url: imgMatch[1],
      };
    }

    return embed;
  } catch {
    return null;
  }
}

async function fetchSpotifyData(url: string): Promise<EmbedInfo | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return await fetchOpenGraphData(url);

    const data = await res.json() as any;

    return {
      id: nextEmbedId(),
      url,
      type: "link",
      rawTitle: data.title,
      rawDescription: data.author_name ? `Spotify - ${data.author_name}` : "Spotify",
      provider: {
        name: "Spotify",
        url: "https://spotify.com/",
      },
      color: "#1DB954",
      thumbnail: data.thumbnail_url ? {
        url: data.thumbnail_url,
        width: data.thumbnail_width ?? 300,
        height: data.thumbnail_height ?? 300,
      } : undefined,
      fields: [],
    };
  } catch {
    return await fetchOpenGraphData(url);
  }
}
