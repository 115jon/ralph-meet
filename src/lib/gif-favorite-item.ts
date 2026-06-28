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

function getDefaultFavoriteTitle(contentType: GifPickerAsset["contentType"], providedTitle?: string): string {
  const trimmed = providedTitle?.trim();
  if (trimmed) return trimmed;
  return contentType === "video/mp4" ? "Saved clip" : "Saved GIF";
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
    title: getDefaultFavoriteTitle(contentType, input.title),
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
    duration: typeof input.duration === "number" && Number.isFinite(input.duration) && input.duration > 0
      ? input.duration
      : undefined,
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

type AttachmentClipFavoriteInput = AttachmentFavoriteInput & {
  previewUrl?: string | null;
  sendUrl?: string | null;
  duration?: number | null;
};

export function createAttachmentClipFavorite(input: AttachmentClipFavoriteInput): GifPickerItem {
  const identityUrl = input.fileKeyOrUrl || input.sendUrl || input.sourceUrl;
  const favorite = createExternalGifFavorite({
    ...input,
    title: input.title?.trim() || getFilenameStem(input.filename) || undefined,
    contentType: "video/mp4",
  });

  const provider = getGifAttachmentProvider(identityUrl);
  const nextId = provider === "klipy" || provider === "tenor"
    ? getFilenameStem(input.filename) || input.id || favorite.id
    : input.sourceUrl || input.sendUrl || input.id || favorite.id;

  const result: GifPickerItem = {
    ...favorite,
    id: nextId,
    provider: provider ?? "external",
    mediaType: "clips",
  };

  return {
    ...result,
    // Normalize any accidental non-clip inference from caller input.
    mediaType: "clips",
  };
}

export function getFavoriteActionLabel(gif: Pick<GifPickerItem, "mediaType" | "send">, isFavorite: boolean): string {
  const mediaType = gif.mediaType ?? inferGifPickerMediaType(gif);
  const noun = mediaType === "clips" || gif.send.contentType === "video/mp4" ? "clip" : "GIF";
  return isFavorite ? `Remove ${noun} from favorites` : `Add ${noun} to favorites`;
}

export { unwrapProxyMediaUrl } from "@/lib/proxy-media-url";
