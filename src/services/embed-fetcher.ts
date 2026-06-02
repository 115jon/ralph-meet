import type { EmbedInfo } from "@/lib/types";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

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

    if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
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
    console.error(`[EmbedFetcher] Failed to fetch metadata for ${url}:`, err);
    return null; // Silent fail, just don't embed
  }
}

// ── Provider Fetchers ─────────────────────────────────────────────────────────

async function fetchYouTubeData(url: string): Promise<EmbedInfo | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) return null;

  const data = await res.json() as any;
  const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;

  if (!videoId) return null;

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
      width: 1280,
      height: 720,
      kind: "player",
    },
    fields: [],
  };
}

async function fetchTwitterData(url: string): Promise<EmbedInfo | null> {
  const parsed = new URL(url);

  // APIs that return JSON — fxtwitter first (structured response), vxtwitter fallback
  const apis = [
    `https://api.fxtwitter.com${parsed.pathname}`,
    `https://api.vxtwitter.com${parsed.pathname}`,
  ];

  for (const apiUrl of apis) {
    try {
      console.log(`[embed:twitter] Trying API: ${apiUrl}`);
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'RalphMeet/1.0 (+https://ralph.dev)' },
      });
      console.log(`[embed:twitter] API response status: ${res.status}, content-type: ${res.headers.get('content-type')}`);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.log(`[embed:twitter] API ${res.status} body (first 200): ${errBody.substring(0, 200)}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        console.log(`[embed:twitter] API returned non-JSON content-type: ${contentType}`);
        continue;
      }

      const data = await res.json() as any;
      // vxtwitter returns bare object, fxtwitter returns { code: 200, tweet: {} }
      const tweet = data.tweet || data;

      if (tweet && tweet.text) {
        // vxtwitter uses media_extended[], fxtwitter uses media.videos[] (plural)
        const fxVideo = tweet.media?.videos?.[0];
        const extVideo = tweet.media_extended?.find((m: any) => m.type === "video");
        const videoUrl = extVideo?.url || fxVideo?.url || null;
        const thumbnailUrl = extVideo?.thumbnail_url || fxVideo?.thumbnail_url || null;

        // Photo fallback
        const mediaPhotos = tweet.media_extended?.filter((m: any) => m.type === "image")?.map((m: any) => m.url)
          || tweet.media?.photos?.map((p: any) => p.url)
          || tweet.media?.all?.filter((m: any) => m.type === "photo" || m.type === "image")?.map((m: any) => m.url)
          || tweet.mediaURLs || [];
        const firstMedia = thumbnailUrl || (mediaPhotos.length > 0 ? mediaPhotos[0] : null);

        // Author: vxtwitter uses user_name/user_screen_name, fxtwitter uses author.name/screen_name
        const authorName = tweet.author?.name || tweet.user_name || "X User";
        const authorScreenName = tweet.author?.screen_name || tweet.user_screen_name || parsed.pathname.split("/")[1];
        const authorAvatar =
          tweet.author?.avatar_url ||
          tweet.user_profile_image_url ||
          tweet.author?.profile_image_url ||
          tweet.user?.profile_image_url;

        const embed: EmbedInfo = {
          id: nextEmbedId(),
          url,
          type: "rich",
          rawDescription: tweet.text,
          author: {
            name: `${authorName} (@${authorScreenName})`,
            url: `https://twitter.com/${authorScreenName}`,
            iconURL: authorAvatar,
          },
          provider: {
            name: "X",
            url: "https://x.com",
          },
          footer: {
            text: "X",
            iconURL: "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png",
          },
          color: "#1D9BF0",
          timestamp: tweet.created_timestamp
            ? new Date(tweet.created_timestamp * 1000).toISOString()
            : tweet.date_epoch
              ? new Date(tweet.date_epoch * 1000).toISOString()
              : undefined,
          fields: [],
        };

        if (firstMedia) {
          embed.thumbnail = {
            url: firstMedia,
            width: extVideo?.size?.width || fxVideo?.width || 1280,
            height: extVideo?.size?.height || fxVideo?.height || 720,
          };
        }

        if (videoUrl) {
          embed.video = {
            url: videoUrl,
            width: extVideo?.size?.width || fxVideo?.width || 1280,
            height: extVideo?.size?.height || fxVideo?.height || 720,
            kind: "direct",
            contentType: fxVideo?.format || fxVideo?.variants?.[0]?.content_type || "video/mp4",
          };
        }

        return embed;
      }
    } catch (e) {
      console.error(`[embed:twitter] API ${apiUrl} failed:`, e);
    }
  }

  // Fallback: scrape OG tags from vxtwitter.com
  try {
    const vxUrl = `https://vxtwitter.com${parsed.pathname}`;
    console.log(`[embed:twitter] Fallback: scraping vxtwitter OG: ${vxUrl}`);
    const res = await fetch(vxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
      }
    });

    if (res.ok) {
      const html = await res.text();
      console.log(`[embed:twitter] OG fallback HTML length: ${html.length}`);

      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i);
      const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const videoMatch = html.match(/<meta property="og:video(?::url)?" content="([^"]+)"/i);
      const videoTypeMatch = html.match(/<meta property="og:video:type" content="([^"]+)"/i);

      console.log(`[embed:twitter] OG: title=${!!titleMatch} desc=${!!descMatch} img=${!!imgMatch} video=${!!videoMatch}`);

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
    console.error("[embed:twitter] OG fallback failed:", e);
  }

  return null;
}

async function fetchInstagramData(url: string): Promise<EmbedInfo | null> {
  // Since Instagram actively blocks proxies and CF Workers get internal errors,
  // we return a basic embed object that tells the client to render Instagram's official iframe.
  return {
    id: nextEmbedId(),
    url,
    type: "rich",
    provider: { name: "Instagram", url: "https://www.instagram.com" },
    color: "#E1306C",
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
