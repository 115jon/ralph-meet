/**
 * Media Service — channel media/attachments queries for the media panel.
 *
 * Supports three content types: images (includes video), links, and files.
 * The Media tab combines uploaded attachments with direct media already stored
 * inside `messages.embeds`, so linked X/TikTok/etc. media appears alongside
 * uploaded files.
 */

import { getAttachmentUrl } from "@/lib/attachment-url";
import type { EmbedInfo, EmbedMedia } from "@/lib/types";
import type { D1Database } from "@cloudflare/workers-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MediaItem {
  id: string;
  message_id: string;
  filename: string;
  file_key: string;
  url: string;
  source_url?: string | null;
  content_type: string;
  size_bytes: number;
  source_kind: "attachment" | "embed";
  thumbnail_url?: string | null;
  is_gif?: boolean;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  created_at: string;
}

export interface LinkItem {
  id: string;
  message_id: string;
  content: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  created_at: string;
}

// ─── fetchChannelMedia ───────────────────────────────────────────────────────

/**
 * Fetch image and video attachments for a channel (Media tab).
 */
export async function fetchChannelMedia(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<MediaItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const attachmentBindings: (string | number)[] = [channelId];
  const embedBindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND m.created_at < ?";
    attachmentBindings.push(opts.before);
    embedBindings.push(opts.before);
  }
  attachmentBindings.push(limit);
  embedBindings.push(limit);

  const [attachmentResult, embedResult] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.filename, a.file_key, a.content_type, a.size_bytes, a.created_at,
              a.message_id, m.author_id,
              m.created_at AS message_created_at,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND (
           a.content_type LIKE 'image/%'
           OR a.content_type LIKE 'video/mp4%'
           OR a.content_type LIKE 'video/webm%'
           OR a.content_type LIKE 'video/ogg%'
           OR a.content_type LIKE 'video/mp2t%'
         )
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
      .bind(...attachmentBindings)
      .all(),
    db.prepare(
      `SELECT m.id AS message_id, m.created_at, m.embeds, m.author_id,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND COALESCE(m.embeds, '[]') != '[]'
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
      .bind(...embedBindings)
      .all(),
  ]);

  const attachmentItems = (attachmentResult.results ?? []).map(formatAttachmentRow);
  const embedItems = (embedResult.results ?? []).flatMap(extractEmbeddedMediaRows);

  return [...attachmentItems, ...embedItems]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

// ─── fetchChannelFiles ───────────────────────────────────────────────────────

/**
 * Fetch non-media file attachments for a channel (Files tab).
 * Excludes images and videos (those go in the Media tab).
 */
export async function fetchChannelFiles(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<MediaItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const bindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND m.created_at < ?";
    bindings.push(opts.before);
  }
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.filename, a.file_key, a.content_type, a.size_bytes, a.created_at,
              a.message_id, m.author_id,
              m.created_at AS message_created_at,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND a.content_type NOT LIKE 'image/%'
         AND a.content_type NOT LIKE 'video/mp4%'
         AND a.content_type NOT LIKE 'video/webm%'
         AND a.content_type NOT LIKE 'video/ogg%'
         AND a.content_type NOT LIKE 'video/mp2t%'
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all();

  return (results ?? []).map(formatAttachmentRow);
}

// ─── fetchChannelLinks ───────────────────────────────────────────────────────

/**
 * Fetch messages containing URLs for a channel (Links tab).
 */
export async function fetchChannelLinks(
  db: D1Database,
  channelId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<LinkItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const bindings: (string | number)[] = [channelId];

  let cursorClause = "";
  if (opts.before) {
    cursorClause = "AND m.created_at < ?";
    bindings.push(opts.before);
  }
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT m.id, m.content, m.author_id, m.created_at,
              u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
         AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .bind(...bindings)
    .all();

  return (results ?? []).map((row) => ({
    id: row.id as string,
    message_id: row.id as string,
    content: row.content as string,
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    created_at: row.created_at as string,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAttachmentRow(row: Record<string, unknown>): MediaItem {
  const fileKey = row.file_key as string;
  return {
    id: row.id as string,
    message_id: row.message_id as string,
    filename: row.filename as string,
    file_key: fileKey,
    url: getAttachmentUrl(fileKey),
    source_url: null,
    content_type: row.content_type as string,
    size_bytes: row.size_bytes as number,
    source_kind: "attachment",
    thumbnail_url: null,
    is_gif: false,
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    created_at: (row.message_created_at as string) ?? (row.created_at as string),
  };
}

function parseEmbeds(value: unknown): EmbedInfo[] {
  if (Array.isArray(value)) return value as EmbedInfo[];
  if (typeof value !== "string" || value.trim() === "") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as EmbedInfo[] : [];
  } catch {
    return [];
  }
}

function normalizeMediaKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (
      hostname === "video.twimg.com" ||
      hostname === "pbs.twimg.com" ||
      hostname === "gif.fxtwitter.com"
    ) {
      return `${hostname}${pathname}`;
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function inferMediaContentType(
  mediaType: "image" | "video",
  mediaUrl: string,
  explicitContentType?: string,
): string {
  const normalizedExplicit = explicitContentType?.split(";")[0].trim().toLowerCase();
  if (normalizedExplicit?.startsWith("image/") || normalizedExplicit?.startsWith("video/")) {
    return explicitContentType!;
  }

  try {
    const pathname = new URL(mediaUrl).pathname.toLowerCase();

    if (mediaType === "video") {
      if (pathname.endsWith(".webm")) return "video/webm";
      if (pathname.endsWith(".ogg")) return "video/ogg";
      if (pathname.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
      return "video/mp4";
    }

    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".gif")) return "image/gif";
    if (pathname.endsWith(".svg")) return "image/svg+xml";
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  } catch {
    // Fall back below.
  }

  return mediaType === "video" ? "video/mp4" : "image/jpeg";
}

function extensionFromContentType(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/apng":
      return "apng";
    case "image/svg+xml":
      return "svg";
    case "video/webm":
      return "webm";
    case "video/ogg":
      return "ogg";
    case "application/vnd.apple.mpegurl":
      return "m3u8";
    default:
      return mime.startsWith("video/") ? "mp4" : "jpg";
  }
}

function inferMediaFilename(
  mediaUrl: string,
  contentType: string,
  fallbackBase: string,
): string {
  try {
    const pathname = new URL(mediaUrl).pathname;
    const rawName = pathname.split("/").filter(Boolean).pop();
    if (rawName && rawName.includes(".")) {
      return decodeURIComponent(rawName);
    }
  } catch {
    // Fall back below.
  }

  return `${fallbackBase}.${extensionFromContentType(contentType)}`;
}

function pushEmbedMediaItem(
  items: MediaItem[],
  seen: Set<string>,
  row: Record<string, unknown>,
  media: EmbedMedia,
  sourceUrl: string | undefined,
  fallbackThumbnailUrl: string | undefined,
  fallbackKey: string,
): void {
  const mediaUrl = media.url?.trim();
  if (!mediaUrl) return;

  const dedupeKey = `${media.type}:${normalizeMediaKey(mediaUrl)}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);

  const contentType = inferMediaContentType(media.type, mediaUrl, media.contentType);
  items.push({
    id: `${row.message_id as string}:${fallbackKey}:${items.length}`,
    message_id: row.message_id as string,
    filename: inferMediaFilename(mediaUrl, contentType, fallbackKey),
    file_key: mediaUrl,
    url: mediaUrl,
    source_url: sourceUrl ?? null,
    content_type: contentType,
    size_bytes: 0,
    source_kind: "embed",
    thumbnail_url: media.type === "video" ? (media.thumbnailUrl ?? fallbackThumbnailUrl ?? null) : null,
    is_gif: media.isGif ?? false,
    author: {
      id: row.author_id as string,
      username: (row.author_username as string) ?? "Unknown",
      display_name: (row.author_display_name as string) ?? null,
      avatar_url: (row.author_avatar_url as string) ?? null,
    },
    created_at: row.created_at as string,
  });
}

