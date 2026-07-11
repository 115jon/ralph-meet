export interface StreamWatcherSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T>;
}

export interface StreamWatcherUpsert {
  streamerUserId: string;
  viewerUserId: string;
  streamerParticipantId: string;
  viewerParticipantId: string;
  createdAt: number;
}

export class StreamWatcherStore {
  constructor(private readonly sql: StreamWatcherSql) {}

  snapshot(): Record<string, string[]> {
    const watchersByStreamer: Record<string, string[]> = {};
    for (const row of this.sql.exec(
      `SELECT streamer_user_id, viewer_user_id
       FROM stream_watchers
       ORDER BY created_at ASC, viewer_user_id ASC`,
    )) {
      const streamerUserId = row.streamer_user_id as string;
      const viewerUserId = row.viewer_user_id as string;
      if (!watchersByStreamer[streamerUserId]) {
        watchersByStreamer[streamerUserId] = [];
      }
      watchersByStreamer[streamerUserId].push(viewerUserId);
    }
    return watchersByStreamer;
  }

  upsert({
    streamerUserId,
    viewerUserId,
    streamerParticipantId,
    viewerParticipantId,
    createdAt,
  }: StreamWatcherUpsert) {
    const existing = [
      ...this.sql.exec(
        `SELECT streamer_participant_id, viewer_participant_id
         FROM stream_watchers
         WHERE streamer_user_id = ? AND viewer_user_id = ?`,
        streamerUserId,
        viewerUserId,
      ),
    ];
    const alreadyUpToDate =
      existing.length > 0 &&
      existing[0].streamer_participant_id === streamerParticipantId &&
      existing[0].viewer_participant_id === viewerParticipantId;
    if (alreadyUpToDate) return false;

    this.sql.exec(
      `INSERT INTO stream_watchers (
         streamer_user_id,
         viewer_user_id,
         streamer_participant_id,
         viewer_participant_id,
         created_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(streamer_user_id, viewer_user_id) DO UPDATE SET
         streamer_participant_id = excluded.streamer_participant_id,
         viewer_participant_id = excluded.viewer_participant_id,
         created_at = excluded.created_at`,
      streamerUserId,
      viewerUserId,
      streamerParticipantId,
      viewerParticipantId,
      createdAt,
    );
    return true;
  }

  remove(streamerUserId: string, viewerUserId: string) {
    return this.deleteIfPresent(
      "SELECT 1 FROM stream_watchers WHERE streamer_user_id = ? AND viewer_user_id = ? LIMIT 1",
      "DELETE FROM stream_watchers WHERE streamer_user_id = ? AND viewer_user_id = ?",
      streamerUserId,
      viewerUserId,
    );
  }

  clearByViewer(viewerUserId: string) {
    return this.deleteIfPresent(
      "SELECT 1 FROM stream_watchers WHERE viewer_user_id = ? LIMIT 1",
      "DELETE FROM stream_watchers WHERE viewer_user_id = ?",
      viewerUserId,
    );
  }

  clearByStreamer(streamerUserId: string) {
    return this.deleteIfPresent(
      "SELECT 1 FROM stream_watchers WHERE streamer_user_id = ? LIMIT 1",
      "DELETE FROM stream_watchers WHERE streamer_user_id = ?",
      streamerUserId,
    );
  }

  private deleteIfPresent(
    selectQuery: string,
    deleteQuery: string,
    ...params: string[]
  ) {
    const hadExisting = [...this.sql.exec(selectQuery, ...params)].length > 0;
    if (hadExisting) {
      this.sql.exec(deleteQuery, ...params);
    }
    return hadExisting;
  }
}
