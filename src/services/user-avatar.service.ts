import type { D1Database } from "@cloudflare/workers-types";

export const MAX_USER_AVATAR_UPLOADS = 6;

export interface UserAvatarUpload {
  id: string;
  user_id: string;
  file_key: string;
  avatar_url: string;
  content_type: string;
  pending_delete?: number;
  created_at: string;
}

export function getAvatarUploadPruneList(
  uploads: UserAvatarUpload[],
  maxUploads = MAX_USER_AVATAR_UPLOADS,
): UserAvatarUpload[] {
  return [...uploads]
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.id.localeCompare(left.id),
    )
    .slice(Math.max(0, maxUploads));
}

export async function listUserAvatarUploads(
  db: D1Database,
  userId: string,
  limit = MAX_USER_AVATAR_UPLOADS,
  includePending = false,
): Promise<UserAvatarUpload[]> {
  const limitClause = limit > 0 ? " LIMIT ?" : "";
  const pendingClause = includePending ? "" : " AND pending_delete = 0";
  const result = await db
    .prepare(
      `SELECT id, user_id, file_key, avatar_url, content_type, pending_delete, created_at
       FROM user_avatar_uploads
       WHERE user_id = ?${pendingClause}
       ORDER BY created_at DESC, id DESC
       ${limitClause}`,
    )
    .bind(...(limit > 0 ? [userId, limit] : [userId]))
    .all<UserAvatarUpload>();

  return result.results ?? [];
}

export async function findUserAvatarUpload(
  db: D1Database,
  userId: string,
  id: string,
  includePending = false,
): Promise<UserAvatarUpload | null> {
  const pendingClause = includePending ? "" : " AND pending_delete = 0";
  return db
    .prepare(
      `SELECT id, user_id, file_key, avatar_url, content_type, pending_delete, created_at
       FROM user_avatar_uploads
       WHERE user_id = ? AND id = ?${pendingClause}`,
    )
    .bind(userId, id)
    .first<UserAvatarUpload>();
}

export async function findUserAvatarUploadByUrl(
  db: D1Database,
  userId: string,
  avatarUrl: string,
): Promise<UserAvatarUpload | null> {
  return db
    .prepare(
      `SELECT id, user_id, file_key, avatar_url, content_type, pending_delete, created_at
       FROM user_avatar_uploads
       WHERE user_id = ? AND avatar_url = ? AND pending_delete = 0`,
    )
    .bind(userId, avatarUrl)
    .first<UserAvatarUpload>();
}

export async function createUserAvatarUpload(
  db: D1Database,
  upload: UserAvatarUpload,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_avatar_uploads
       (id, user_id, file_key, avatar_url, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      upload.id,
      upload.user_id,
      upload.file_key,
      upload.avatar_url,
      upload.content_type,
      upload.created_at,
    )
    .run();
}

export async function deleteUserAvatarUpload(
  db: D1Database,
  userId: string,
  id: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM user_avatar_uploads WHERE user_id = ? AND id = ?")
    .bind(userId, id)
    .run();
}

export async function markUserAvatarUploadPendingDeletion(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE user_avatar_uploads
       SET pending_delete = 1
       WHERE user_id = ? AND id = ? AND pending_delete = 0
         AND NOT EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND avatar_url = user_avatar_uploads.avatar_url
         )`,
    )
    .bind(userId, id, userId)
    .run();
  return result.meta.changes > 0;
}
