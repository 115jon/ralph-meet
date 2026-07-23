import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  addReaction,
  batchFetchAttachments,
  batchFetchReactions,
  batchFetchReplyPreviews,
  createMessage,
  deleteMessage,
  editMessage,
  fetchChannelThreads,
  fetchMessageAttachmentKeys,
  fetchMessageRows,
  formatMessageRow,
  normalizeMessageLimit,
  markChannelAsRead,
  pinMessage,
  removeReaction,
  unpinMessage,
} from "../message.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const CHANNEL_ID = "channel_456";

function rawMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    channel_id: CHANNEL_ID,
    author_id: USER_ID,
    content: "Hello world",
    reply_to_id: null,
    is_pinned: 0,
    created_at: NOW,
    updated_at: null,
    author_username: "alice",
    author_avatar_url: null,
    ...overrides,
  };
}

// ─── batchFetchReactions ─────────────────────────────────────────────────────

describe("batchFetchReactions", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("groups reactions by message and emoji", async () => {
    db.mockQuery("FROM message_reactions", {
      results: [
        { message_id: "m1", emoji: "👍", user_id: "u1" },
        { message_id: "m1", emoji: "👍", user_id: "u2" },
        { message_id: "m1", emoji: "❤️", user_id: "u1" },
        { message_id: "m2", emoji: "👍", user_id: "u3" },
      ],
    });

    const map = await batchFetchReactions(db as any, ["m1", "m2"]);

    expect(map["m1"]).toHaveLength(2);
    expect(map["m1"][0].emoji).toBe("👍");
    expect(map["m1"][0].user_ids).toEqual(["u1", "u2"]);
    expect(map["m1"][1].emoji).toBe("❤️");
    expect(map["m2"]).toHaveLength(1);
  });

  it("returns empty map for no message IDs", async () => {
    const map = await batchFetchReactions(db as any, []);
    expect(map).toEqual({});
  });
});

// ─── batchFetchAttachments ───────────────────────────────────────────────────

describe("batchFetchAttachments", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("groups attachments by message", async () => {
    db.mockQuery("FROM attachments", {
      results: [
        {
          id: "a1",
          message_id: "m1",
          filename: "photo.jpg",
          file_key: "uploads/photo.jpg",
          content_type: "image/jpeg",
          size_bytes: 1024,
          is_nsfw: 1,
        },
        {
          id: "a2",
          message_id: "m1",
          filename: "doc.pdf",
          file_key: "uploads/doc.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
          is_nsfw: 0,
        },
      ],
    });

    const map = await batchFetchAttachments(db as any, ["m1"]);
    expect(map["m1"]).toHaveLength(2);
    expect(map["m1"][0].filename).toBe("photo.jpg");
    expect(map["m1"][0].url).toBe("/api/uploads/photo.jpg");
    expect(map["m1"][0].is_nsfw).toBe(true);
    expect(map["m1"][1].is_nsfw).toBe(false);
  });

  it("preserves external attachment URLs without proxying them", async () => {
    db.mockQuery("FROM attachments", {
      results: [
        {
          id: "a1",
          message_id: "m1",
          filename: "provider.gif",
          file_key: "https://static.klipy.com/provider.gif",
          content_type: "image/gif",
          size_bytes: 1024,
          is_nsfw: 0,
        },
      ],
    });

    const map = await batchFetchAttachments(db as any, ["m1"]);
    expect(map["m1"][0].url).toBe("https://static.klipy.com/provider.gif");
  });
});

