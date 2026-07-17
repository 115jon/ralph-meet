import { describe, expect, it } from "vitest";
import {
  ListenTogetherStore,
  type ListenTogetherSql,
} from "../voice-room/listen-together-store";

class RecordingSql implements ListenTogetherSql {
  readonly calls: Array<{ query: string; params: unknown[] }> = [];
  readonly rows: Array<Record<string, unknown>> = [];

  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T> {
    this.calls.push({ query, params });
    if (query.includes("FROM listen_together_state"))
      return this.rows.slice(0, 1) as T[];
    if (query.includes("FROM listen_together_queue")) return this.rows as T[];
    return [] as T[];
  }
}

describe("ListenTogetherStore", () => {
  it("creates and persists an initial state when storage is empty", () => {
    const sql = new RecordingSql();
    const store = new ListenTogetherStore(sql, () => "room-1");

    expect(store.loadState()).toMatchObject({
      roomSlug: "room-1",
      revision: 0,
      paused: true,
    });
    expect(
      sql.calls.some(({ query }) =>
        query.includes("INSERT INTO listen_together_state"),
      ),
    ).toBe(true);
  });

  it("loads and persists bounded recently played state", () => {
    const sql = new RecordingSql();
    sql.rows.push({
      room_slug: "room-1",
      revision: 3,
      paused: 0,
      current_entry_id: "entry-1",
      anchor_position_ms: 0,
      anchor_updated_at: 1_000,
      last_updated_at: 1_000,
      recently_played_json: JSON.stringify([
        {
          historyId: "history-1",
          playedAt: 1_000,
          entry: {
            entryId: "entry-1",
            requestedAt: 900,
            requester: { userId: "user-1", displayName: "Alice" },
            track: {
              kind: "music",
              id: "track-1",
              provider: "youtube",
              title: "Track",
              sourceLabel: "YouTube",
            },
          },
        },
        {
          historyId: "malformed",
          playedAt: 1_000,
          entry: { entryId: "entry-2", track: { title: "Incomplete" } },
        },
      ]),
    });
    const store = new ListenTogetherStore(sql, () => "room-1");

    expect(store.loadState().recentlyPlayed).toMatchObject([
      { historyId: "history-1", entry: { entryId: "entry-1" } },
    ]);
    store.saveState({
      roomSlug: "room-1",
      revision: 4,
      paused: true,
      currentEntryId: null,
      anchorPositionMs: 0,
      anchorUpdatedAt: 2_000,
      lastUpdatedAt: 2_000,
      recentlyPlayed: [],
    });
    expect(sql.calls.at(-1)?.params.at(-1)).toBe("[]");
  });

  it("normalizes legacy queue entries and ignores malformed rows", () => {
    const sql = new RecordingSql();
    sql.rows.push(
      {
        entry_json: JSON.stringify({
          entryId: "entry-1",
          track: { videoId: "abc" },
        }),
      },
      { entry_json: "invalid-json" },
    );
    const store = new ListenTogetherStore(sql, () => "room-1");

    expect(store.loadQueue()).toEqual([
      { entryId: "entry-1", track: { videoId: "abc", kind: "music" } },
    ]);
  });

  it("replaces queue rows in stable sort order", () => {
    const sql = new RecordingSql();
    const store = new ListenTogetherStore(sql, () => "room-1");

    store.saveQueue([
      { entryId: "entry-1", requestedAt: 10 } as never,
      { entryId: "entry-2", requestedAt: 20 } as never,
    ]);

    expect(
      sql.calls.filter(({ query }) =>
        query.includes("INSERT INTO listen_together_queue"),
      ),
    ).toHaveLength(2);
    expect(sql.calls.at(-1)?.params).toEqual([
      "entry-2",
      1,
      JSON.stringify({ entryId: "entry-2", requestedAt: 20 }),
      20,
    ]);
  });

  it("does not rewrite unchanged queue rows", () => {
    const sql = new RecordingSql();
    sql.rows.push({
      entry_id: "entry-1",
      sort_order: 0,
      entry_json: JSON.stringify({ entryId: "entry-1", requestedAt: 10 }),
      requested_at: 10,
    });
    const store = new ListenTogetherStore(sql, () => "room-1");

    store.saveQueue([{ entryId: "entry-1", requestedAt: 10 } as never]);

    expect(
      sql.calls.filter(({ query }) =>
        query.includes("INSERT INTO listen_together_queue"),
      ),
    ).toHaveLength(0);
    expect(
      sql.calls.filter(({ query }) =>
        query.startsWith("DELETE FROM listen_together_queue WHERE"),
      ),
    ).toHaveLength(0);
  });
});
