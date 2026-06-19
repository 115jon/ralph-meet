import { getGifAttachmentProvider, type GifPickerAsset, type GifPickerItem } from "@/lib/gif-picker";

type AnimatedFavoriteInput = {
  id?: string;
  title?: string;
  altText?: string | null;
  sourceUrl: string;
  previewUrl?: string | null;
  sendUrl?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  duration?: number | null;
};

type AttachmentFavoriteInput = AnimatedFavoriteInput & {
  filename?: string | null;
  fileKeyOrUrl?: string | null;
};

function normalizeAnimatedContentType(contentType: string | null | undefined): GifPickerAsset["contentType"] {
  const mime = contentType?.toLowerCase().split(";")[0].trim();
  if (mime === "image/apng") return "image/apng";
  if (mime === "image/webp") return "image/webp";
  if (mime?.startsWith("video/")) return "video/mp4";
  return "image/gif";
}

export function getFxTwitterGifWebpUrl(sourceUrl: string): string | null {
  const xGifSourceUrl = getXGifSourceUrl(sourceUrl);
  if (!xGifSourceUrl) return null;

  try {
    const parsed = new URL(xGifSourceUrl);
    return `https://gif.fxtwitter.com${parsed.pathname.replace(/\.mp4$/i, ".webp")}`;
  } catch {
    return null;
  }
}

function getXGifSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  const unwrappedUrl = unwrapProxyMediaUrl(sourceUrl);

  try {
    const parsed = new URL(unwrappedUrl, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === "video.twimg.com" && pathname.startsWith("/tweet_video/") && pathname.toLowerCase().endsWith(".mp4")) {
      return `https://video.twimg.com${pathname}`;
    }

    if (hostname === "gif.fxtwitter.com" && pathname.startsWith("/tweet_video/") && pathname.toLowerCase().endsWith(".webp")) {
      return `https://video.twimg.com${pathname.replace(/\.webp$/i, ".mp4")}`;
    }
  } catch {
    return null;
  }

  return null;
}

function getXGifFavoriteId(sourceUrl: string | null | undefined): string | null {
  const xGifSourceUrl = getXGifSourceUrl(sourceUrl);
  return xGifSourceUrl ? `x-media-0-${xGifSourceUrl}` : null;
}

function positiveNumber(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function createExternalGifFavorite(input: AnimatedFavoriteInput): GifPickerItem {
  const width = positiveNumber(input.width, 320);
  const height = positiveNumber(input.height, 320);
  const sizeBytes = Math.max(0, Math.floor(positiveNumber(input.sizeBytes, 0)));
  const contentType = normalizeAnimatedContentType(input.contentType);
  const sendUrl = input.sendUrl || input.sourceUrl;
  const previewUrl = input.previewUrl || sendUrl;

  const assetBase = {
    width,
    height,
    sizeBytes,
    contentType,
  } satisfies Omit<GifPickerAsset, "url">;

  const isClip = input.duration !== undefined || contentType === "video/mp4" || sendUrl.includes(".mp4") || sendUrl.includes("/clips/");
  const isSticker = !isClip && (contentType === "image/apng" || sendUrl.includes("/stickers/") || previewUrl.includes("/stickers/") || sendUrl.includes("sticker") || previewUrl.includes("sticker") || input.title?.toLowerCase().includes("sticker") || input.id?.toLowerCase().includes("sticker"));
  const mediaType = isClip ? "clips" : isSticker ? "stickers" : "gifs";

  return {
    id: input.id || sendUrl,
    title: input.title?.trim() || "Saved GIF",
    provider: "external",
    altText: input.altText?.trim() || undefined,
    preview: {
      ...assetBase,
      url: previewUrl,
    },
    send: {
      ...assetBase,
      url: sendUrl,
    },
    sourceUrl: input.sourceUrl,
    aspectRatio: width / height,
    mediaType,
  };
}

function getFilenameStem(filename: string | null | undefined): string | null {
  const trimmed = filename?.trim();
  if (!trimmed) return null;

  const lastDot = trimmed.lastIndexOf(".");
  return lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
}

export function createAttachmentGifFavorite(input: AttachmentFavoriteInput): GifPickerItem {
  const favorite = createExternalGifFavorite(input);
  const identityUrl = input.fileKeyOrUrl || input.sendUrl || input.sourceUrl;
  const xGifFavoriteId = getXGifFavoriteId(identityUrl);
  
  let result: GifPickerItem;
  if (xGifFavoriteId) {
    result = {
      ...favorite,
      id: xGifFavoriteId,
      provider: "external",
    };
  } else {
    const provider = getGifAttachmentProvider(identityUrl);
    if (provider === "klipy" || provider === "tenor") {
      result = {
        ...favorite,
        id: getFilenameStem(input.filename) || input.id || favorite.id,
        provider,
      };
    } else {
      result = favorite;
    }
  }

  const isClip = input.duration !== undefined || result.send.contentType === "video/mp4" || result.send.url.includes(".mp4") || result.send.url.includes("/clips/");
  const isSticker = !isClip && (result.send.contentType === "image/apng" || result.send.url.includes("/stickers/") || result.preview.url.includes("/stickers/") || result.send.url.includes("sticker") || result.preview.url.includes("sticker") || input.filename?.toLowerCase().includes("sticker") || result.title.toLowerCase().includes("sticker") || result.id.toLowerCase().includes("sticker"));
  result.mediaType = isClip ? "clips" : isSticker ? "stickers" : "gifs";

  return result;
}

export function unwrapProxyMediaUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    const proxied = parsed.pathname.endsWith("/api/proxy-media")
      ? parsed.searchParams.get("url")
      : null;
    return proxied || url;
  } catch {
    return url;
  }
}
