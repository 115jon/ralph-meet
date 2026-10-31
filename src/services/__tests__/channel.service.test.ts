import { beforeEach, describe, expect, it } from "vitest";
import { anyId, anyTimestamp, createMockD1 } from "../../lib/__tests__/mock-d1";
import { CacheKey } from "../../lib/cache";
import {
  createChannel,
  deleteChannel,
  listServerChannels,
  updateChannel,
  updateVoiceChannelStatus,
} from "../channel.service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-02-28T00:00:00.000Z";
const USER_ID = "user_abc";
const SERVER_ID = "server_123";
const CHANNEL_ID = "channel_456";
const VOICE_STATUS_MEDIA_JSON = JSON.stringify({
  id: "gif-1",
  provider: "tenor",
  media_type: "gifs",
  title: "Party",
  alt_text: "Party time",
  source_url: "https://tenor.example/source",
  preview_url: "https://tenor.example/preview.gif",
  preview_width: 120,
  preview_height: 80,
  preview_content_type: "image/gif",
});

// ─── deleteChannel ───────────────────────────────────────────────────────────

describe("deleteChannel", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("deletes channel and returns side effects", async () => {
    db.mockQuery("FROM channels WHERE id", {
      server_id: SERVER_ID,
      name: "general",
      channel_type: "text",
    });

    const result = await deleteChannel(db as any, CHANNEL_ID);

    // The channel is deleted by its own id, never by the server's.
    db.assertCalledWith("DELETE FROM channels WHERE id", [CHANNEL_ID]);
    expect(result).toEqual({
      serverId: SERVER_ID,
      cacheKeysToInvalidate: [CacheKey.serverChannels(SERVER_ID)],
      broadcast: {
        type: "server",
        target: SERVER_ID,
        event: "CHANNEL_DELETE",
        data: { id: CHANNEL_ID, server_id: SERVER_ID },
      },
      auditLog: {
        serverId: SERVER_ID,
        actorId: "",
        actionType: "CHANNEL_DELETE",
        targetId: CHANNEL_ID,
        changes: { name: "general", channel_type: "text" },
      },
    });
  });

  it("throws 404 when channel not found", async () => {
    // No mock → returns null by default
    await expect(
      deleteChannel(db as any, "nonexistent"),
    ).rejects.toHaveProperty("status", 404);
  });
});

// ─── createChannel ───────────────────────────────────────────────────────────

describe("createChannel", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    // Default: return next position
    db.mockQuery("COALESCE(MAX(position)", { next_pos: 0 });
  });

  it("creates a text channel", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "new-channel",
      channel_type: "text",
    });

    const { channel } = result;
    expect(channel).toEqual({
      id: anyId(),
      server_id: SERVER_ID,
      name: "new-channel",
      description: null,
      channel_type: "text",
      category_id: null,
      position: 0,
      allow_public_shares: null,
      voice_status: null,
      created_at: anyTimestamp(),
    });
    // The row is inserted for this server under the id the caller gets back.
    db.assertCalledWith("INSERT INTO channels", [
      channel.id,
      SERVER_ID,
      "new-channel",
      null,
      "text",
      null,
      0,
      channel.created_at,
    ]);
    db.assertCalledWith("COALESCE(MAX(position)", [SERVER_ID]);
    expect(result.cacheKeysToInvalidate).toEqual([
      CacheKey.serverChannels(SERVER_ID),
    ]);
    expect(result.broadcast).toEqual({
      type: "server",
      target: SERVER_ID,
      event: "CHANNEL_UPDATE",
      data: { server_id: SERVER_ID, channel },
    });
    expect(result.auditLog).toEqual({
      serverId: SERVER_ID,
      actorId: USER_ID,
      actionType: "CHANNEL_CREATE",
      targetId: channel.id,
      changes: {
        name: "new-channel",
        channel_type: "text",
        category_id: null,
      },
    });
  });

  it("creates a voice channel", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "Voice Room",
      channel_type: "voice",
    });

    expect(result.channel.channel_type).toBe("voice");
    expect(result.channel.name).toBe("Voice Room");
    db.assertCalledWith("INSERT INTO channels", [
      result.channel.id,
      SERVER_ID,
      "Voice Room",
      null,
      "voice",
      null,
      0,
      result.channel.created_at,
    ]);
  });

  it("preserves decorative unicode while normalizing text channel spacing", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "「✨」 My Cool Channel!!!",
      channel_type: "text",
    });

    expect(result.channel.name).toBe("「✨」-my-cool-channel!!!");
    db.assertCalledWith("INSERT INTO channels", [
      result.channel.id,
      SERVER_ID,
      "「✨」-my-cool-channel!!!",
      null,
      "text",
      null,
      0,
      result.channel.created_at,
    ]);
  });

  it("includes description and category_id when provided", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "help",
      channel_type: "text",
      description: "Help channel",
      category_id: "cat_1",
    });

    expect(result.channel.description).toBe("Help channel");
    expect(result.channel.category_id).toBe("cat_1");
    db.assertCalledWith("INSERT INTO channels", [
      result.channel.id,
      SERVER_ID,
      "help",
      "Help channel",
      "text",
      "cat_1",
      0,
      result.channel.created_at,
    ]);
  });

  it("throws when sanitized name is empty", async () => {
    await expect(
      createChannel(db as any, SERVER_ID, USER_ID, {
        name: "   ",
        channel_type: "text",
      }),
    ).rejects.toHaveProperty("status", 400);
  });
});

