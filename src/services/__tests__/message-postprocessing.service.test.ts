import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  generateMessageNotifications,
  processMessagePostprocessingTask,
} from "../message.service";

const embedMock = vi.hoisted(() => vi.fn());
const extractionStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../embed-fetcher", () => ({
  extractAndProcessEmbeds: embedMock,
  extractAndProcessEmbedsWithStatus: extractionStatusMock,
}));

describe("message postprocessing", () => {
  beforeEach(() => {
    embedMock.mockReset();
    extractionStatusMock.mockReset();
    extractionStatusMock.mockImplementation(async (content: string) => ({
      embeds: await embedMock(content),
      hadFailures: false,
    }));
  });

  it("does nothing for a deleted or stale message", async () => {
    const deletedDb = createMockD1();
    const broadcast = vi.fn(async () => undefined);

    await processMessagePostprocessingTask(
      deletedDb as never,
      { messageId: "missing", channelId: "channel-1", revision: 1 },
      broadcast,
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    const staleDb = createMockD1();
    staleDb.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 2,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: null,
    });

    await processMessagePostprocessingTask(
      staleDb as never,
      { messageId: "message-1", channelId: "channel-1", revision: 1 },
      broadcast,
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(staleDb.getCalls("UPDATE messages SET embeds")).toHaveLength(0);
  });

  it("broadcasts an embed update only when the conditional revision write wins", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 1,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    db.mockQuery("UPDATE messages SET embeds", {
      meta: { changes: 1 },
    });
    db.mockQuery("SELECT content_revision FROM messages", {
      content_revision: 1,
    });
    embedMock.mockResolvedValue([{ url: "https://example.test" }]);
    const broadcast = vi.fn(async () => undefined);

    await processMessagePostprocessingTask(
      db as never,
      { messageId: "message-1", channelId: "channel-1", revision: 1 },
      broadcast,
    );
    db.mockQuery("UPDATE messages SET embeds", {
      meta: { changes: 0 },
    });
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 1,
      embeds: JSON.stringify([{ url: "https://example.test" }]),
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    await processMessagePostprocessingTask(
      db as never,
      { messageId: "message-1", channelId: "channel-1", revision: 1 },
      broadcast,
    );

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledWith(
      { kind: "server", id: "server-1" },
      "MESSAGE_UPDATE",
      {
        id: "message-1",
        channel_id: "channel-1",
        content_revision: 1,
        embeds: [{ url: "https://example.test" }],
      },
    );
  });

  it("preserves stored embeds when resolution has a provider failure", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 1,
      embeds: JSON.stringify([{ url: "https://old.example" }]),
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    extractionStatusMock.mockResolvedValue({ embeds: [], hadFailures: true });
    const broadcast = vi.fn(async () => undefined);

    await processMessagePostprocessingTask(
      db as never,
      { messageId: "message-1", channelId: "channel-1", revision: 1 },
      broadcast,
    );

    expect(db.getCalls("UPDATE messages SET embeds")).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("replays an empty embed update after its first broadcast fails", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "plain text",
      content_revision: 2,
      embeds: JSON.stringify([{ url: "https://old.example" }]),
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    db.mockQuery("UPDATE messages SET embeds", { meta: { changes: 1 } });
    db.mockQuery("SELECT content_revision FROM messages", {
      content_revision: 2,
    });
    embedMock.mockResolvedValue([]);
    const broadcast = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      processMessagePostprocessingTask(
        db as never,
        {
          messageId: "message-1",
          channelId: "channel-1",
          revision: 2,
          notify: false,
        },
        broadcast,
      ),
    ).rejects.toThrow("gateway unavailable");

    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "plain text",
      content_revision: 2,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    db.mockQuery("UPDATE messages SET embeds", { meta: { changes: 0 } });
    await processMessagePostprocessingTask(
      db as never,
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 2,
        notify: false,
      },
      broadcast,
    );

    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it("retries the current embed broadcast after the D1 write already succeeded", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 1,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    db.mockQuery("UPDATE messages SET embeds", { meta: { changes: 1 } });
    db.mockQuery("SELECT content_revision FROM messages", {
      content_revision: 1,
    });
    embedMock.mockResolvedValue([{ url: "https://example.test" }]);
    const broadcast = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      processMessagePostprocessingTask(
        db as never,
        { messageId: "message-1", channelId: "channel-1", revision: 1 },
        broadcast,
      ),
    ).rejects.toThrow("gateway unavailable");

    db.mockQuery("UPDATE messages SET embeds", { meta: { changes: 0 } });
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "https://example.test",
      content_revision: 1,
      embeds: JSON.stringify([{ url: "https://example.test" }]),
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    await processMessagePostprocessingTask(
      db as never,
      { messageId: "message-1", channelId: "channel-1", revision: 1 },
      broadcast,
    );

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0]).toEqual(broadcast.mock.calls[1]);
  });

  it("replays a queued notification with the same ID without inserting a second row", async () => {
    const db = createMockD1();
    embedMock.mockResolvedValue([]);
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "hello @mentioned",
      content_revision: 1,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    db.mockQuery("SELECT c.name", {
      channel_name: "general",
      server_id: "server-1",
      channel_type: "text",
      server_name: "server",
    });
    db.mockQuery("SELECT id, username", {
      results: [{ id: "mentioned-1", username: "mentioned" }],
    });
    db.mockQuery("SELECT content_revision FROM messages", {
      content_revision: 1,
    });
    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 1 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 1 },
    });
    const broadcast = vi
      .fn()
      .mockRejectedValueOnce(new Error("notification gateway unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      processMessagePostprocessingTask(
        db as never,
        {
          messageId: "message-1",
          channelId: "channel-1",
          revision: 1,
          notify: true,
        },
        broadcast,
      ),
    ).rejects.toThrow("notification gateway unavailable");

    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 0 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 0 },
    });
    db.mockQuery("FROM notification_delivery_markers", {
      notification_id: "message:message-1:mention:mentioned-1",
    });
    await processMessagePostprocessingTask(
      db as never,
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 1,
        notify: true,
      },
      broadcast,
    );

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0]?.[2]).toMatchObject({
      id: "message:message-1:mention:mentioned-1",
    });
    expect(broadcast.mock.calls[1]?.[2]).toMatchObject({
      id: "message:message-1:mention:mentioned-1",
    });
  });

  it("does not generate notifications for edit postprocessing tasks", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT m.id", {
      id: "message-1",
      channel_id: "channel-1",
      content: "edited @mentioned",
      content_revision: 2,
      embeds: "[]",
      author_id: "author-1",
      author_username: "author",
      author_display_name: null,
      author_avatar_url: null,
      reply_to_id: null,
      server_id: "server-1",
    });
    embedMock.mockResolvedValue([]);
    const broadcast = vi.fn(async () => undefined);

    await processMessagePostprocessingTask(
      db as never,
      {
        messageId: "message-1",
        channelId: "channel-1",
        revision: 2,
        notify: false,
      },
      broadcast,
    );

    expect(db.getCalls("SELECT c.name")).toHaveLength(0);
    expect(db.getCalls("INSERT OR IGNORE INTO notifications")).toHaveLength(0);
  });

  it("replays a notification from its marker when the row was cleared", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT c.name", {
      channel_name: "general",
      server_id: "server-1",
      channel_type: "text",
      server_name: "server",
    });
    db.mockQuery("SELECT id, username", {
      results: [{ id: "mentioned-1", username: "mentioned" }],
    });
    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 1 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 1 },
    });
    const broadcast = await generateMessageNotifications(
      db as never,
      () => "notif-1",
      {
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "author-1",
        authorUsername: "author",
        authorDisplayName: null,
        authorAvatarUrl: null,
        content: "hello @mentioned",
        contentRevision: 1,
      },
    );

    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 0 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 0 },
    });
    db.mockQuery("FROM notification_delivery_markers", {
      notification_id: "notif-1",
    });
    const duplicate = await generateMessageNotifications(
      db as never,
      () => "notif-2",
      {
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "author-1",
        authorUsername: "author",
        authorDisplayName: null,
        authorAvatarUrl: null,
        content: "hello @mentioned",
        contentRevision: 1,
      },
    );

    expect(broadcast).toHaveLength(1);
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.data.id).toBe("notif-1");
  });

  it("requires revisioned notification delivery to be newer than the clear watermark", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT c.name", {
      channel_name: "general",
      server_id: "server-1",
      channel_type: "text",
      server_name: "server",
    });
    db.mockQuery("SELECT id, username", {
      results: [{ id: "mentioned-1", username: "mentioned" }],
    });
    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 0 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 0 },
    });
    db.mockQuery(
      "SELECT notification_id FROM notification_delivery_markers",
      null,
    );

    await expect(
      generateMessageNotifications(db as never, () => "notif-1", {
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "author-1",
        authorUsername: "author",
        authorDisplayName: null,
        authorAvatarUrl: null,
        content: "hello @mentioned",
        contentRevision: 1,
      }),
    ).resolves.toEqual([]);

    expect(
      db.calls.some(
        (call) =>
          call.sql.includes("notification_clear_watermarks") &&
          call.sql.includes("julianday(m.created_at) >"),
      ),
    ).toBe(true);
  });

  it("returns the marker ID when a winning marker races an ignored notification insert", async () => {
    const db = createMockD1();
    db.mockQuery("SELECT c.name", {
      channel_name: "general",
      server_id: "server-1",
      channel_type: "text",
      server_name: "server",
    });
    db.mockQuery("SELECT id, username", {
      results: [{ id: "mentioned-1", username: "mentioned" }],
    });
    db.mockQuery("INSERT OR IGNORE INTO notification_delivery_markers", {
      meta: { changes: 1 },
    });
    db.mockQuery("INSERT OR IGNORE INTO notifications", {
      meta: { changes: 0 },
    });
    db.mockQuery("FROM notification_delivery_markers", {
      notification_id: "message:message-1:mention:mentioned-1",
    });

    const broadcasts = await generateMessageNotifications(
      db as never,
      () => "different-id",
      {
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "author-1",
        authorUsername: "author",
        authorDisplayName: null,
        authorAvatarUrl: null,
        content: "hello @mentioned",
        contentRevision: 1,
        notificationId: () => "message:message-1:mention:mentioned-1",
      },
    );

    expect(broadcasts[0]?.data.id).toBe(
      "message:message-1:mention:mentioned-1",
    );
  });
});
