import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
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

    db.assertCalled(/DELETE FROM channels WHERE id/);
    expect(result.serverId).toBe(SERVER_ID);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcast).toBeDefined();
    expect(result.broadcast!.event).toBe("CHANNEL_DELETE");
    expect(result.auditLog).toBeDefined();
    expect(result.auditLog!.actionType).toBe("CHANNEL_DELETE");
  });

  it("throws 404 when channel not found", async () => {
    // No mock → returns null by default
    await expect(
      deleteChannel(db as any, "nonexistent")
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

    expect(result.channel.name).toBe("new-channel");
    expect(result.channel.channel_type).toBe("text");
    expect(result.channel.server_id).toBe(SERVER_ID);
    expect(result.channel.id).toBeDefined();
    db.assertCalled(/INSERT INTO channels/);
    expect(result.cacheKeysToInvalidate.length).toBeGreaterThan(0);
    expect(result.broadcast).toBeDefined();
    expect((result.broadcast.data as any).channel).toEqual(result.channel);
    expect(result.auditLog).toBeDefined();
  });

  it("creates a voice channel", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "Voice Room",
      channel_type: "voice",
    });

    expect(result.channel.channel_type).toBe("voice");
    expect(result.channel.name).toBe("Voice Room");
  });

  it("sanitizes text channel name", async () => {
    const result = await createChannel(db as any, SERVER_ID, USER_ID, {
      name: "My Cool Channel!!!",
      channel_type: "text",
    });

    // Text channels should be sanitized (lowercase, hyphens)
    expect(result.channel.name).toBe("my-cool-channel");
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
  });

  it("throws when sanitized name is empty", async () => {
    await expect(
      createChannel(db as any, SERVER_ID, USER_ID, {
        name: "!!!",
        channel_type: "text",
      })
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
    const result = await updateVoiceChannelStatus(db as any, CHANNEL_ID, USER_ID, {
      text: "  Working session  ",
      media: JSON.parse(VOICE_STATUS_MEDIA_JSON),
    });

    db.assertCalled(/UPDATE channels SET voice_status_text = \?, voice_status_media = \? WHERE id = \?/);
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
      updateVoiceChannelStatus(db as any, CHANNEL_ID, USER_ID, { text: "nope" })
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
