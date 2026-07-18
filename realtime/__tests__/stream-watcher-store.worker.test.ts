import { describe, expect, it } from "vitest";
import {
  StreamWatcherStore,
  type StreamWatcherSql,
} from "../voice-room/stream-watcher-store";

class RecordingSql implements StreamWatcherSql {
  readonly calls: Array<{ query: string; params: unknown[] }> = [];
  readonly rows: Array<Record<string, unknown>> = [];

  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T> {
    this.calls.push({ query, params });
    if (query.includes("ORDER BY created_at ASC")) return this.rows as T[];
    if (query.includes("SELECT 1"))
      return this.rows.length > 0 ? ([{}] as T[]) : [];
    return [] as T[];
  }
}

describe("StreamWatcherStore", () => {
  it("returns an ordered watcher snapshot grouped by streamer", () => {
    const sql = new RecordingSql();
    sql.rows.push(
      { streamer_user_id: "streamer-1", viewer_user_id: "viewer-1" },
      { streamer_user_id: "streamer-1", viewer_user_id: "viewer-2" },
      { streamer_user_id: "streamer-2", viewer_user_id: "viewer-3" },
    );

    expect(new StreamWatcherStore(sql).snapshot()).toEqual({
      "streamer-1": ["viewer-1", "viewer-2"],
      "streamer-2": ["viewer-3"],
    });
  });

  it("upserts a watcher with participant IDs and creation time", () => {
    const sql = new RecordingSql();
    new StreamWatcherStore(sql).upsert({
      streamerUserId: "streamer-1",
      viewerUserId: "viewer-1",
      streamerParticipantId: "stream-pid",
      viewerParticipantId: "viewer-pid",
      createdAt: 123,
    });

    const insertCall = sql.calls.find(({ query }) =>
      query.includes("INSERT INTO"),
    );
    expect(insertCall?.query).toContain(
      "ON CONFLICT(streamer_user_id, viewer_user_id)",
    );
    expect(insertCall?.params).toEqual([
      "streamer-1",
      "viewer-1",
      "stream-pid",
      "viewer-pid",
      123,
    ]);
  });

  it("returns whether pair and directional clears changed persisted state", () => {
    const sql = new RecordingSql();
    sql.rows.push({
      streamer_user_id: "streamer-1",
      viewer_user_id: "viewer-1",
    });
    const store = new StreamWatcherStore(sql);

    expect(store.remove("streamer-1", "viewer-1")).toBe(true);
    expect(store.clearByViewer("viewer-1")).toBe(true);
    expect(store.clearByStreamer("streamer-1")).toBe(true);
    expect(
      sql.calls.filter(({ query }) => query.startsWith("DELETE")).length,
    ).toBe(3);
  });
});
