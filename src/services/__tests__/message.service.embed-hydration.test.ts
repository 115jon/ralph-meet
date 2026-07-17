import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";

const hoisted = vi.hoisted(() => ({
  hydrateSocialEmbedsMock: vi.fn(),
}));

vi.mock("@/lib/share-embed-refresh", () => ({
  hydrateSocialEmbeds: hoisted.hydrateSocialEmbedsMock,
}));

import { listMessages, refreshMessageEmbeds } from "../message.service";

const USER_ID = "user_abc";
const CHANNEL_ID = "channel_456";

describe("listMessages embed hydration", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    hoisted.hydrateSocialEmbedsMock.mockReset();
  });

  it("returns stored embeds without awaiting social hydration", async () => {
    const staleEmbeds = [
      {
        id: "embed_1",
        url: "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
        type: "rich" as const,
        provider: {
          name: "Instagram",
          url: "https://www.instagram.com",
        },
        thumbnail: {
          url: "https://scontent-ord5-2.cdninstagram.com/stale-slide-1.jpg?oe=6A53095B",
          width: 640,
          height: 640,
        },
        fields: [],
      },
    ];
    db.mockQuery(
      "WHERE m.channel_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?",
      {
        results: [
          {
            id: "msg_1",
            channel_id: CHANNEL_ID,
            author_id: USER_ID,
            content:
              "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
            reply_to_id: null,
            is_pinned: 0,
            created_at: "2026-07-07T18:00:00.000Z",
            updated_at: null,
            author_username: "alice",
            author_display_name: null,
            author_avatar_url: null,
            author_avatar_display: null,
            embeds: JSON.stringify(staleEmbeds),
            reply_count: 0,
          },
        ],
      },
    );

    const result = await listMessages(db as any, CHANNEL_ID, USER_ID);

    expect(hoisted.hydrateSocialEmbedsMock).not.toHaveBeenCalled();
    expect(result.messages[0]?.embeds).toEqual(staleEmbeds);
    db.assertNotCalled(/UPDATE messages SET embeds = \? WHERE id = \?/);
  });

  it("refreshes embeds through the explicit background operation", async () => {
    const originalEmbeds = [
      { url: "https://www.instagram.com/p/example", type: "rich" as const },
    ];
    const refreshedEmbeds = [
      {
        ...originalEmbeds[0],
        video: { url: "https://cdn.test/video.mp4" },
      },
    ];
    db.mockQuery("SELECT id, embeds FROM messages", {
      results: [{ id: "msg_1", embeds: JSON.stringify(originalEmbeds) }],
    });
    hoisted.hydrateSocialEmbedsMock.mockResolvedValue(refreshedEmbeds);

    const updates = await refreshMessageEmbeds(db as any, CHANNEL_ID, [
      "msg_1",
    ]);

    expect(updates).toEqual([
      { id: "msg_1", channel_id: CHANNEL_ID, embeds: refreshedEmbeds },
    ]);
    expect(db.getCalls("UPDATE messages SET embeds")).toHaveLength(1);
  });
});
