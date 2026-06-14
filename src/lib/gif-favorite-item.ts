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
  const unwrappedUrl = unwrapProxyMediaUrl(sourceUrl);

  try {
    const parsed = new URL(unwrappedUrl, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    if (parsed.hostname.toLowerCase() !== "video.twimg.com") return null;
    if (!parsed.pathname.startsWith("/tweet_video/") || !parsed.pathname.toLowerCase().endsWith(".mp4")) return null;

    return `https://gif.fxtwitter.com${parsed.pathname.replace(/\.mp4$/i, ".webp")}`;
  } catch {
    return null;
  }
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
  const provider = getGifAttachmentProvider(input.fileKeyOrUrl || input.sendUrl || input.sourceUrl);

  if (provider === "klipy" || provider === "tenor") {
    return {
      ...favorite,
      id: getFilenameStem(input.filename) || input.id || favorite.id,
      provider,
    };
  }

  return favorite;
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
