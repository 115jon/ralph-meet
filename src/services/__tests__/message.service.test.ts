import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  addReaction,
  batchFetchAttachments,
  batchFetchReactions,
  formatMessageRow,
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
        },
        {
          id: "a2",
          message_id: "m1",
          filename: "doc.pdf",
          file_key: "uploads/doc.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
        },
      ],
    });

    const map = await batchFetchAttachments(db as any, ["m1"]);
    expect(map["m1"]).toHaveLength(2);
    expect(map["m1"][0].filename).toBe("photo.jpg");
    expect(map["m1"][0].url).toBe("/api/uploads/photo.jpg");
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
          url: "/api/uploads/test.png",
        },
      ],
    };

    const result = formatMessageRow(
      rawMessageRow(),
      USER_ID,
      reactions,
      attachments
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

  it("converts is_pinned from number to boolean", () => {
    const pinned = formatMessageRow(
      rawMessageRow({ is_pinned: 1 }),
      USER_ID,
      {},
      {}
    );
    expect(pinned.is_pinned).toBe(true);

    const unpinned = formatMessageRow(
      rawMessageRow({ is_pinned: 0 }),
      USER_ID,
      {},
      {}
    );
    expect(unpinned.is_pinned).toBe(false);
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
      "👍"
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
      "👍"
    );

    db.assertCalled(/DELETE FROM message_reactions/);
    expect(result.broadcast.event).toBe("REACTION_REMOVE");
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
      pinMessage(db as any, CHANNEL_ID, "nonexistent")
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
      pinMessage(db as any, CHANNEL_ID, "msg_1")
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
