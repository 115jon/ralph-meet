import type { MessageShare } from "@/services/message-share.service";

interface TikTokProxyMetadata {
  coverUrl?: string;
  title?: string;
  authorName?: string;
  videoUrl?: string;
}

interface InstagramOEmbedMetadata {
  mediaId?: string;
  title?: string;
  authorName?: string;
  authorUrl?: string;
  providerName?: string;
  providerUrl?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

interface InstagramVideoMetadata {
  videoUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  durationSeconds?: number;
}

function canonicalizeInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://www.instagram.com${pathname}`;
  } catch {
    return url;
  }
}

export function getTikTokThumbnailUrl(share: MessageShare): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    let isTikTok = provider === "tiktok";
    try {
      isTikTok = isTikTok || new URL(embed.url).hostname.toLowerCase().includes("tiktok.com");
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }

    if (isTikTok) return embed.thumbnail?.url ?? null;
  }

  return null;
}

export function getTikTokShareUrl(share: MessageShare): string | null {
  for (const embed of share.snapshot.embeds) {
    const provider = embed.provider?.name?.toLowerCase();
    try {
      const parsed = new URL(embed.url);
      if (provider === "tiktok" || parsed.hostname.toLowerCase().includes("tiktok.com")) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed embed URLs and continue scanning.
    }
  }

  return null;
}

export async function fetchTikTokProxyMetadata(url: string): Promise<TikTokProxyMetadata | null> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (payload?.code !== 0 || !payload.data) return null;

  return {
    coverUrl: payload.data.cover || payload.data.origin_cover || payload.data.ai_dynamic_cover,
    title: payload.data.title,
    authorName: payload.data.author?.nickname || payload.data.author?.unique_id,
    videoUrl: payload.data.play,
  };
}

export async function fetchInstagramOEmbedMetadata(url: string): Promise<InstagramOEmbedMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const apiUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonicalUrl)}&omitscript=true`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "application/json",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    mediaId: typeof payload.media_id === "string" ? payload.media_id : undefined,
    title: payload.title,
    authorName: payload.author_name,
    authorUrl: payload.author_url,
    providerName: payload.provider_name,
    providerUrl: payload.provider_url,
    thumbnailUrl: payload.thumbnail_url,
    thumbnailWidth: payload.thumbnail_width,
    thumbnailHeight: payload.thumbnail_height,
  };
}

export async function fetchInstagramVideoMetadata(url: string): Promise<InstagramVideoMetadata | null> {
  const canonicalUrl = canonicalizeInstagramUrl(url);
  const response = await fetch(`https://meet.115jon.site/api/instagram-video?videoUrl=${encodeURIComponent(canonicalUrl)}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
    },
  });

  if (!response.ok || !response.headers.get("Content-Type")?.includes("json")) {
    return null;
  }

  const payload = await response.json() as any;
  if (!payload || typeof payload !== "object") return null;

  return {
    videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : undefined,
    thumbnailUrl: typeof payload.thumbnailUrl === "string" ? payload.thumbnailUrl : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    durationSeconds: typeof payload.durationSeconds === "number" ? payload.durationSeconds : undefined,
  };
}

export async function proxyImage(url: string): Promise<Response | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  const upstream = await fetch(parsed.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeetBot/1.0; +https://meet.115jon.site)",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": "https://www.tiktok.com/",
    },
  });

  const contentType = upstream.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!upstream.ok || !contentType.startsWith("image/") || contentType === "image/svg+xml") {
    return null;
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  const contentLength = upstream.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { headers });
}