describe("createMessage attachment linking", () => {
  it("writes content_revision with matching INSERT bindings", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id", {
      username: "alice",
      display_name: null,
      avatar_url: null,
      avatar_display: null,
    });

    await createMessage(db as never, CHANNEL_ID, USER_ID, "msg_revision", {
      content: "hello",
    });

    const insert = db.getCalls("INSERT INTO messages")[0];
    expect(insert?.sql).toContain("content_revision");
    expect(insert?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, 1)");
    expect(insert?.bindings).toHaveLength(6);
  });

  it("does not reassociate a soundboard attachment with a message", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id", {
      username: "alice",
      display_name: null,
      avatar_url: null,
      avatar_display: null,
    });

    await createMessage(db as never, CHANNEL_ID, USER_ID, "msg_1", {
      content: "hello",
      attachment_ids: ["sound-1"],
    });

    db.assertCalledWith("UPDATE attachments SET message_id", [
      "msg_1",
      "sound-1",
      USER_ID,
    ]);
    expect(
      db
        .getCalls("UPDATE attachments SET message_id")
        .some((call) => call.sql.includes("soundboard_server_id IS NULL")),
    ).toBe(true);
    expect(
      db
        .getCalls("SELECT id, filename, file_key")
        .some((call) => call.sql.includes("message_id = ?")),
    ).toBe(true);
  });

  it("does not claim an already-linked attachment from another channel", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id", {
      username: "alice",
      display_name: null,
      avatar_url: null,
      avatar_display: null,
    });

    await createMessage(db as never, CHANNEL_ID, USER_ID, "msg_2", {
      content: "hello",
      attachment_ids: ["already-linked"],
    });

    const update = db.getCalls("UPDATE attachments SET message_id")[0];
    expect(update?.sql).toContain("message_id IS NULL");
    expect(update?.sql).toContain("file_key LIKE ?");
    expect(update?.bindings).toContain(`attachments/${CHANNEL_ID}/%`);
    expect(
      db
        .getCalls("SELECT id, filename, file_key")
        .some((call) => call.sql.includes("message_id = ?")),
    ).toBe(true);
  });
});

describe("editMessage revision", () => {
  it("returns the revision from the atomic UPDATE RETURNING statement", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT author_id FROM messages", { author_id: USER_ID });
    db.mockQuery("SET content", {
      results: [{ content_revision: 7 }],
    });

    const result = await editMessage(
      db as never,
      CHANNEL_ID,
      USER_ID,
      "msg_1",
      "edited",
    );

    expect(result.content_revision).toBe(7);
    expect(db.getCalls("SELECT content_revision")).toHaveLength(0);
  });

  it("propagates attachment lookup failures", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              all: async () => {
                throw new Error("D1 unavailable");
              },
            };
          },
        };
      },
    };

    await expect(
      fetchMessageAttachmentKeys(db as never, "msg_1"),
    ).rejects.toThrow("D1 unavailable");
  });
});

// ─── formatMessageRow ────────────────────────────────────────────────────────

describe("formatMessageRow", () => {
  it("formats a raw message row with reactions and attachments", () => {
    const reactions = {
      msg_1: [
        { emoji: "👍", user_ids: ["u1", "u2"] },
        { emoji: "❤️", user_ids: [USER_ID] },
      ],
    };
    const attachments = {
      msg_1: [
        {
          id: "a1",
          filename: "test.png",
          file_key: "uploads/test.png",
          content_type: "image/png",
          size_bytes: 512,
          is_nsfw: false,
          url: "/api/uploads/test.png",
        },
      ],
    };

    const result = formatMessageRow(
      rawMessageRow(),
      USER_ID,
      reactions,
      attachments,
    );

    expect(result.id).toBe("msg_1");
    expect(result.author.username).toBe("alice");
    expect(result.is_pinned).toBe(false);
    expect(result.reactions).toHaveLength(2);
    expect(result.reactions[0].count).toBe(2);
    expect(result.reactions[0].me).toBe(false);
    expect(result.reactions[1].me).toBe(true); // ❤️ has USER_ID
    expect(result.attachments).toHaveLength(1);
  });

  it("handles message with no reactions or attachments", () => {
    const result = formatMessageRow(rawMessageRow(), USER_ID, {}, {});

    expect(result.reactions).toEqual([]);
    expect(result.attachments).toEqual([]);
    expect(result.author.username).toBe("alice");
  });

  it("includes attachment count for reply previews", () => {
    const result = formatMessageRow(
      rawMessageRow({ reply_to_id: "msg_0", attachment_count: 2 }),
      USER_ID,
      {},
      {},
      {
        msg_0: {
          id: "msg_0",
          content: "",
          author_id: "user_2",
          author: {
            id: "user_2",
            username: "bob",
            display_name: null,
            avatar_url: null,
          },
          attachment_count: 2,
        },
      },
    );

    expect(result.attachment_count).toBe(2);
    expect(result.reply_to?.attachment_count).toBe(2);
  });

  it("converts is_pinned from number to boolean", () => {
    const pinned = formatMessageRow(
      rawMessageRow({ is_pinned: 1 }),
      USER_ID,
      {},
      {},
    );
    expect(pinned.is_pinned).toBe(true);

    const unpinned = formatMessageRow(
      rawMessageRow({ is_pinned: 0 }),
      USER_ID,
      {},
      {},
    );
    expect(unpinned.is_pinned).toBe(false);
  });
});

