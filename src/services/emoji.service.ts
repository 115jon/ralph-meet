import type { D1Database } from "@cloudflare/workers-types";

import {
  buildCustomEmojiToken,
  buildGeneratedEmojiAssetPath,
  type GeneratedEmoji,
  type GeneratedEmojiStatus,
} from "@/lib/emoji";

type GeneratedEmojiRow = {
  id: string;
  user_id: string;
  shortcode: string;
  prompt: string;
  file_key: string | null;
  content_type: string | null;
  size_bytes: number;
  status: GeneratedEmojiStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
};

export type GeneratedEmojiAssetRecord = GeneratedEmoji & {
  fileKey: string | null;
};

function mapGeneratedEmoji(row: GeneratedEmojiRow): GeneratedEmoji {
  return {
    id: row.id,
    user_id: row.user_id,
    shortcode: row.shortcode,
    prompt: row.prompt,
    status: row.status,
    image_url: row.file_key ? buildGeneratedEmojiAssetPath(row.id) : null,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    error_message: row.error_message,
    token: buildCustomEmojiToken(row.shortcode, row.id),
  };
}

function withAssetRecord(row: GeneratedEmojiRow): GeneratedEmojiAssetRecord {
  return {
    ...mapGeneratedEmoji(row),
    fileKey: row.file_key,
  };
}

export async function createGeneratedEmoji(
  db: D1Database,
  input: {
    id: string;
    userId: string;
    shortcode: string;
    prompt: string;
    status?: GeneratedEmojiStatus;
    createdAt?: string;
    updatedAt?: string | null;
  },
): Promise<GeneratedEmoji> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  const status = input.status ?? "pending";

  await db.prepare(
    `INSERT INTO generated_emojis (
      id,
      user_id,
      shortcode,
      prompt,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.id,
    input.userId,
    input.shortcode,
    input.prompt,
    status,
    createdAt,
    updatedAt,
  ).run();

  return {
    id: input.id,
    user_id: input.userId,
    shortcode: input.shortcode,
    prompt: input.prompt,
    status,
    image_url: null,
    content_type: null,
    size_bytes: 0,
    created_at: createdAt,
    updated_at: updatedAt,
    error_message: null,
    token: buildCustomEmojiToken(input.shortcode, input.id),
  };
}

export async function markGeneratedEmojiReady(
  db: D1Database,
  input: {
    id: string;
    fileKey: string;
    contentType: string;
    sizeBytes: number;
    updatedAt?: string;
  },
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  await db.prepare(
    `UPDATE generated_emojis
     SET file_key = ?,
         content_type = ?,
         size_bytes = ?,
         status = 'ready',
         error_message = NULL,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    input.fileKey,
    input.contentType,
    input.sizeBytes,
    updatedAt,
    input.id,
  ).run();
}

export async function markGeneratedEmojiFailed(
  db: D1Database,
  input: {
    id: string;
    errorMessage?: string | null;
    updatedAt?: string;
  },
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  await db.prepare(
    `UPDATE generated_emojis
     SET status = 'failed',
         error_message = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    input.errorMessage ?? "Generation failed",
    updatedAt,
    input.id,
  ).run();
}

export async function listUserGeneratedEmojis(
  db: D1Database,
  userId: string,
  limit = 48,
): Promise<GeneratedEmoji[]> {
  const { results } = await db.prepare(
    `SELECT
      id,
      user_id,
      shortcode,
      prompt,
      file_key,
      content_type,
      size_bytes,
      status,
      error_message,
      created_at,
      updated_at
     FROM generated_emojis
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(userId, limit).all();

  return ((results ?? []) as GeneratedEmojiRow[]).map(mapGeneratedEmoji);
}

export async function listGeneratedEmojisByIds(
  db: D1Database,
  ids: string[],
): Promise<GeneratedEmoji[]> {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db.prepare(
    `SELECT
      id,
      user_id,
      shortcode,
      prompt,
      file_key,
      content_type,
      size_bytes,
      status,
      error_message,
      created_at,
      updated_at
     FROM generated_emojis
     WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  const byId = new Map<string, GeneratedEmoji>();
  for (const row of (results ?? []) as GeneratedEmojiRow[]) {
    byId.set(row.id, mapGeneratedEmoji(row));
  }

  return ids.map((id) => byId.get(id)).filter((item): item is GeneratedEmoji => Boolean(item));
}

export async function getGeneratedEmojiAssetById(
  db: D1Database,
  id: string,
): Promise<GeneratedEmojiAssetRecord | null> {
  const row = await db.prepare(
    `SELECT
      id,
      user_id,
      shortcode,
      prompt,
      file_key,
      content_type,
      size_bytes,
      status,
      error_message,
      created_at,
      updated_at
     FROM generated_emojis
     WHERE id = ?`
  ).bind(id).first<GeneratedEmojiRow>();

  return row ? withAssetRecord(row) : null;
}
