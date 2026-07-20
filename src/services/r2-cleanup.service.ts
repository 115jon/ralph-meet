import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

interface R2CleanupJobRow {
  file_key: string;
}

const R2_CLEANUP_RETRY_LIMIT = 100;

export async function recordR2CleanupFailure(
  db: D1Database,
  fileKey: string,
  error: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  await db
    .prepare(
      `INSERT INTO r2_cleanup_jobs
         (file_key, attempts, last_error, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(file_key) DO UPDATE SET
         attempts = attempts + 1,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
    )
    .bind(fileKey, message, now, now)
    .run();
}

export async function retryR2Cleanup(
  db: D1Database,
  bucket: R2Bucket,
  limit = R2_CLEANUP_RETRY_LIMIT,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT file_key
       FROM r2_cleanup_jobs
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(
      Number.isFinite(limit)
        ? Math.max(1, Math.min(R2_CLEANUP_RETRY_LIMIT, Math.floor(limit)))
        : R2_CLEANUP_RETRY_LIMIT,
    )
    .all<R2CleanupJobRow>();

  for (const row of results ?? []) {
    if (!row.file_key) continue;
    try {
      await bucket.delete(row.file_key);
      await db
        .prepare("DELETE FROM r2_cleanup_jobs WHERE file_key = ?")
        .bind(row.file_key)
        .run();
    } catch (error) {
      const now = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await db
        .prepare(
          `UPDATE r2_cleanup_jobs
           SET attempts = attempts + 1, last_error = ?, updated_at = ?
           WHERE file_key = ?`,
        )
        .bind(message, now, row.file_key)
        .run();
    }
  }
}