function collectEmbedMedia(
  items: MediaItem[],
  seen: Set<string>,
  row: Record<string, unknown>,
  embed: EmbedInfo,
  fallbackPrefix: string,
): void {
  if (Array.isArray(embed.media) && embed.media.length > 0) {
    embed.media.forEach((media, index) => {
      pushEmbedMediaItem(items, seen, row, media, embed.url, embed.thumbnail?.url, `${fallbackPrefix}-media-${index + 1}`);
    });
    return;
  }

  if (embed.video?.url && embed.video.kind !== "player") {
    pushEmbedMediaItem(items, seen, row, {
      type: "video",
      url: embed.video.url,
      contentType: embed.video.contentType,
      width: embed.video.width,
      height: embed.video.height,
      thumbnailUrl: embed.thumbnail?.url,
    }, embed.url, embed.thumbnail?.url, `${fallbackPrefix}-video`);
    return;
  }

  if (embed.type === "image" && embed.url) {
    pushEmbedMediaItem(items, seen, row, {
      type: "image",
      url: embed.url,
      width: embed.thumbnail?.width,
      height: embed.thumbnail?.height,
    }, embed.url, embed.thumbnail?.url, `${fallbackPrefix}-image`);
  }
}

function extractEmbeddedMediaRows(row: Record<string, unknown>): MediaItem[] {
  const embeds = parseEmbeds(row.embeds);
  const items: MediaItem[] = [];
  const seen = new Set<string>();

  embeds.forEach((embed, embedIndex) => {
    const embedKey = embed.id || `embed-${embedIndex + 1}`;
    collectEmbedMedia(items, seen, row, embed, embedKey);

    const referencedMedia = embed.referencedTweet?.media;
    if (Array.isArray(referencedMedia) && referencedMedia.length > 0) {
      referencedMedia.forEach((media, mediaIndex) => {
        pushEmbedMediaItem(
          items,
          seen,
          row,
          media,
          embed.referencedTweet?.url,
          undefined,
          `${embedKey}-referenced-${mediaIndex + 1}`,
        );
      });
    }
  });

  return items;
}
