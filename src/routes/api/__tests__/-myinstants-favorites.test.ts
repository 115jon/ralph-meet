import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

import { GET, POST } from "../myinstants/favorites";

describe("MyInstants soundboard favorites", () => {
  beforeEach(() => {
    mocks.getDB.mockReset();
    mocks.requireAuth.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  });

  it("saves the server sound type and source server", async () => {
    const bind = vi.fn(() => ({ run: vi.fn().mockResolvedValue({}) }));
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind })),
    });

    const response = await POST({
      request: new Request("https://meet.test/api/myinstants/favorites", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          sound: {
            id: "clip-1",
            title: "Server clip",
            url: "/api/soundboard/uploads/clip-1",
            color: "#4f46e5",
            soundType: "server",
            serverId: "server-1",
            source_server_id: "server-1",
          },
        }),
        headers: { "Content-Type": "application/json" },
      }),
    });

    expect(response.status).toBe(200);
    expect(bind).toHaveBeenCalledWith(
      "user-1",
      "clip-1",
      "Server clip",
      "/api/soundboard/uploads/clip-1",
      "#4f46e5",
      "server",
      null,
      "server-1",
    );
  });

  it("returns source server metadata when replaying favorites", async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          id: "clip-1",
          title: "Server clip",
          url: "/api/soundboard/uploads/clip-1",
          color: "#4f46e5",
          soundType: "server",
          source_server_id: "server-1",
          serverId: "server-1",
        },
      ],
    });
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ all })) }));
    mocks.getDB.mockReturnValue({ prepare });

    const response = await GET({
      request: new Request("https://meet.test/api/myinstants/favorites"),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      favorites: [
        expect.objectContaining({
          id: "clip-1",
          soundType: "server",
          source_server_id: "server-1",
          serverId: "server-1",
        }),
      ],
    });
  });

  it("hydrates a legacy server favorite from its authoritative attachment", async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          id: "legacy-clip-1",
          title: "Legacy server clip",
          url: "/api/attachments/channel-1/legacy-clip-1/clip.mp3",
          color: "#4f46e5",
          soundType: "server",
          source_server_id: "legacy-server-1",
          serverId: "legacy-server-1",
          authoritative_server_id: "legacy-server-1",
        },
      ],
    });
    const prepare = vi.fn((query: string) => {
      expect(query).toContain(
        "COALESCE(f.source_server_id, a.soundboard_server_id)",
      );
      expect(query).toContain(
        "CASE WHEN a.soundboard_server_id IS NOT NULL THEN 'server'",
      );
      expect(query).toContain("LEFT JOIN attachments a");
      expect(query).toContain("a.id = f.sound_id");
      expect(query).toContain(
        "a.soundboard_server_id AS authoritative_server_id",
      );
      return { bind: vi.fn(() => ({ all })) };
    });
    mocks.getDB.mockReturnValue({ prepare });

    const response = await GET({
      request: new Request("https://meet.test/api/myinstants/favorites"),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      favorites: [
        expect.objectContaining({
          id: "legacy-clip-1",
          url: "/api/soundboard/uploads/legacy-clip-1",
          soundType: "server",
          source_server_id: "legacy-server-1",
          serverId: "legacy-server-1",
        }),
      ],
    });
  });
});
