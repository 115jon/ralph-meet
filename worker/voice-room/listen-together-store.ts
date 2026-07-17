import {
  createListenTogetherState,
  LISTEN_TOGETHER_RECENTLY_PLAYED_LIMIT,
  type ListenTogetherMusicTrack,
  type ListenTogetherPersistentState,
  type ListenTogetherQueueEntry,
  type ListenTogetherRecentlyPlayedEntry,
} from "../../src/lib/listen-together";

export interface ListenTogetherSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T>;
}

export class ListenTogetherStore {
  constructor(
    private readonly sql: ListenTogetherSql,
    private readonly getRoomSlug: () => string,
  ) {}

  loadState(): ListenTogetherPersistentState {
    const row = [
      ...this.sql.exec(
        `SELECT room_slug, revision, paused, current_entry_id, anchor_position_ms, anchor_updated_at, last_updated_at, recently_played_json
         FROM listen_together_state
         WHERE id = 1`,
      ),
    ][0];

    if (!row) {
      const initial = createListenTogetherState(this.getRoomSlug());
      this.saveState(initial);
      return initial;
    }

    return {
      roomSlug: this.getRoomSlug() || String(row.room_slug ?? ""),
      revision: Number(row.revision ?? 0),
      paused: Number(row.paused ?? 1) === 1,
      currentEntryId:
        typeof row.current_entry_id === "string" ? row.current_entry_id : null,
      anchorPositionMs: Number(row.anchor_position_ms ?? 0),
      anchorUpdatedAt:
        typeof row.anchor_updated_at === "number" ||
        typeof row.anchor_updated_at === "string"
          ? Number(row.anchor_updated_at)
          : null,
      lastUpdatedAt: Number(row.last_updated_at ?? 0),
      recentlyPlayed: this.parseRecentlyPlayed(row.recently_played_json),
    };
  }

  private parseRecentlyPlayed(
    value: unknown,
  ): ListenTogetherRecentlyPlayedEntry[] {
    if (typeof value !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(this.isRecentlyPlayedEntry)
        .slice(0, LISTEN_TOGETHER_RECENTLY_PLAYED_LIMIT);
    } catch {
      return [];
    }
  }

  private isRecentlyPlayedEntry(
    item: unknown,
  ): item is ListenTogetherRecentlyPlayedEntry {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    const entry = candidate.entry;
    if (
      typeof candidate.historyId !== "string" ||
      typeof candidate.playedAt !== "number" ||
      !Number.isFinite(candidate.playedAt) ||
      !entry ||
      typeof entry !== "object"
    ) {
      return false;
    }

    const queueEntry = entry as Record<string, unknown>;
    const requester = queueEntry.requester;
    const track = queueEntry.track;
    if (
      typeof queueEntry.entryId !== "string" ||
      typeof queueEntry.requestedAt !== "number" ||
      !Number.isFinite(queueEntry.requestedAt) ||
      !requester ||
      typeof requester !== "object" ||
      !track ||
      typeof track !== "object"
    ) {
      return false;
    }

    const requesterRecord = requester as Record<string, unknown>;
    const trackRecord = track as Record<string, unknown>;
    return (
      typeof requesterRecord.userId === "string" &&
      typeof requesterRecord.displayName === "string" &&
      (trackRecord.kind === "music" || trackRecord.kind === "radio") &&
      typeof trackRecord.id === "string" &&
      typeof trackRecord.provider === "string" &&
      typeof trackRecord.title === "string" &&
      typeof trackRecord.sourceLabel === "string"
    );
  }

  saveState(state: ListenTogetherPersistentState) {
    this.sql.exec(
      `INSERT INTO listen_together_state (
         id,
         room_slug,
         revision,
         paused,
         current_entry_id,
         anchor_position_ms,
         anchor_updated_at,
         last_updated_at,
         recently_played_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         room_slug = excluded.room_slug,
         revision = excluded.revision,
         paused = excluded.paused,
         current_entry_id = excluded.current_entry_id,
          anchor_position_ms = excluded.anchor_position_ms,
          anchor_updated_at = excluded.anchor_updated_at,
          last_updated_at = excluded.last_updated_at,
          recently_played_json = excluded.recently_played_json`,
      1,
      state.roomSlug,
      state.revision,
      state.paused ? 1 : 0,
      state.currentEntryId,
      state.anchorPositionMs,
      state.anchorUpdatedAt,
      state.lastUpdatedAt,
      JSON.stringify(state.recentlyPlayed ?? []),
    );
  }

  loadQueue(): ListenTogetherQueueEntry[] {
    const queue: ListenTogetherQueueEntry[] = [];
    for (const row of this.sql.exec(
      `SELECT entry_json FROM listen_together_queue ORDER BY sort_order ASC`,
    )) {
      try {
        const parsed = JSON.parse(
          String(row.entry_json),
        ) as ListenTogetherQueueEntry;
        if (parsed?.entryId) {
          if (parsed.track && !parsed.track.kind) {
            (parsed.track as ListenTogetherMusicTrack).kind = "music";
          }
          queue.push(parsed);
        }
      } catch {
        // Ignore malformed persisted entries.
      }
    }
    return queue;
  }

  saveQueue(queue: ListenTogetherQueueEntry[]) {
    const existing = new Map<
      string,
      { sortOrder: number; entryJson: string; requestedAt: number }
    >();
    for (const row of this.sql.exec(
      `SELECT entry_id, sort_order, entry_json, requested_at
       FROM listen_together_queue`,
    )) {
      if (typeof row.entry_id !== "string") continue;
      existing.set(row.entry_id, {
        sortOrder: Number(row.sort_order),
        entryJson: String(row.entry_json),
        requestedAt: Number(row.requested_at),
      });
    }

    const nextIds = new Set(queue.map((entry) => entry.entryId));
    for (const entryId of existing.keys()) {
      if (!nextIds.has(entryId)) {
        this.sql.exec(
          "DELETE FROM listen_together_queue WHERE entry_id = ?",
          entryId,
        );
      }
    }

    queue.forEach((entry, index) => {
      const entryJson = JSON.stringify(entry);
      const previous = existing.get(entry.entryId);
      if (
        previous &&
        previous.sortOrder === index &&
        previous.entryJson === entryJson &&
        previous.requestedAt === entry.requestedAt
      ) {
        return;
      }

      this.sql.exec(
        `INSERT INTO listen_together_queue (entry_id, sort_order, entry_json, requested_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           sort_order = excluded.sort_order,
           entry_json = excluded.entry_json,
           requested_at = excluded.requested_at`,
        entry.entryId,
        index,
        entryJson,
        entry.requestedAt,
      );
    });
  }

  persist(
    state: ListenTogetherPersistentState,
    queue: ListenTogetherQueueEntry[],
  ) {
    this.saveState(state);
    this.saveQueue(queue);
  }
}
