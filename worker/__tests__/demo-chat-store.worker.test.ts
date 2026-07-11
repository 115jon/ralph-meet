import { describe, expect, it } from "vitest";
import {
  DemoChatStore,
  type DemoChatMessage,
  type DemoChatSql,
} from "../voice-room/demo-chat-store";

class RecordingSql implements DemoChatSql {
  readonly calls: Array<{ query: string; params: unknown[] }> = [];
  readonly rows: Array<Record<string, unknown>> = [];

  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T> {
    this.calls.push({ query, params });
    if (query.startsWith("SELECT id, participant_id")) {
      return this.rows.filter(
        (row) => Number(row.expires_at) > Number(params[0]),
      ) as T[];
    }
    return [] as T[];
  }
}

const message: DemoChatMessage = {
  id: "message-1",
  participant_id: "participant-1",
  author_name: "Guest",
  content: "Hello",
  gif: {
    url: "https://media.example/gif.mp4",
    content_type: "video/mp4",
  },
  created_at: 100,
  expires_at: 200,
};

describe("DemoChatStore", () => {
  it("serializes a message and prunes expired rows before appending", () => {
    const sql = new RecordingSql();
    const store = new DemoChatStore(sql, 75);

    store.append(message, 150);

    expect(sql.calls.map(({ query }) => query)).toEqual([
      "DELETE FROM demo_chat_messages WHERE expires_at <= ?",
      expect.stringContaining("INSERT INTO demo_chat_messages"),
      expect.stringContaining("DELETE FROM demo_chat_messages"),
    ]);
    expect(sql.calls[1].params).toEqual([
      "message-1",
      "participant-1",
      "Guest",
      "Hello",
      JSON.stringify(message.gif),
      100,
      200,
    ]);
  });

  it("hydrates live history and ignores malformed GIF JSON", () => {
    const sql = new RecordingSql();
    sql.rows.push(
      {
        id: "message-1",
        participant_id: "participant-1",
        author_name: "Guest",
        content: "Hello",
        gif_json: JSON.stringify(message.gif),
        created_at: 100,
        expires_at: 200,
      },
      {
        id: "message-2",
        participant_id: "participant-2",
        author_name: "Other",
        content: "World",
        gif_json: "invalid",
        created_at: 101,
        expires_at: 200,
      },
    );
    const store = new DemoChatStore(sql, 75);

    expect(store.listLive(150)).toEqual([
      message,
      {
        id: "message-2",
        participant_id: "participant-2",
        author_name: "Other",
        content: "World",
        created_at: 101,
        expires_at: 200,
      },
    ]);
  });

  it("exposes explicit expiry and overflow pruning operations", () => {
    const sql = new RecordingSql();
    const store = new DemoChatStore(sql, 75);

    store.pruneExpired(500);
    store.pruneOverflow();

    expect(sql.calls.map(({ query }) => query)).toEqual([
      "DELETE FROM demo_chat_messages WHERE expires_at <= ?",
      expect.stringContaining("ORDER BY created_at DESC"),
    ]);
  });
});
