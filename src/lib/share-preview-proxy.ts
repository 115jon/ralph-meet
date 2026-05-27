import type { MessageShare } from "@/services/message-share.service";

interface TikTokProxyMetadata {
  coverUrl?: string;
  title?: string;
  authorName?: string;
  videoUrl?: string;
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
