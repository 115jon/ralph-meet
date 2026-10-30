import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDB: vi.fn(),
  getVisibleChannels: vi.fn(),
  requireChannelAccess: vi.fn(),
  searchMessages: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/require-permission", () => ({
  getVisibleChannels: mocks.getVisibleChannels,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));

vi.mock("@/services/message-search.service", () => ({
  searchMessages: mocks.searchMessages,
}));

import { GET as serverSearch } from "../servers/$id/search";
import { GET as channelSearch } from "../channels/$id/search";

function fakeDb(member: boolean, channelIds: string[]) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () =>
          member && sql.includes("server_members") ? 1 : null,
        all: async () => ({ results: channelIds.map((id) => ({ id })) }),
      }),
    }),
  };
}

const empty = { messages: [], total: 0, limit: 25, offset: 0, has_more: false };

describe("GET /api/servers/:id/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "u-me" });
    mocks.searchMessages.mockResolvedValue(empty);
  });

  it("rejects non-members", async () => {
    mocks.getDB.mockReturnValue(fakeDb(false, []));
    const res = await serverSearch({
      request: new Request("http://x/api/servers/s-1/search?q=hello"),
      params: { id: "s-1" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid filters", async () => {
    mocks.getDB.mockReturnValue(fakeDb(true, ["c-1"]));
    const res = await serverSearch({
      request: new Request("http://x/api/servers/s-1/search?q=hi&has=gif"),
      params: { id: "s-1" },
    });
    expect(res.status).toBe(400);
    expect(mocks.searchMessages).not.toHaveBeenCalled();
  });

  it("searches only the channels the caller can view", async () => {
    mocks.getDB.mockReturnValue(fakeDb(true, ["c-1", "c-secret"]));
    mocks.getVisibleChannels.mockResolvedValue([{ id: "c-1" }]);
    const res = await serverSearch({
      request: new Request(
        "http://x/api/servers/s-1/search?from=u-ada&has=image&sort=oldest",
      ),
      params: { id: "s-1" },
    });
    expect(res.status).toBe(200);
    expect(mocks.getVisibleChannels).toHaveBeenCalledWith("s-1", "u-me", [
      { id: "c-1" },
      { id: "c-secret" },
    ]);
    const [, scope, query] = mocks.searchMessages.mock.calls[0]!;
    expect(scope).toEqual({ serverId: "s-1", channelIds: ["c-1"] });
    expect(query).toMatchObject({
      authorIds: ["u-ada"],
      has: ["image"],
      sort: "oldest",
    });
  });
});

describe("GET /api/channels/:id/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "u-me" });
    mocks.getDB.mockReturnValue({});
    mocks.searchMessages.mockResolvedValue(empty);
  });

  it("returns the access error when the caller cannot read the channel", async () => {
    mocks.requireChannelAccess.mockResolvedValue(
      Response.json({ error: "nope" }, { status: 403 }),
    );
    const res = await channelSearch({
      request: new Request("http://x/api/channels/dm-1/search?q=lunch"),
      params: { id: "dm-1" },
    });
    expect(res.status).toBe(403);
  });

  it("scopes a DM search to that channel and ignores in:", async () => {
    mocks.requireChannelAccess.mockResolvedValue({ serverId: null });
    const res = await channelSearch({
      request: new Request(
        "http://x/api/channels/dm-1/search?q=lunch&in=other",
      ),
      params: { id: "dm-1" },
    });
    expect(res.status).toBe(200);
    const [, scope, query] = mocks.searchMessages.mock.calls[0]!;
    expect(scope).toEqual({ serverId: null, channelIds: ["dm-1"] });
    expect(query.channelIds).toEqual([]);
    expect(query.text).toBe("lunch");
  });
});
