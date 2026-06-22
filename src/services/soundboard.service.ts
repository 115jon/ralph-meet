import { CacheKey } from "@/lib/cache";
import { getAttachmentUrl } from "@/lib/attachment-url";
import type { D1Database } from "@cloudflare/workers-types";

export interface ServerSoundboardSound {
  id: string;
  server_id: string;
  user_id: string;
  filename: string;
  file_key: string;
  file_url: string;
  content_type: string;
  size_bytes: number;
  name: string;
  emoji?: string;
  volume: number;
  created_at: string;
}

export async function listServerSoundboardSounds(
  db: D1Database,
  serverId: string
): Promise<ServerSoundboardSound[]> {
  const { results } = await db
    .prepare(
      `SELECT
         a.id,
         a.soundboard_server_id AS server_id,
         a.user_id,
         a.filename,
         a.file_key,
         a.content_type,
         a.size_bytes,
         a.created_at,
         a.sound_name,
         a.sound_emoji,
         COALESCE(a.sound_volume, 1.0) AS sound_volume
       FROM attachments a
       WHERE a.soundboard_server_id = ?
       ORDER BY a.created_at DESC`
    )
    .bind(serverId)
    .all();

  return (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    server_id: row.server_id as string,
    user_id: row.user_id as string,
    filename: row.filename as string,
    file_key: row.file_key as string,
    file_url: getAttachmentUrl(row.file_key as string),
    content_type: row.content_type as string,
    size_bytes: Number(row.size_bytes ?? 0),
    name: row.sound_name ? String(row.sound_name) : String(row.filename ?? "Sound").replace(/\.[^.]+$/, ""),
    emoji: row.sound_emoji ? String(row.sound_emoji) : undefined,
    volume: Number(row.sound_volume ?? 1.0),
    created_at: row.created_at as string,
  }));
}

export function soundboardCacheKey(serverId: string) {
  return CacheKey.serverSoundboard(serverId);
}
