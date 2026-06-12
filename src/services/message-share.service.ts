import { getAttachmentUrl } from "@/lib/attachment-url";
import { ServiceError } from "@/lib/service-error";
import { isPlayableVideo } from "@/lib/media";
import type { Attachment, EmbedInfo } from "@/lib/types";
import type { D1Database } from "@cloudflare/workers-types";

const DEFAULT_SHARE_DAYS = 30;
const SHARE_TOKEN_BYTES = 24;

export interface ShareAuthorSnapshot {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ShareReactionSnapshot {
  emoji: string;
  count: number;
}

export interface MessageShareSnapshot {
  content: string;
  author: ShareAuthorSnapshot;
  attachments: Attachment[];
  omitted_attachment_count: number;
  embeds: EmbedInfo[];
  reactions: ShareReactionSnapshot[];
  reply_count: number;
  created_at: string;
  updated_at: string | null;
  source?: {
    server_name: string | null;
    channel_name: string | null;
  };
}

export interface MessageShare {
  id: string;
  token: string;
  source_message_id: string;
  source_channel_id: string;
  source_server_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  status: "active" | "revoked" | "deleted" | "expired";
  view_count: number;
  allow_indexing: boolean;
  original_edited: boolean;
  snapshot: MessageShareSnapshot;
}

interface CreateMessageShareOptions {
  messageId: string;
  createdBy: string;
  expiresAt?: string | null;
  now?: Date;
  genId?: () => string;
  genToken?: () => string;
}

interface MessageSourceRow {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  embeds: string | null;
  reply_count: number | null;
  server_id: string | null;
  server_name: string | null;
  server_allow_public_shares?: number | null;
  server_show_source_in_shares?: number | null;
  server_allow_share_indexing?: number | null;
  channel_type: string;
  channel_name: string;
  channel_allow_public_shares?: number | null;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function makeToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isPublicShareAllowed(row: MessageSourceRow): boolean {
  if (!row.server_id || row.channel_type === "dm") return false;
  if (row.channel_allow_public_shares !== null && row.channel_allow_public_shares !== undefined) {
    return row.channel_allow_public_shares === 1;
  }
  return row.server_allow_public_shares !== 0;
}

async function getMessageSourceRow(
  db: D1Database,
  messageId: string
): Promise<MessageSourceRow> {
  const row = await db.prepare(
    `SELECT m.id, m.channel_id, m.author_id, m.content, m.created_at, m.updated_at, m.embeds,
            c.server_id, c.name as channel_name, c.channel_type, c.allow_public_shares as channel_allow_public_shares,
            s.name as server_name, s.allow_public_shares as server_allow_public_shares,
            s.show_source_in_shares as server_show_source_in_shares,
            s.allow_share_indexing as server_allow_share_indexing,
            u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            (SELECT COUNT(*) FROM messages r WHERE r.reply_to_id = m.id) as reply_count
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     LEFT JOIN servers s ON s.id = c.server_id
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.id = ?`
  ).bind(messageId).first() as MessageSourceRow | null;

  if (!row) {
    throw ServiceError.notFound("Message not found");
  }
  return row;
}

function isShareableAttachment(contentType: unknown): contentType is string {
  return typeof contentType === "string" && (
    contentType.startsWith("image/") ||
    isPlayableVideo(contentType)
  );
}

async function getShareableAttachments(db: D1Database, messageId: string): Promise<{
  attachments: Attachment[];
  omittedAttachmentCount: number;
}> {
  const { results } = await db.prepare(
    `SELECT id, filename, file_key, content_type, size_bytes
     FROM attachments
     WHERE message_id = ?
     ORDER BY created_at ASC`
  ).bind(messageId).all();

  const rows = (results ?? []) as Array<Record<string, unknown>>;
  const attachments = rows
    .filter((row) => isShareableAttachment(row.content_type))
    .map((row) => ({
      id: row.id as string,
      filename: row.filename as string,
      file_key: row.file_key as string,
      content_type: row.content_type as string,
      size_bytes: row.size_bytes as number,
      url: getAttachmentUrl(row.file_key as string),
    }));

  return {
    attachments,
    omittedAttachmentCount: rows.length - attachments.length,
  };
}

async function getReactionCounts(
  db: D1Database,
  messageId: string
): Promise<ShareReactionSnapshot[]> {
  const { results } = await db.prepare(
    `SELECT emoji, COUNT(*) as count
     FROM message_reactions
     WHERE message_id = ?
     GROUP BY emoji
     ORDER BY count DESC, emoji ASC`
  ).bind(messageId).all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    emoji: row.emoji as string,
    count: row.count as number,
  }));
}

