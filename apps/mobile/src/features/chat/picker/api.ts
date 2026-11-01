import { Schema } from "effect";

import { apiFetch, apiJson, ApiError } from "@/lib/api";

import { UploadSchema } from "../schema";

// The picker's server calls. Shapes follow the web: GET /api/emojis
// (src/routes/api/emojis.ts), /api/gifs (src/routes/api/gifs.ts, read by
// GifPickerModal.tsx and useGifFavoritesStore.ts) and the GIF send route
// (src/routes/api/channels/$id/messages/gif.ts, called by useMessageInput).
// All of them take the session's Bearer token through requireAuth.

const JSON_HEADERS = { "Content-Type": "application/json" };

// ── Your creations ─────────────────────────────────────────────────────────

const CreationSchema = Schema.Struct({
  id: Schema.String,
  shortcode: Schema.String,
  status: Schema.String,
  image_url: Schema.optional(Schema.NullOr(Schema.String)),
  /** `<:shortcode:id>`, what the web inserts. */
  token: Schema.optional(Schema.String),
});
export type Creation = typeof CreationSchema.Type;

const CreationListSchema = Schema.Struct({
  items: Schema.Array(CreationSchema),
});

/** GET /api/emojis: the caller's own generated emoji, newest first (64 at most). */
export async function fetchCreations(): Promise<readonly Creation[]> {
  const { items } = await apiJson("/api/emojis", CreationListSchema);
  return items;
}

// ── GIFs ───────────────────────────────────────────────────────────────────

export const GIF_MEDIA_TYPES = ["gifs", "stickers", "clips", "memes"] as const;
export type GifMediaType = (typeof GIF_MEDIA_TYPES)[number];

const GifAssetSchema = Schema.Struct({
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  sizeBytes: Schema.Number,
  contentType: Schema.String,
});
export type GifAsset = typeof GifAssetSchema.Type;

/** A GifPickerItem (src/lib/gif-picker.ts). Favorites send it back whole. */
const GifSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  provider: Schema.Literals(["klipy", "tenor", "external"]),
  altText: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  preview: GifAssetSchema,
  send: GifAssetSchema,
  sourceUrl: Schema.String,
  aspectRatio: Schema.Number,
  duration: Schema.optional(Schema.Number),
  mediaType: Schema.optional(Schema.Literals(GIF_MEDIA_TYPES)),
});
export type Gif = typeof GifSchema.Type;

const GifPageSchema = Schema.Struct({
  results: Schema.Array(GifSchema),
  next: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GifPage = typeof GifPageSchema.Type;

const GifCategorySchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  query: Schema.String,
  imageUrl: Schema.String,
});
export type GifCategory = typeof GifCategorySchema.Type;

const GifCategoriesSchema = Schema.Struct({
  categories: Schema.Array(GifCategorySchema),
});

const GifFavoritesSchema = Schema.Struct({
  favorites: Schema.Array(GifSchema),
});

/** `provider:id`, the web's identity for a GIF (getGifItemIdentityKey). */
export function gifKey(gif: Pick<Gif, "provider" | "id">): string {
  return `${gif.provider}:${gif.id}`;
}

/** A GIF previewed as a moving image heavier than this plays as video. */
const MAX_IMAGE_PREVIEW_BYTES = 4_000_000;

/**
 * What a picker tile draws. KLIPY previews GIFs as tiny mp4s, but a small
 * GIF as an image costs no video decoder (a few can play at once), so the
 * sent GIF stands in when it is light enough.
 */
export interface GifPreview {
  readonly kind: "image" | "video";
  readonly url: string;
}

export function gifPreview(gif: Gif): GifPreview {
  if (gif.preview.contentType.startsWith("image/"))
    return { kind: "image", url: gif.preview.url };
  if (
    gif.send.contentType.startsWith("image/") &&
    gif.send.sizeBytes <= MAX_IMAGE_PREVIEW_BYTES
  )
    return { kind: "image", url: gif.send.url };
  return { kind: "video", url: gif.preview.url };
}

function gifsPath(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value);
  return `/api/gifs?${query}`;
}

export interface GifQuery {
  readonly mediaType: GifMediaType;
  /** Empty: trending. */
  readonly q?: string;
  readonly next?: string | null;
  readonly limit?: number;
  /** KLIPY personalises by customer; the web passes the user id. */
  readonly customerId?: string;
}

/** GET /api/gifs?mode=search: a page of results, trending without `q`. */
export function fetchGifs(
  query: GifQuery,
  signal?: AbortSignal,
): Promise<GifPage> {
  return apiJson(
    gifsPath({
      mode: "search",
      provider: "klipy",
      mediaType: query.mediaType,
      q: query.q?.trim() || undefined,
      next: query.next ?? undefined,
      limit: String(query.limit ?? 24),
      customerId: query.customerId,
    }),
    GifPageSchema,
    { signal },
  );
}

/** GET /api/gifs?mode=categories for one media type. */
export async function fetchGifCategories(
  mediaType: GifMediaType,
  signal?: AbortSignal,
): Promise<readonly GifCategory[]> {
  const { categories } = await apiJson(
    gifsPath({ mode: "categories", provider: "klipy", mediaType }),
    GifCategoriesSchema,
    { signal },
  );
  return categories;
}

export async function fetchGifFavorites(): Promise<readonly Gif[]> {
  const { favorites } = await apiJson(
    gifsPath({ mode: "favorites" }),
    GifFavoritesSchema,
  );
  return favorites;
}

/** POST /api/gifs?mode=favorite: answers with the whole list. */
export async function addGifFavorite(gif: Gif): Promise<readonly Gif[]> {
  const { favorites } = await apiJson(
    gifsPath({ mode: "favorite" }),
    GifFavoritesSchema,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ favorite: gif }),
    },
  );
  return favorites;
}

/** DELETE /api/gifs?mode=favorite: answers with the whole list. */
export async function removeGifFavorite(gif: Gif): Promise<readonly Gif[]> {
  const { favorites } = await apiJson(
    gifsPath({ mode: "favorite" }),
    GifFavoritesSchema,
    {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ provider: gif.provider, gif_id: gif.id }),
    },
  );
  return favorites;
}

/** The web's getGifFilenameExtension (useMessageInput.ts). */
function extensionFor(contentType: string): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "image/apng") return "apng";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  return "gif";
}

/**
 * POST /api/channels/:id/messages/gif: the server records the GIF's own URL
 * as an attachment (nothing is uploaded) for the next message to name.
 */
export function createGifAttachment(channelId: string, gif: Gif) {
  return apiJson(
    `/api/channels/${encodeURIComponent(channelId)}/messages/gif`,
    UploadSchema,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        source_url: gif.send.url,
        filename: `${gif.mediaType ?? "gifs"}_${gif.id}.${extensionFor(gif.send.contentType)}`,
        content_type: gif.send.contentType,
        provider: gif.provider,
        size_bytes: gif.send.sizeBytes,
      }),
    },
  );
}

/** KLIPY's share counter, as the web pings it after a send. Best effort. */
export function registerGifShare(gif: Gif): void {
  if (gif.provider !== "klipy") return;
  apiFetch(
    gifsPath({
      mode: "register-share",
      provider: "klipy",
      id: gif.id,
      q: gif.query || undefined,
    }),
  ).catch(() => undefined);
}

/** A short reason for a GIF call that failed. */
export function gifErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "KLIPY is busy. Try again in a moment.";
    if (error.status === 403) return "GIFs aren't allowed here.";
    if (error.status === 401) return "Signed out.";
    return "KLIPY didn't answer. Try again.";
  }
  return "No connection.";
}
