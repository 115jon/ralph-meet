export const GIF_FAVORITES_STORAGE_KEY = "chat:gifs:favorites";
export const MAX_GIF_FAVORITES = 48;
export const MAX_GIF_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_GIF_PROVIDER = "klipy";

export type GifProvider = "klipy" | "tenor" | "external";

export interface GifPickerAsset {
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  contentType: "image/gif" | "image/apng" | "image/webp" | "video/mp4";
}

export interface GifPickerItem {
  id: string;
  title: string;
  provider: GifProvider;
  altText?: string;
  query?: string;
  preview: GifPickerAsset;
  send: GifPickerAsset;
  sourceUrl: string;
  aspectRatio: number;
  duration?: number;
  mediaType?: "gifs" | "stickers" | "clips";
}

export interface GifPickerCategory {
  id: string;
  label: string;
  query: string;
  imageUrl: string;
}

export interface TenorConfig {
  API_V2_KEY: string;
  API_V2_URL: string;
  API_V2_CLIENT_KEY?: string;
}

export type TenorCacheParamValue = string | number | boolean | null | undefined;

interface KlipyMediaFormat {
  url?: string;
  dims?: [number, number];
  size?: number;
}

export function getGifProviderLabel(provider: GifProvider): string {
  if (provider === "external") return "Saved GIF";
  return provider === "klipy" ? "KLIPY" : "Tenor";
}

export function getGifProviderSearchPlaceholder(provider: GifProvider): string {
  if (provider === "external") return "Search GIFs";
  return `Search ${getGifProviderLabel(provider)}`;
}

export function getGifAttachmentProvider(fileKeyOrUrl: string | null | undefined): GifProvider | null {
  if (!fileKeyOrUrl) return null;

  const normalized = fileKeyOrUrl.toLowerCase();
  if (normalized.includes("/gifs/klipy/") || normalized.includes("\\gifs\\klipy\\")) return "klipy";
  if (normalized.includes("/gifs/tenor/") || normalized.includes("\\gifs\\tenor\\")) return "tenor";

  try {
    const parsed = new URL(fileKeyOrUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (/^static\d*\.klipy\.com$/.test(hostname)) return "klipy";
    if (hostname === "tenor.com" || /^media\d*\.tenor\.com$/.test(hostname)) return "tenor";
    if (hostname === "gif.fxtwitter.com" && parsed.pathname.startsWith("/tweet_video/")) return "external";
  } catch {
    // Non-URL storage keys are handled by the path checks above.
  }

  return null;
}

export function inferGifProviderFromUrl(url: string | null | undefined): GifProvider {
  if (!url) return DEFAULT_GIF_PROVIDER;

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("klipy.com")) return "klipy";
  if (lowerUrl.includes("tenor.com")) return "tenor";

  return getGifAttachmentProvider(url) ?? DEFAULT_GIF_PROVIDER;
}

export function getGifItemIdentityKey(gif: Pick<GifPickerItem, "id" | "provider">): string {
  return `${gif.provider}:${gif.id}`;
}

interface TenorMediaFormat {
  url?: string;
  dims?: [number, number];
  size?: number;
}

