import {
  getGifAttachmentProvider,
  inferGifPickerMediaType,
  normalizeGifPickerContentType,
  type GifPickerAsset,
  type GifPickerItem,
} from "@/lib/gif-picker";
import { unwrapProxyMediaUrl } from "@/lib/proxy-media-url";

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
  const contentType = normalizeGifPickerContentType(input.contentType);
  const sendUrl = input.sendUrl || input.sourceUrl;
  const previewUrl = input.previewUrl || sendUrl;

  const assetBase = {
    width,
    height,
    sizeBytes,
    contentType,
  } satisfies Omit<GifPickerAsset, "url">;

  const mediaType = inferGifPickerMediaType({
    id: input.id || sendUrl,
    title: input.title,
    sourceUrl: input.sourceUrl,
    duration: input.duration,
    preview: {
      url: previewUrl,
      contentType,
    },
    send: {
      url: sendUrl,
      contentType,
    },
  });

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

  result.mediaType = inferGifPickerMediaType(result);

  return result;
}

export { unwrapProxyMediaUrl } from "@/lib/proxy-media-url";