describe("normalizeMessageLimit", () => {
  it.each([
    [undefined, 50],
    [null, 50],
    ["not-a-number", 50],
    ["10.5", 50],
    ["-5", 1],
    ["0", 1],
    ["1", 1],
    ["100", 100],
    ["101", 100],
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizeMessageLimit(value)).toBe(expected);
  });
});

describe("fetchMessageRows pagination", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("uses limit plus one for latest messages and reports more messages before", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `message_${index}`,
      created_at: `2026-02-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    db.mockQuery("ORDER BY m.created_at DESC, m.id DESC LIMIT ?", {
      results: rows,
    });

    const result = await fetchMessageRows(db as any, CHANNEL_ID, { limit: 50 });

    expect(result.rows).toHaveLength(50);
    expect(result.hasMoreBefore).toBe(true);
    expect(result.hasMoreAfter).toBe(false);
    expect(
      db.getCalls("ORDER BY m.created_at DESC, m.id DESC LIMIT ?")[0]?.bindings,
    ).toEqual([CHANNEL_ID, 51]);
  });

  it("uses limit plus one before a cursor and reports more messages before", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `message_${index}`,
      created_at: `2026-02-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    db.mockQuery(
      "m.created_at < ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?",
      {
        results: rows,
      },
    );

    const result = await fetchMessageRows(db as any, CHANNEL_ID, {
      limit: 50,
      before: "2026-02-28T01:00:00.000Z",
    });

    expect(result.rows).toHaveLength(50);
    expect(result.hasMoreBefore).toBe(true);
    expect(result.hasMoreAfter).toBe(false);
    expect(
      db.getCalls(
        "m.created_at < ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?",
      )[0]?.bindings,
    ).toEqual([CHANNEL_ID, "2026-02-28T01:00:00.000Z", 51]);
  });

  it("uses the message ID to disambiguate equal timestamp cursors", async () => {
    db.mockQuery("m.created_at = ? AND m.id < ?", { results: [] });

    await fetchMessageRows(db as any, CHANNEL_ID, {
      limit: 50,
      before: `${NOW}|msg_2`,
    });

    expect(db.getCalls("m.created_at = ? AND m.id < ?")[0]?.bindings).toEqual([
      CHANNEL_ID,
      NOW,
      NOW,
      "msg_2",
      51,
    ]);
  });
});

describe("reply mapping", () => {
  it("loads reply previews for messages with reply_to_id", async () => {
    const db = createMockD1();
    db.mockQuery("WHERE m.id IN", {
      results: [
        {
          id: "parent_1",
          content: "Original message",
          author_id: "user_parent",
          author_username: "parent",
          author_display_name: null,
          author_avatar_url: null,
          author_avatar_display: null,
        },
      ],
    });
    db.mockQuery("FROM attachments", { results: [] });

    const previews = await batchFetchReplyPreviews(db as any, ["parent_1"]);

    expect(previews.parent_1).toMatchObject({
      id: "parent_1",
      content: "Original message",
      author_id: "user_parent",
    });
    db.assertCalled(/WHERE m.id IN/);
  });

  it("uses the reply_to_id relationship for grouped thread counts", async () => {
    const db = createMockD1();
    db.mockQuery("INNER JOIN messages r ON r.reply_to_id = m.id", {
      results: [
        {
          id: "parent_1",
          content: "Original message",
          author_id: "user_parent",
          author_username: "parent",
          author_display_name: null,
          author_avatar_url: null,
          reply_count: 2,
          last_reply_at: "2026-02-28T00:02:00.000Z",
          created_at: "2026-02-28T00:00:00.000Z",
        },
      ],
    });

    const threads = await fetchChannelThreads(db as any, CHANNEL_ID);

    expect(threads[0]).toMatchObject({ id: "parent_1", reply_count: 2 });
    db.assertCalled(/INNER JOIN messages r ON r.reply_to_id = m.id/);
  });
});

// ─── addReaction ─────────────────────────────────────────────────────────────

describe("addReaction", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("inserts reaction and returns broadcast", async () => {
    const result = await addReaction(
      db as any,
      CHANNEL_ID,
      USER_ID,
      "msg_1",
      "👍",
    );

    db.assertCalled(/INSERT INTO message_reactions/);
    expect(result.broadcast.event).toBe("REACTION_ADD");
    expect(result.broadcast.data).toEqual({
      message_id: "msg_1",
      channel_id: CHANNEL_ID,
      user_id: USER_ID,
      emoji: "👍",
    });
  });
});

// ─── removeReaction ──────────────────────────────────────────────────────────

