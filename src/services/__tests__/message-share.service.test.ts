import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  createMessageShare,
  getPublicMessageShare,
  listUserMessageShares,
  markSharesDeletedForMessage,
  revokeMessageShare,
} from "../message-share.service";

const NOW = new Date("2026-05-23T12:00:00.000Z");

function serverMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    channel_id: "channel_1",
    author_id: "user_author",
    content: "A shareable server message",
    created_at: "2026-05-23T11:00:00.000Z",
    updated_at: null,
    embeds: "[]",
    reply_count: 3,
    server_id: "server_1",
    server_name: "Design Team",
    server_allow_public_shares: 1,
    server_show_source_in_shares: 0,
    server_allow_share_indexing: 0,
    channel_type: "text",
    channel_name: "general",
    channel_allow_public_shares: null,
    author_username: "alice",
    author_display_name: "Alice",
    author_avatar_url: "/api/avatars/alice.png",
    ...overrides,
  };
}

describe("message share service", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("creates a server-only public snapshot with a 30-day default expiry", async () => {
    db.mockQuery("FROM messages m", serverMessageRow());
    db.mockQuery("FROM attachments", {
      results: [
        {
          id: "image_1",
          filename: "mockup.png",
          file_key: "attachments/mockup.png",
          content_type: "image/png",
          size_bytes: 1234,
        },
        {
          id: "video_1",
          filename: "clip.mp4",
          file_key: "attachments/clip.mp4",
          content_type: "video/mp4",
          size_bytes: 2345,
        },
        {
          id: "file_1",
          filename: "brief.pdf",
          file_key: "attachments/brief.pdf",
          content_type: "application/pdf",
          size_bytes: 4567,
        },
      ],
    });
    db.mockQuery("FROM message_reactions", {
      results: [
        { emoji: "thumbs-up", count: 2 },
        { emoji: "sparkles", count: 1 },
      ],
    });

    const share = await createMessageShare(db as any, {
      messageId: "msg_1",
      createdBy: "user_reader",
      now: NOW,
      genId: () => "share_1",
      genToken: () => "tok_public",
    });

    expect(share.token).toBe("tok_public");
    expect(share.expires_at).toBe("2026-06-22T12:00:00.000Z");
    expect(share.snapshot.attachments).toEqual([
      {
        id: "image_1",
        filename: "mockup.png",
        file_key: "attachments/mockup.png",
        content_type: "image/png",
        size_bytes: 1234,
        url: "/api/attachments/mockup.png",
      },
      {
        id: "video_1",
        filename: "clip.mp4",
        file_key: "attachments/clip.mp4",
        content_type: "video/mp4",
        size_bytes: 2345,
        url: "/api/attachments/clip.mp4",
      },
    ]);
    expect(share.snapshot.omitted_attachment_count).toBe(1);
    expect(share.snapshot.reactions).toEqual([
      { emoji: "thumbs-up", count: 2 },
      { emoji: "sparkles", count: 1 },
    ]);
    db.assertCalled(/INSERT INTO message_shares/);
  });

  it("rejects DM message sharing", async () => {
    db.mockQuery("FROM messages m", serverMessageRow({
      server_id: null,
      channel_type: "dm",
    }));

    await expect(
      createMessageShare(db as any, {
        messageId: "msg_dm",
        createdBy: "user_reader",
        now: NOW,
        genId: () => "share_1",
        genToken: () => "tok_public",
      })
    ).rejects.toHaveProperty("status", 403);
  });

  it("rejects sharing when the server or channel disables public shares", async () => {
    db.mockQuery("FROM messages m", serverMessageRow({
      channel_allow_public_shares: 0,
    }));

    await expect(
      createMessageShare(db as any, {
        messageId: "msg_1",
        createdBy: "user_reader",
        now: NOW,
        genId: () => "share_1",
        genToken: () => "tok_public",
      })
    ).rejects.toHaveProperty("status", 403);
  });

  it("returns 410 for revoked, deleted, or expired public shares", async () => {
    db.mockQuery("FROM message_shares", {
      token: "tok_public",
      status: "active",
      expires_at: "2026-05-23T11:59:59.000Z",
      revoked_at: null,
      snapshot_author: "{}",
      snapshot_attachments: "[]",
      snapshot_embeds: "[]",
      snapshot_reactions: "[]",
      source_message_id: "msg_1",
    });

    await expect(
      getPublicMessageShare(db as any, "tok_public", NOW)
    ).rejects.toHaveProperty("status", 410);
  });

  it("marks existing shares deleted when the source message is deleted", async () => {
    await markSharesDeletedForMessage(db as any, "msg_1", NOW);

    db.assertCalledWith(/UPDATE message_shares SET status = 'deleted'/, [
      "2026-05-23T12:00:00.000Z",
      "msg_1",
    ]);
  });

  it("lists and revokes only shares created by the current user", async () => {
    db.mockQuery("FROM message_shares", {
      results: [
        {
          id: "share_1",
          token: "tok_public",
          source_message_id: "msg_1",
          snapshot_content: "hello",
          snapshot_author: "{\"display_name\":\"Alice\"}",
          created_at: "2026-05-23T11:00:00.000Z",
          expires_at: "2026-06-22T11:00:00.000Z",
          revoked_at: null,
          status: "active",
          view_count: 2,
        },
      ],
    });

    const shares = await listUserMessageShares(db as any, "user_reader");
    expect(shares).toHaveLength(1);
    expect(shares[0].author.display_name).toBe("Alice");

    await revokeMessageShare(db as any, "share_1", "user_reader", NOW);
    db.assertCalledWith(/UPDATE message_shares SET status = 'revoked'/, [
      "2026-05-23T12:00:00.000Z",
      "share_1",
      "user_reader",
    ]);
  });
});
