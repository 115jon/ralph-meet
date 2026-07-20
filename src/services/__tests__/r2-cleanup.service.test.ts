import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { recordR2CleanupFailure, retryR2Cleanup } from "../r2-cleanup.service";

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
});