describe("removeReaction", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes reaction and returns broadcast", async () => {
    const result = await removeReaction(
      db as any,
      CHANNEL_ID,
      USER_ID,
      "msg_1",
      "👍",
    );

    db.assertCalled(/DELETE FROM message_reactions/);
    expect(result.broadcast?.event).toBe("REACTION_REMOVE");
  });

  it("does not broadcast when the message is outside the requested channel", async () => {
    db.mockQuery(/DELETE FROM message_reactions/, {
      meta: { changes: 0 },
    });

    const result = await removeReaction(
      db as any,
      "different-channel",
      USER_ID,
      "msg_1",
      "👍",
    );

    expect(result.broadcast).toBeUndefined();
    db.assertCalledWith(/DELETE FROM message_reactions/, [
      "msg_1",
      USER_ID,
      "👍",
      "different-channel",
    ]);
  });
});

// ─── markChannelAsRead ───────────────────────────────────────────────────────

describe("markChannelAsRead", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("upserts read state", async () => {
    const result = await markChannelAsRead(db as any, USER_ID, CHANNEL_ID);

    db.assertCalled(/INSERT INTO read_states/);
    expect(result.channel_id).toBe(CHANNEL_ID);
    expect(result.last_read_at).toBeDefined();
  });
});

// ─── pinMessage ──────────────────────────────────────────────────────────────

describe("pinMessage", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("pins a message and returns broadcast", async () => {
    db.mockQuery("FROM messages WHERE id", {
      id: "msg_1",
      channel_id: CHANNEL_ID,
      is_pinned: 0,
    });
    // Pin count under limit
    db.mockQuery("COUNT(*) as count", { results: [{ count: 5 }] });

    const result = await pinMessage(db as any, CHANNEL_ID, "msg_1");

    db.assertCalled(/UPDATE messages SET is_pinned/);
    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("MESSAGE_PIN");
  });

  it("throws 404 when message not found", async () => {
    await expect(
      pinMessage(db as any, CHANNEL_ID, "nonexistent"),
    ).rejects.toHaveProperty("status", 404);
  });

  it("throws 400 when pin limit exceeded", async () => {
    db.mockQuery("FROM messages WHERE id", {
      id: "msg_1",
      channel_id: CHANNEL_ID,
      is_pinned: 0,
    });
    db.mockQuery("COUNT(*) as count", { results: [{ count: 50 }] });

    await expect(
      pinMessage(db as any, CHANNEL_ID, "msg_1"),
    ).rejects.toHaveProperty("status", 400);
  });
});

// ─── unpinMessage ────────────────────────────────────────────────────────────

describe("unpinMessage", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("unpins a message and returns broadcast", async () => {
    db.mockQuery("FROM messages WHERE id", {
      id: "msg_1",
      channel_id: CHANNEL_ID,
      is_pinned: 1,
    });

    const result = await unpinMessage(db as any, CHANNEL_ID, "msg_1");

    db.assertCalled(/UPDATE messages SET is_pinned/);
    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("MESSAGE_UNPIN");
  });
});

describe("deleteMessage", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("marks public shares deleted before deleting the source message", async () => {
    const { deleteMessage } = await import("../message.service");
    db.mockQuery("SELECT author_id FROM messages", { author_id: USER_ID });
    db.mockQuery("SELECT file_key FROM attachments WHERE message_id", {
      results: [{ file_key: "attachments/channel-1/a-1/file.txt" }],
    });
    db.mockQuery("DELETE FROM messages", { meta: { changes: 1 } });

    await expect(
      deleteMessage(db as any, CHANNEL_ID, "msg_1", USER_ID, false),
    ).resolves.toEqual(["attachments/channel-1/a-1/file.txt"]);

    db.assertCalled(/UPDATE message_shares SET status = 'deleted'/);
    db.assertCalled(/SELECT file_key FROM attachments WHERE message_id/);
    db.assertCalled(/DELETE FROM messages WHERE id = \?/);
  });

  it("rejects when a concurrent delete already removed the message", async () => {
    db.mockQuery("SELECT author_id FROM messages", { author_id: USER_ID });
    db.mockQuery("SELECT file_key FROM attachments WHERE message_id", {
      results: [],
    });
    db.mockQuery("DELETE FROM messages", { meta: { changes: 0 } });

    await expect(
      deleteMessage(db as any, CHANNEL_ID, "msg_1", USER_ID, false),
    ).rejects.toMatchObject({ status: 404 });
  });
});