// ─── updateChannel ───────────────────────────────────────────────────────────

describe("updateChannel", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery("FROM channels WHERE id", {
      id: CHANNEL_ID,
      server_id: SERVER_ID,
      name: "general",
      description: null,
      channel_type: "text",
      category_id: null,
      position: 0,
      allow_public_shares: null,
      voice_status_text: null,
      voice_status_media: null,
      created_at: NOW,
    });
  });

  it("broadcasts the updated channel payload", async () => {
    const result = await updateChannel(db as any, CHANNEL_ID, USER_ID, {
      name: "renamed",
    });

    expect(result.channel.name).toBe("renamed");
    expect((result.broadcast.data as any).channel).toEqual(result.channel);
    // name, description, allow_public_shares, then the channel being updated.
    db.assertCalledWith("UPDATE channels SET name = ?", [
      "renamed",
      null,
      null,
      CHANNEL_ID,
    ]);
    expect(result.cacheKeysToInvalidate).toEqual([
      CacheKey.serverChannels(SERVER_ID),
    ]);
    expect(result.auditLog).toEqual({
      serverId: SERVER_ID,
      actorId: USER_ID,
      actionType: "CHANNEL_UPDATE",
      targetId: CHANNEL_ID,
      changes: { name: { old: "general", new: "renamed" } },
    });
  });

  it("keeps decorative unicode when renaming a text channel", async () => {
    const result = await updateChannel(db as any, CHANNEL_ID, USER_ID, {
      name: "「✨」chat",
    });

    expect(result.channel.name).toBe("「✨」chat");
    db.assertCalledWith("UPDATE channels SET name = ?", [
      "「✨」chat",
      null,
      null,
      CHANNEL_ID,
    ]);
  });
});

describe("updateVoiceChannelStatus", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    db.mockQuery("FROM channels WHERE id", {
      id: CHANNEL_ID,
      server_id: SERVER_ID,
      name: "standup",
      description: null,
      channel_type: "voice",
      category_id: null,
      position: 0,
      allow_public_shares: 1,
      voice_status_text: null,
      voice_status_media: null,
      created_at: NOW,
    });
  });

  it("stores a normalized voice status payload and returns it on the channel", async () => {
    const result = await updateVoiceChannelStatus(
      db as any,
      CHANNEL_ID,
      USER_ID,
      {
        text: "  Working session  ",
        media: JSON.parse(VOICE_STATUS_MEDIA_JSON),
      },
    );

    db.assertCalledWith("UPDATE channels SET voice_status_text = ?", [
      "Working session",
      JSON.stringify(JSON.parse(VOICE_STATUS_MEDIA_JSON)),
      CHANNEL_ID,
    ]);
    expect((result.channel as any).voice_status).toEqual({
      text: "Working session",
      media: JSON.parse(VOICE_STATUS_MEDIA_JSON),
    });
    expect((result.channel as any).allow_public_shares).toBe(true);
  });

  it("rejects voice status updates on non-voice channels", async () => {
    db.mockQuery("FROM channels WHERE id", {
      id: CHANNEL_ID,
      server_id: SERVER_ID,
      name: "general",
      description: null,
      channel_type: "text",
      category_id: null,
      position: 0,
      allow_public_shares: null,
      voice_status_text: null,
      voice_status_media: null,
      created_at: NOW,
    });

    await expect(
      updateVoiceChannelStatus(db as any, CHANNEL_ID, USER_ID, {
        text: "nope",
      }),
    ).rejects.toHaveProperty("status", 400);
  });
});

// ─── listServerChannels ──────────────────────────────────────────────────────

describe("listServerChannels", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns categories and channels", async () => {
    db.mockQuery("FROM categories WHERE server_id", {
      results: [{ id: "cat_1", server_id: SERVER_ID, name: "TEXT", rank: 0 }],
    });
    db.mockQuery("FROM channels WHERE server_id", {
      results: [
        {
          id: CHANNEL_ID,
          server_id: SERVER_ID,
          name: "general",
          channel_type: "text",
          category_id: "cat_1",
          position: 0,
          allow_public_shares: 1,
          voice_status_text: "Ship room",
          voice_status_media: VOICE_STATUS_MEDIA_JSON,
          description: null,
          created_at: NOW,
        },
      ],
    });

    const result = await listServerChannels(db as any, SERVER_ID);
    expect(result.categories).toHaveLength(1);
    expect(result.channels).toHaveLength(1);
    expect(result.channels![0].name).toBe("general");
    expect((result.channels[0] as any).allow_public_shares).toBe(true);
    expect((result.channels[0] as any).voice_status).toEqual({
      text: "Ship room",
      media: JSON.parse(VOICE_STATUS_MEDIA_JSON),
    });
  });

  it("returns empty arrays when no channels exist", async () => {
    db.mockQuery("FROM categories WHERE server_id", { results: [] });
    db.mockQuery("FROM channels WHERE server_id", { results: [] });

    const result = await listServerChannels(db as any, SERVER_ID);
    expect(result.categories).toEqual([]);
    expect(result.channels).toEqual([]);
  });
});