function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function extractTenorConfigFromHtml(html: string): TenorConfig | null {
  const match = html.match(/<script\b(?=[^>]*\bid=["']data["'])(?=[^>]*\btype=["']text\/x-cache["'])[^>]*>([\s\S]*?)<\/script>/i);
  const encoded = match?.[1]?.trim();
  if (!encoded) return null;

  try {
    const decoded = JSON.parse(decodeBase64Utf8(encoded));
    if (typeof decoded?.API_V2_KEY !== "string" || typeof decoded?.API_V2_URL !== "string") return null;

    return {
      API_V2_KEY: decoded.API_V2_KEY,
      API_V2_URL: decoded.API_V2_URL,
      API_V2_CLIENT_KEY: typeof decoded.API_V2_CLIENT_KEY === "string" ? decoded.API_V2_CLIENT_KEY : undefined,
    };
  } catch {
    return null;
  }
}

export function buildTenorCacheKey(path: string, params: Record<string, TenorCacheParamValue>): string {
  return buildGifProviderCacheKey("tenor", path, params);
}

export function buildGifProviderCacheKey(
  provider: GifProvider,
  path: string,
  params: Record<string, TenorCacheParamValue>
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const suffix = search.toString();
  return suffix ? `gif:${provider}:v1:${path}?${suffix}` : `gif:${provider}:v1:${path}`;
}

export function dedupeGifPickerItems(items: GifPickerItem[]): GifPickerItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const dedupeKey = getGifItemIdentityKey(item);
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

export function appendUniqueGifPickerItems(current: GifPickerItem[], incoming: GifPickerItem[]): GifPickerItem[] {
  return dedupeGifPickerItems([...current, ...incoming]);
}

function normalizeTenorAsset(format: TenorMediaFormat | undefined, contentType: GifPickerAsset["contentType"]): GifPickerAsset | null {
  if (!format?.url || !Array.isArray(format.dims) || format.dims.length < 2) return null;

  const [width, height] = format.dims;
  if (!width || !height) return null;

  return {
    url: format.url,
    width,
    height,
    sizeBytes: format.size ?? 0,
    contentType,
  };
}

export function normalizeTenorGifResult(result: any): GifPickerItem | null {
  if (!result?.id || !result?.media_formats) return null;

  const sendCandidates = [
    normalizeTenorAsset(result.media_formats.gif, "image/gif"),
    normalizeTenorAsset(result.media_formats.tinygif, "image/gif"),
    normalizeTenorAsset(result.media_formats.mp4, "video/mp4"),
    normalizeTenorAsset(result.media_formats.tinymp4, "video/mp4"),
  ].filter(Boolean) as GifPickerAsset[];

  const previewCandidates = [
    normalizeTenorAsset(result.media_formats.tinymp4, "video/mp4"),
    normalizeTenorAsset(result.media_formats.mp4, "video/mp4"),
    normalizeTenorAsset(result.media_formats.tinygif, "image/gif"),
    normalizeTenorAsset(result.media_formats.gif, "image/gif"),
  ].filter(Boolean) as GifPickerAsset[];

  const send = sendCandidates.find((asset) => asset.sizeBytes === 0 || asset.sizeBytes <= MAX_GIF_UPLOAD_BYTES) ?? sendCandidates[0];
  const preview = previewCandidates[0];

  if (!send || !preview) return null;

  const title =
    result.content_description ||
    result.h1_title ||
    result.title ||
    result.long_title ||
    (Array.isArray(result.tags) && result.tags.length > 0 ? String(result.tags[0]) : "GIF");

  return {
    id: String(result.id),
    title,
    provider: "tenor",
    altText: result.content_description || undefined,
    query: undefined,
    preview,
    send,
    sourceUrl: result.itemurl || result.url || preview.url,
    aspectRatio: preview.width / preview.height,
  };
}

function normalizeKlipyAsset(format: KlipyMediaFormat | undefined, contentType: GifPickerAsset["contentType"]): GifPickerAsset | null {
  if (!format?.url || !Array.isArray(format.dims) || format.dims.length < 2) return null;

  const [width, height] = format.dims;
  if (!width || !height) return null;

  return {
    url: format.url,
    width,
    height,
    sizeBytes: format.size ?? 0,
    contentType,
  };
}

export function normalizeKlipyGifResult(result: any): GifPickerItem | null {
  if (!result?.id || !result?.media_formats) return null;

  const sendCandidates = [
    normalizeKlipyAsset(result.media_formats.gif, "image/gif"),
    normalizeKlipyAsset(result.media_formats.mediumgif, "image/gif"),
    normalizeKlipyAsset(result.media_formats.tinygif, "image/gif"),
    normalizeKlipyAsset(result.media_formats.mp4, "video/mp4"),
    normalizeKlipyAsset(result.media_formats.tinymp4, "video/mp4"),
  ].filter(Boolean) as GifPickerAsset[];

  const previewCandidates = [
    normalizeKlipyAsset(result.media_formats.tinymp4, "video/mp4"),
    normalizeKlipyAsset(result.media_formats.mp4, "video/mp4"),
    normalizeKlipyAsset(result.media_formats.tinygif, "image/gif"),
    normalizeKlipyAsset(result.media_formats.mediumgif, "image/gif"),
    normalizeKlipyAsset(result.media_formats.gif, "image/gif"),
  ].filter(Boolean) as GifPickerAsset[];

  const send = sendCandidates.find((asset) => asset.sizeBytes === 0 || asset.sizeBytes <= MAX_GIF_UPLOAD_BYTES) ?? sendCandidates[0];
  const preview = previewCandidates[0];

  if (!send || !preview) return null;

  return {
    id: String(result.id),
    title: String(result.title || result.content_description || result.long_title || "GIF"),
    provider: "klipy",
    altText: result.content_description || result.title || undefined,
    query: undefined,
    preview,
    send,
    sourceUrl: send.url,
    aspectRatio: preview.width / preview.height,
    duration: typeof result.duration === "number" ? result.duration : (typeof result.duration === "string" && !isNaN(parseFloat(result.duration)) ? parseFloat(result.duration) : undefined),
  };
}

export function normalizeTenorCategory(tag: any): GifPickerCategory | null {
  if (!tag?.id || !tag?.searchterm || !tag?.image) return null;

  return {
    id: String(tag.id),
    label: String(tag.searchterm),
    query: String(tag.searchterm),
    imageUrl: String(tag.image),
  };
}

export function normalizeKlipyCategory(tag: any): GifPickerCategory | null {
  if (!tag) return null;
  if (tag.category || tag.preview_url) {
    const label = tag.category || tag.query || "Category";
    const query = tag.query || tag.category || "";
    const imageUrl = tag.preview_url || "";
    return {
      id: label,
      label,
      query,
      imageUrl,
    };
  }
  if (!tag.id || !tag.searchterm || !tag.image) return null;

  return {
    id: String(tag.id),
    label: String(tag.searchterm),
    query: String(tag.searchterm),
    imageUrl: String(tag.image),
  };
}

export function toggleGifFavorite(favorites: GifPickerItem[], gif: GifPickerItem): GifPickerItem[] {
  const gifKey = getGifItemIdentityKey(gif);
  const existing = favorites.some((item) => getGifItemIdentityKey(item) === gifKey);
  if (existing) {
    return favorites.filter((item) => getGifItemIdentityKey(item) !== gifKey);
  }

  return [gif, ...favorites.filter((item) => getGifItemIdentityKey(item) !== gifKey)].slice(0, MAX_GIF_FAVORITES);
}

export function isGifFavorite(favorites: GifPickerItem[], gifId: string): boolean {
  return favorites.some((item) => item.id === gifId);
}

export function parseStoredGifFavorites(raw: string | null | undefined): GifPickerItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && item.preview?.url && item.send?.url)
      .map((item) => {
        const inferredMediaType = item.mediaType || (
          (item.duration !== undefined || item.send?.contentType === "video/mp4" || item.send?.url?.includes(".mp4") || item.send?.url?.includes("/clips/") || item.id?.toLowerCase().includes("clip"))
            ? "clips"
            : (item.send?.contentType === "image/apng" || item.send?.url?.includes("/stickers/") || item.preview?.url?.includes("/stickers/") || item.send?.url?.includes("sticker") || item.preview?.url?.includes("sticker") || item.title?.toLowerCase().includes("sticker") || item.id?.toLowerCase().includes("sticker"))
              ? "stickers"
              : "gifs"
        );
        return {
          ...item,
          mediaType: inferredMediaType,
          provider:
            item.provider === "klipy" || item.provider === "tenor"
              ? item.provider
              : item.provider === "external"
                ? "external"
              : inferGifProviderFromUrl(item.sourceUrl || item.send?.url || item.preview?.url),
        };
      });
  } catch {
    return [];
  }
}
