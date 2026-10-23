import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "@/lib/__tests__/mock-d1";
import type { MessageSearchQuery } from "@/lib/message-search";
import { searchMessages } from "../message-search.service";

const NOW = "2026-10-22T14:32:00.000Z";

function query(
  overrides: Partial<MessageSearchQuery> = {},
): MessageSearchQuery {
  return {
    text: "",
    authorIds: [],
    mentionIds: [],
    channelIds: [],
    has: [],
    before: null,
    after: null,
    pinned: null,
    sort: "newest",
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

const scope = { serverId: "s-1", channelIds: ["c-1", "c-2"] };

describe("searchMessages", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns formatted results with author, attachments and embed counts", async () => {
    db.mockQuery("FROM messages m", {
      results: [
        {
          id: "m1",
          channel_id: "c-1",
          author_id: "u1",
          content: "hello world",
          created_at: NOW,
          updated_at: null,
          is_pinned: 1,
          embeds: '[{"url":"https://x"}]',
          author_username: "ada",
          author_display_name: "Ada",
          author_avatar_url: "/api/avatars/u1.webp",
          author_avatar_display: null,
          author_display_name_style: null,
          channel_name: "general",
        },
      ],
    });
    db.mockQuery(/SELECT COUNT/, { total: 30 });
    db.mockQuery("FROM attachments", {
      results: [
        {
          id: "a1",
          message_id: "m1",
          filename: "shot.png",
          content_type: "image/png",
          size_bytes: 1200,
        },
      ],
    });

    const result = await searchMessages(
      db as never,
      scope,
      query({ text: "hello" }),
    );

    expect(result.total).toBe(30);
    expect(result.has_more).toBe(true);
    expect(result.messages[0]).toMatchObject({
      id: "m1",
      channel_name: "general",
      is_pinned: true,
      embed_count: 1,
      author: { username: "ada", display_name: "Ada" },
      attachments: [{ id: "a1", content_type: "image/png" }],
    });
  });

  it("returns nothing without touching D1 when no channel is visible", async () => {
    const result = await searchMessages(
      db as never,
      { serverId: "s-1", channelIds: [] },
      query({ text: "hello" }),
    );
    expect(result.messages).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it("intersects in: with the visible channels", async () => {
    const result = await searchMessages(
      db as never,
      scope,
      query({ text: "hi", channelIds: ["c-hidden"] }),
    );
    expect(result.total).toBe(0);
    expect(db.calls).toHaveLength(0);

    await searchMessages(
      db as never,
      scope,
      query({ text: "hi", channelIds: ["c-2", "c-hidden"] }),
    );
    db.assertCalledWith("FROM messages m", ["s-1", JSON.stringify(["c-2"])]);
  });

  it("binds every term, author, mention, pinned and date filter", async () => {
    await searchMessages(
      db as never,
      scope,
      query({
        text: 'token "design system"',
        authorIds: ["u1"],
        mentionIds: ["u2"],
        pinned: true,
        after: "2026-10-01T00:00:00.000Z",
        before: "2026-10-10T00:00:00.000Z",
      }),
    );
    const [call] = db.getCalls("ORDER BY");
    expect(call!.bindings).toEqual([
      "s-1",
      JSON.stringify(["c-1", "c-2"]),
      "token",
      "design system",
      JSON.stringify(["u1"]),
      JSON.stringify(["u2"]),
      1,
      "2026-10-01T00:00:00.000Z",
      "2026-10-10T00:00:00.000Z",
      25,
      0,
    ]);
    expect(call!.sql).toContain("m.author_id IN");
    expect(call!.sql).toContain("'@' || lower(mu.username)");
    expect(call!.sql).toContain("m.is_pinned = ?");
    expect(call!.sql).toContain("julianday(m.created_at) >= julianday(?)");
  });

  it("adds a clause per has: value", async () => {
    await searchMessages(
      db as never,
      scope,
      query({ has: ["link", "image", "embed"] }),
    );
    const [call] = db.getCalls("ORDER BY");
    expect(call!.sql).toContain("instr(m.content, 'https://')");
    expect(call!.sql).toContain("a.content_type LIKE 'image/%'");
    expect(call!.sql).toContain("m.embeds NOT IN ('', '[]')");
  });

  it("orders oldest first and by relevance when asked", async () => {
    await searchMessages(db as never, scope, query({ sort: "oldest" }));
    expect(db.getCalls("ORDER BY")[0]!.sql).toContain("m.created_at ASC");

    db.reset();
    await searchMessages(
      db as never,
      scope,
      query({ text: "token scale", sort: "relevant" }),
    );
    const call = db.getCalls("ORDER BY")[0]!;
    expect(call.sql).toContain("length(m.content) ASC");
    expect(call.bindings.slice(-4)).toEqual(["token scale", "token", 25, 0]);
  });

  it("drops the server constraint for DM scope", async () => {
    await searchMessages(
      db as never,
      { serverId: null, channelIds: ["dm-1"] },
      query({ text: "lunch" }),
    );
    const call = db.getCalls("ORDER BY")[0]!;
    expect(call.sql).not.toContain("c.server_id = ?");
    expect(call.bindings[0]).toBe(JSON.stringify(["dm-1"]));
  });
});
