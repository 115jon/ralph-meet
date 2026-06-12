export const GIF_FAVORITES_STORAGE_KEY = "chat:gifs:favorites";
export const MAX_GIF_FAVORITES = 48;
export const MAX_GIF_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface GifPickerAsset {
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  contentType: "image/gif" | "video/mp4";
}

export interface GifPickerItem {
  id: string;
  title: string;
  altText?: string;
  preview: GifPickerAsset;
  send: GifPickerAsset;
  sourceUrl: string;
  aspectRatio: number;
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
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const suffix = search.toString();
  return suffix ? `tenor:v1:${path}?${suffix}` : `tenor:v1:${path}`;
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
    altText: result.content_description || undefined,
    preview,
    send,
    sourceUrl: result.itemurl || result.url || preview.url,
    aspectRatio: preview.width / preview.height,
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

export function toggleGifFavorite(favorites: GifPickerItem[], gif: GifPickerItem): GifPickerItem[] {
  const existing = favorites.some((item) => item.id === gif.id);
  if (existing) {
    return favorites.filter((item) => item.id !== gif.id);
  }

  return [gif, ...favorites.filter((item) => item.id !== gif.id)].slice(0, MAX_GIF_FAVORITES);
}

export function isGifFavorite(favorites: GifPickerItem[], gifId: string): boolean {
  return favorites.some((item) => item.id === gifId);
}

export function parseStoredGifFavorites(raw: string | null | undefined): GifPickerItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && item.preview?.url && item.send?.url);
  } catch {
    return [];
  }
}
