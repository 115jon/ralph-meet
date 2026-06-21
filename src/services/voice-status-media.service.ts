import type { D1Database } from "@cloudflare/workers-types";
import { genId } from "@/lib/api-helpers";
import {
  buildVoiceStatusMediaAsset,
  buildVoiceStatusMediaStorageKey,
} from "@/lib/voice-status-media";
import type { VoiceChannelStatusMedia, VoiceChannelStatusMediaAsset } from "@/lib/types";

type VoiceStatusMediaAssetRow = {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  filename: string;
  file_key: string;
  content_type: VoiceChannelStatusMedia["preview_content_type"];
  preview_width: number;
  preview_height: number;
  size_bytes: number;
  created_at: string;
};

function mapVoiceStatusMediaAsset(row: VoiceStatusMediaAssetRow): VoiceChannelStatusMediaAsset {
  return buildVoiceStatusMediaAsset({
    id: row.id,
    server_id: row.server_id,
    channel_id: row.channel_id,
    user_id: row.user_id,
    filename: row.filename,
    file_key: row.file_key,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    preview_width: row.preview_width,
    preview_height: row.preview_height,
    created_at: row.created_at,
  });
}

export async function createVoiceStatusMediaAsset(
  db: D1Database,
  input: {
    assetId?: string;
    fileKey?: string;
    serverId: string;
    channelId: string;
    userId: string;
    filename: string;
    contentType: VoiceChannelStatusMedia["preview_content_type"];
    previewWidth: number;
    previewHeight: number;
    sizeBytes: number;
    createdAt?: string;
  },
): Promise<VoiceChannelStatusMediaAsset & { fileKey: string }> {
  const id = input.assetId ?? genId();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const fileKey = input.fileKey ?? buildVoiceStatusMediaStorageKey(input.serverId, id, input.filename);

  await db.prepare(
    `INSERT INTO voice_status_media_assets (
      id,
      server_id,
      channel_id,
      user_id,
      filename,
      file_key,
      content_type,
      preview_width,
      preview_height,
      size_bytes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    input.serverId,
    input.channelId,
    input.userId,
    input.filename,
    fileKey,
    input.contentType,
    Math.max(1, Math.round(input.previewWidth)),
    Math.max(1, Math.round(input.previewHeight)),
    input.sizeBytes,
    createdAt,
  ).run();

  return {
    ...buildVoiceStatusMediaAsset({
      id,
      server_id: input.serverId,
      channel_id: input.channelId,
      user_id: input.userId,
      filename: input.filename,
      file_key: fileKey,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      preview_width: input.previewWidth,
      preview_height: input.previewHeight,
      created_at: createdAt,
    }),
    fileKey,
  };
}

export async function listRecentVoiceStatusMediaAssets(
  db: D1Database,
  serverId: string,
  limit: number,
): Promise<VoiceChannelStatusMediaAsset[]> {
  const { results } = await db.prepare(
    `SELECT
      id,
      server_id,
      channel_id,
      user_id,
      filename,
      file_key,
      content_type,
      preview_width,
      preview_height,
      size_bytes,
      created_at
     FROM voice_status_media_assets
     WHERE server_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(serverId, limit).all();

  return ((results ?? []) as VoiceStatusMediaAssetRow[]).map(mapVoiceStatusMediaAsset);
}

export async function getVoiceStatusMediaAssetById(
  db: D1Database,
  assetId: string,
): Promise<(VoiceChannelStatusMediaAsset & { fileKey: string }) | null> {
  const row = await db.prepare(
    `SELECT
      id,
      server_id,
      channel_id,
      user_id,
      filename,
      file_key,
      content_type,
      preview_width,
      preview_height,
      size_bytes,
      created_at
     FROM voice_status_media_assets
     WHERE id = ?`
  ).bind(assetId).first<VoiceStatusMediaAssetRow>();

  if (!row) return null;

  return {
    ...mapVoiceStatusMediaAsset(row),
    fileKey: row.file_key,
  };
}

export async function getVoiceStatusMediaAssetByFileKey(
  db: D1Database,
  fileKey: string,
): Promise<(VoiceChannelStatusMediaAsset & { fileKey: string }) | null> {
  const row = await db.prepare(
    `SELECT
      id,
      server_id,
      channel_id,
      user_id,
      filename,
      file_key,
      content_type,
      preview_width,
      preview_height,
      size_bytes,
      created_at
     FROM voice_status_media_assets
     WHERE file_key = ?`
  ).bind(fileKey).first<VoiceStatusMediaAssetRow>();

  if (!row) return null;

  return {
    ...mapVoiceStatusMediaAsset(row),
    fileKey: row.file_key,
  };
}

export async function createOrReuseExternalVoiceStatusMediaAsset(
  db: D1Database,
  input: {
    assetId?: string;
    fileKey: string;
    serverId: string;
    channelId: string;
    userId: string;
    filename: string;
    contentType: VoiceChannelStatusMedia["preview_content_type"];
    previewWidth: number;
    previewHeight: number;
    sizeBytes: number;
    createdAt?: string;
  },
): Promise<VoiceChannelStatusMediaAsset & { fileKey: string }> {
  const existing = await getVoiceStatusMediaAssetByFileKey(db, input.fileKey);
  if (existing) return existing;

  return createVoiceStatusMediaAsset(db, input);
}