export async function createMessageShare(
  db: D1Database,
  opts: CreateMessageShareOptions
): Promise<MessageShare> {
  const now = opts.now ?? new Date();
  const source = await getMessageSourceRow(db, opts.messageId);

  if (!isPublicShareAllowed(source)) {
    throw ServiceError.forbidden("Public sharing is disabled for this message");
  }

  const [{ attachments, omittedAttachmentCount }, reactions] = await Promise.all([
    getShareableAttachments(db, opts.messageId),
    getReactionCounts(db, opts.messageId),
  ]);

  const author: ShareAuthorSnapshot = {
    id: source.author_id,
    username: source.author_username ?? "Unknown",
    display_name: source.author_display_name ?? null,
    avatar_url: source.author_avatar_url ?? null,
  };
  const showSource = source.server_show_source_in_shares === 1;
  const snapshot: MessageShareSnapshot = {
    content: source.content,
    author,
    attachments,
    omitted_attachment_count: omittedAttachmentCount,
    embeds: safeJson<EmbedInfo[]>(source.embeds, []),
    reactions,
    reply_count: source.reply_count ?? 0,
    created_at: source.created_at,
    updated_at: source.updated_at,
    ...(showSource ? {
      source: {
        server_name: source.server_name,
        channel_name: source.channel_name,
      },
    } : {}),
  };

  const id = opts.genId?.() ?? crypto.randomUUID();
  const token = opts.genToken?.() ?? makeToken();
  const createdAt = now.toISOString();
  const expiresAt = opts.expiresAt === undefined
    ? addDays(now, DEFAULT_SHARE_DAYS).toISOString()
    : opts.expiresAt;
  const allowIndexing = source.server_allow_share_indexing === 1;

  await db.prepare(
    `INSERT INTO message_shares (
       id, token, source_message_id, source_channel_id, source_server_id,
       created_by, snapshot_content, snapshot_author, snapshot_attachments,
       snapshot_embeds, snapshot_reactions, omitted_attachment_count,
       reply_count, allow_indexing, created_at, expires_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(
    id,
    token,
    source.id,
    source.channel_id,
    source.server_id,
    opts.createdBy,
    snapshot.content,
    JSON.stringify(snapshot.author),
    JSON.stringify(snapshot.attachments),
    JSON.stringify(snapshot.embeds),
    JSON.stringify(snapshot.reactions),
    snapshot.omitted_attachment_count,
    snapshot.reply_count,
    allowIndexing ? 1 : 0,
    createdAt,
    expiresAt
  ).run();

  return {
    id,
    token,
    source_message_id: source.id,
    source_channel_id: source.channel_id,
    source_server_id: source.server_id!,
    created_by: opts.createdBy,
    created_at: createdAt,
    expires_at: expiresAt,
    status: "active",
    view_count: 0,
    allow_indexing: allowIndexing,
    original_edited: false,
    snapshot,
  };
}

export async function getPublicMessageShare(
  db: D1Database,
  token: string,
  now = new Date(),
  opts: { incrementView?: boolean } = {}
): Promise<MessageShare> {
  const row = await db.prepare(
    `SELECT ms.*, m.updated_at as current_updated_at
     FROM message_shares ms
     LEFT JOIN messages m ON m.id = ms.source_message_id
     WHERE ms.token = ?`
  ).bind(token).first() as Record<string, unknown> | null;

  if (!row) {
    throw ServiceError.notFound("Share not found");
  }

  const expiresAt = row.expires_at as string | null;
  const status = row.status as MessageShare["status"];
  if (
    status !== "active" ||
    row.revoked_at ||
    row.deleted_at ||
    (expiresAt && new Date(expiresAt).getTime() <= now.getTime())
  ) {
    throw new ServiceError("Share is gone", 410, "SHARE_GONE");
  }

  const incrementView = opts.incrementView ?? true;
  if (incrementView) {
    await db.prepare(
      `UPDATE message_shares SET view_count = view_count + 1 WHERE token = ?`
    ).bind(token).run();
  }

  const snapshotAuthor = safeJson<ShareAuthorSnapshot>(row.snapshot_author, {
    id: "",
    username: "Unknown",
    display_name: null,
    avatar_url: null,
  });
  const snapshot: MessageShareSnapshot = {
    content: row.snapshot_content as string,
    author: snapshotAuthor,
    attachments: safeJson<Attachment[]>(row.snapshot_attachments, []),
    omitted_attachment_count: (row.omitted_attachment_count as number) ?? 0,
    embeds: safeJson<EmbedInfo[]>(row.snapshot_embeds, []),
    reactions: safeJson<ShareReactionSnapshot[]>(row.snapshot_reactions, []),
    reply_count: (row.reply_count as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: null,
  };

  return {
    id: row.id as string,
    token: row.token as string,
    source_message_id: row.source_message_id as string,
    source_channel_id: row.source_channel_id as string,
    source_server_id: row.source_server_id as string,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    expires_at: expiresAt,
    status,
    view_count: ((row.view_count as number) ?? 0) + (incrementView ? 1 : 0),
    allow_indexing: row.allow_indexing === 1,
    original_edited: !!row.current_updated_at,
    snapshot,
  };
}

export async function listUserMessageShares(
  db: D1Database,
  userId: string
): Promise<Array<{
  id: string;
  token: string;
  source_message_id: string;
  content: string;
  author: ShareAuthorSnapshot;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  status: MessageShare["status"];
  view_count: number;
}>> {
  const { results } = await db.prepare(
    `SELECT id, token, source_message_id, snapshot_content, snapshot_author,
            created_at, expires_at, revoked_at, status, view_count
     FROM message_shares
     WHERE created_by = ?
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(userId).all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    token: row.token as string,
    source_message_id: row.source_message_id as string,
    content: row.snapshot_content as string,
    author: safeJson<ShareAuthorSnapshot>(row.snapshot_author, {
      id: "",
      username: "Unknown",
      display_name: null,
      avatar_url: null,
    }),
    created_at: row.created_at as string,
    expires_at: row.expires_at as string | null,
    revoked_at: row.revoked_at as string | null,
    status: row.status as MessageShare["status"],
    view_count: (row.view_count as number) ?? 0,
  }));
}

export async function revokeMessageShare(
  db: D1Database,
  shareId: string,
  userId: string,
  now = new Date()
): Promise<void> {
  await db.prepare(
    `UPDATE message_shares SET status = 'revoked', revoked_at = ? WHERE id = ? AND created_by = ?`
  ).bind(now.toISOString(), shareId, userId).run();
}

export async function markSharesDeletedForMessage(
  db: D1Database,
  messageId: string,
  now = new Date()
): Promise<void> {
  await db.prepare(
    `UPDATE message_shares SET status = 'deleted', deleted_at = ? WHERE source_message_id = ? AND status = 'active'`
  ).bind(now.toISOString(), messageId).run();
}
