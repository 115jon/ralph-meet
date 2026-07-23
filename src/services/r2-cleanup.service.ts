interface R2CleanupJobRow {
  file_key: string;
  attempts: number;
}

export interface R2CleanupTask {
  fileKey: string;
}

const R2_CLEANUP_RETRY_LIMIT = 100;
const R2_CLEANUP_MAX_ATTEMPTS = 10;
const R2_CLEANUP_BASE_DELAY_MS = 60_000;
const R2_CLEANUP_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

function nextAttemptAt(attempt: number, now = Date.now()): string {
  const delay = Math.min(
    R2_CLEANUP_MAX_DELAY_MS,
    R2_CLEANUP_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
  return new Date(now + delay).toISOString();
}

export async function processR2CleanupTask(
  db: D1Database,
  bucket: R2Bucket,
  task: R2CleanupTask,
): Promise<void> {
  await bucket.delete(task.fileKey);
  await db
    .prepare("DELETE FROM r2_cleanup_jobs WHERE file_key = ?")
    .bind(task.fileKey)
    .run();
}

export async function recordR2CleanupFailure(
  db: D1Database,
  fileKey: string,
  error: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const existing = (await db
    .prepare("SELECT attempts FROM r2_cleanup_jobs WHERE file_key = ?")
    .bind(fileKey)
    .first()) as { attempts: number } | null;
  const attempts = Math.min(
    R2_CLEANUP_MAX_ATTEMPTS,
    Number(existing?.attempts ?? 0) + 1,
  );
  const nextAttempt = nextAttemptAt(attempts, Date.parse(now));
  await db
    .prepare(
      `INSERT INTO r2_cleanup_jobs
         (file_key, attempts, last_error, created_at, updated_at, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_key) DO UPDATE SET
         attempts = excluded.attempts,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at,
         next_attempt_at = excluded.next_attempt_at`,
    )
    .bind(fileKey, attempts, message, now, now, nextAttempt)
    .run();
}

export async function retryR2Cleanup(
  db: D1Database,
  bucket: R2Bucket,
  limit = R2_CLEANUP_RETRY_LIMIT,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT file_key, attempts
       FROM r2_cleanup_jobs
       WHERE attempts < ?
         AND COALESCE(next_attempt_at, '') <= ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(
      R2_CLEANUP_MAX_ATTEMPTS,
      new Date().toISOString(),
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
      const attempts = Math.min(
        R2_CLEANUP_MAX_ATTEMPTS,
        Number(row.attempts || 0) + 1,
      );
      const nextAttempt = nextAttemptAt(attempts, Date.parse(now));
      await db
        .prepare(
          `UPDATE r2_cleanup_jobs
           SET attempts = ?, last_error = ?, updated_at = ?, next_attempt_at = ?
           WHERE file_key = ?`,
        )
        .bind(attempts, message, now, nextAttempt, row.file_key)
        .run();
    }
  }
}
