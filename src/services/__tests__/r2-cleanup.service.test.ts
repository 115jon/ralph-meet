import { describe, expect, it, vi } from "vitest";
import {
  processR2CleanupTask,
  recordR2CleanupFailure,
  retryR2Cleanup,
} from "../r2-cleanup.service";

describe("R2 cleanup outbox", () => {
  it("retains a failed key and removes it after a later retry", async () => {
    const key = "attachments/channel-1/attachment-1/file.txt";
    let queued = false;
    let attempts = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind(..._bindings: unknown[]) {
            return {
              async first() {
                return null;
              },
              async all() {
                return {
                  results:
                    queued && sql.includes("SELECT file_key")
                      ? [{ file_key: key }]
                      : [],
                };
              },
              async run() {
                if (sql.includes("INSERT INTO r2_cleanup_jobs")) queued = true;
                if (sql.includes("DELETE FROM r2_cleanup_jobs")) queued = false;
                if (sql.includes("UPDATE r2_cleanup_jobs")) attempts += 1;
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const bucket = {
      delete: vi
        .fn()
        .mockRejectedValueOnce(new Error("R2 unavailable"))
        .mockResolvedValueOnce(undefined),
    } as unknown as R2Bucket;

    await recordR2CleanupFailure(db, key, new Error("R2 unavailable"));
    await retryR2Cleanup(db, bucket);

    expect(queued).toBe(true);
    expect(attempts).toBe(1);

    await retryR2Cleanup(db, bucket);

    expect(bucket.delete).toHaveBeenCalledTimes(2);
    expect(queued).toBe(false);
  });

  it("retries a queued failure and removes only its successful outbox row", async () => {
    const key = "attachments/channel-1/failure-only.txt";
    const deleteRow = vi.fn(async () => ({ success: true }));
    const db = {
      prepare(sql: string) {
        return {
          bind(..._bindings: unknown[]) {
            return {
              async first() {
                return null;
              },
              async run() {
                if (sql.includes("DELETE FROM r2_cleanup_jobs"))
                  await deleteRow();
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const bucket = {
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;

    await processR2CleanupTask(db, bucket, { fileKey: key });

    expect(bucket.delete).toHaveBeenCalledWith(key);
    expect(deleteRow).toHaveBeenCalledOnce();
  });

  it("records a delayed next attempt for a bounded retry schedule", async () => {
    let insertSql = "";
    let insertBindings: unknown[] = [];
    const db = {
      prepare(sql: string) {
        insertSql = sql.includes("INSERT INTO r2_cleanup_jobs")
          ? sql
          : insertSql;
        return {
          bind(...bindings: unknown[]) {
            if (sql.includes("INSERT INTO r2_cleanup_jobs")) {
              insertBindings = bindings;
            }
            return {
              async first() {
                return null;
              },
              async run() {
                return { success: true };
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await recordR2CleanupFailure(
      db,
      "attachments/delayed.txt",
      new Error("R2 unavailable"),
    );

    expect(insertSql).toContain("next_attempt_at");
    expect(insertBindings).toHaveLength(6);
    expect(String(insertBindings[5])).not.toBe(String(insertBindings[3]));
  });

  it("selects only due jobs below the finite retry limit", async () => {
    let selectSql = "";
    let selectBindings: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            if (sql.includes("SELECT file_key")) {
              selectSql = sql;
              selectBindings = bindings;
            }
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await retryR2Cleanup(db, {} as R2Bucket, 500);

    expect(selectSql).toContain("COALESCE(next_attempt_at, '') <= ?");
    expect(selectSql).toContain("attempts < ?");
    expect(selectBindings).toContain(10);
  });
});
