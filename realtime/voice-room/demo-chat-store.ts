export interface DemoChatGifPayload {
  url: string;
  content_type: "image/gif" | "video/mp4";
  title?: string;
  source_url?: string;
  provider?: "klipy" | "tenor";
  width?: number;
  height?: number;
}

export interface DemoChatMessage {
  id: string;
  participant_id: string;
  author_name: string;
  content: string;
  gif?: DemoChatGifPayload;
  created_at: number;
  expires_at: number;
}

export interface DemoChatSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T>;
}

export class DemoChatStore {
  constructor(
    private readonly sql: DemoChatSql,
    private readonly maxMessages: number,
  ) {}

  append(message: DemoChatMessage, now: number) {
    this.pruneExpired(now);
    this.sql.exec(
      `INSERT INTO demo_chat_messages (id, participant_id, author_name, content, gif_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.participant_id,
      message.author_name,
      message.content,
      message.gif ? JSON.stringify(message.gif) : null,
      message.created_at,
      message.expires_at,
    );
    this.pruneOverflow();
  }

  listLive(now: number): DemoChatMessage[] {
    this.pruneExpired(now);
    const rows = [
      ...this.sql.exec(
        `SELECT id, participant_id, author_name, content, gif_json, created_at, expires_at
         FROM demo_chat_messages
         WHERE expires_at > ?
         ORDER BY created_at ASC
         LIMIT ?`,
        now,
        this.maxMessages,
      ),
    ];

    return rows.map((row) => {
      const gifJson = row.gif_json as string | null;
      let gif: DemoChatGifPayload | undefined;
      if (gifJson) {
        try {
          gif = JSON.parse(gifJson) as DemoChatGifPayload;
        } catch {
          gif = undefined;
        }
      }

      return {
        id: row.id as string,
        participant_id: row.participant_id as string,
        author_name: row.author_name as string,
        content: row.content as string,
        ...(gif ? { gif } : {}),
        created_at: row.created_at as number,
        expires_at: row.expires_at as number,
      };
    });
  }

  pruneExpired(now: number) {
    this.sql.exec("DELETE FROM demo_chat_messages WHERE expires_at <= ?", now);
  }

  pruneOverflow() {
    this.sql.exec(
      `DELETE FROM demo_chat_messages
       WHERE id NOT IN (
         SELECT id FROM demo_chat_messages
         ORDER BY created_at DESC
         LIMIT ?
       )`,
      this.maxMessages,
    );
  }
}
