import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";

const hoisted = vi.hoisted(() => ({
  hydrateSocialEmbedsMock: vi.fn(),
}));

vi.mock("@/lib/share-embed-refresh", () => ({
  hydrateSocialEmbeds: hoisted.hydrateSocialEmbedsMock,
}));

import { listMessages } from "../message.service";

const USER_ID = "user_abc";
const CHANNEL_ID = "channel_456";

describe("listMessages embed hydration", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
    hoisted.hydrateSocialEmbedsMock.mockReset();
  });

  it("upgrades stale stored embeds and persists the refreshed payload", async () => {
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
    const hydratedEmbeds = [
      {
        ...staleEmbeds[0],
        rawTitle: "rukia!",
        media: [
          {
            type: "image" as const,
            url: "https://scontent-ord5-2.cdninstagram.com/slide-1.jpg?oe=6A53095B",
            width: 2728,
            height: 1817,
          },
          {
            type: "image" as const,
            url: "https://scontent-ord5-1.cdninstagram.com/slide-2.jpg?oe=6A532925",
            width: 2727,
            height: 1816,
          },
        ],
        author: {
          name: "tasyiu",
          url: "https://www.instagram.com/tasyiu",
          iconURL: "https://scontent-ord5-1.cdninstagram.com/avatar.jpg?oe=6A53095B",
          isVerified: true,
        },
        metrics: {
          likes: 1073,
          comments: 15,
        },
        timestamp: "2026-06-24T03:40:02.000Z",
      },
    ];

    db.mockQuery("WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?", {
      results: [{
        id: "msg_1",
        channel_id: CHANNEL_ID,
        author_id: USER_ID,
        content: "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==",
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
      }],
    });

    hoisted.hydrateSocialEmbedsMock.mockResolvedValue(hydratedEmbeds);

    const result = await listMessages(db as any, CHANNEL_ID, USER_ID);

    expect(hoisted.hydrateSocialEmbedsMock).toHaveBeenCalledOnce();
    expect(result.messages[0]?.embeds).toEqual(hydratedEmbeds);
    db.assertCalled(/UPDATE messages SET embeds = \? WHERE id = \?/);
  });
});
