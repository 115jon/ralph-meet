import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDB: vi.fn(),
  ensureUserProfileSchema: vi.fn(),
  db: {
    prepare: vi.fn(),
  },
}));

type DbTestState = typeof mocks.db & { lastBindings?: unknown[] };

vi.mock("@/lib/api-helpers", () => ({
  apiError: (error: string, status = 400, code?: string) =>
    Response.json({ error, code }, { status }),
  apiSuccess: (data: unknown) => Response.json(data),
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/ensure-user-profile-schema", () => ({
  ensureUserProfileSchema: mocks.ensureUserProfileSchema,
}));
vi.mock("@/services/user.service", () => ({ getMe: vi.fn() }));
vi.mock("@/lib/kova-auth-server", () => ({ getCurrentUser: vi.fn() }));

import { PATCH } from "../users/me";

describe("authenticated user sound settings", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    mocks.ensureUserProfileSchema.mockReset();
    mocks.getDB.mockReturnValue(mocks.db);
    mocks.db.prepare.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    );

    const response = await PATCH({
      request: new Request("https://meet.test/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ sound_settings: {} }),
      }),
    });

    expect(response.status).toBe(401);
  });

  it("persists only an authorized server selection without its media URL", async () => {
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sound_settings")) {
        return {
          bind: () => ({ first: async () => ({ sound_settings: null }) }),
        };
      }
      if (sql.includes("FROM attachments")) {
        return {
          bind: () => ({
            first: async () => ({
              id: "clip-1",
              server_id: "server-1",
              sound_name: "Authorized clip",
              sound_emoji: "🔊",
              sound_volume: 0.5,
            }),
          }),
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: async () => {
            (mocks.db as DbTestState).lastBindings = bindings;
          },
        }),
      };
    });

    const response = await PATCH({
      request: new Request("https://meet.test/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          sound_settings: {
            voiceJoinSoundboard: {
              enabled: true,
              sound: {
                source: "server",
                serverId: "server-1",
                soundId: "clip-1",
                name: "Forged name",
                mediaUrl: "https://attacker.test/clip.mp3",
                volume: 1,
              },
            },
            voiceLeaveSoundboard: { enabled: false, sound: null },
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sound_settings: {
        voiceJoinSoundboard: { "*": { sound: Record<string, unknown> } };
      };
    };
    expect(body.sound_settings.voiceJoinSoundboard["*"].sound).toEqual({
      source: "server",
      soundId: "clip-1",
      serverId: "server-1",
      name: "Authorized clip",
      emoji: "🔊",
      volume: 0.5,
    });
    expect(
      JSON.stringify((mocks.db as DbTestState).lastBindings),
    ).not.toContain("attacker.test");
  });

  it("rejects a server selection the user cannot access", async () => {
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sound_settings")) {
        return {
          bind: () => ({ first: async () => ({ sound_settings: null }) }),
        };
      }
      return {
        bind: () => ({ first: async () => null }),
      };
    });

    const response = await PATCH({
      request: new Request("https://meet.test/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          sound_settings: {
            voiceJoinSoundboard: {
              enabled: true,
              sound: {
                source: "server",
                serverId: "server-1",
                soundId: "clip-1",
                name: "Unavailable",
                volume: 1,
              },
            },
            voiceLeaveSoundboard: { enabled: false, sound: null },
          },
        }),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("does not revalidate an omitted inaccessible trigger when another trigger changes", async () => {
    const inaccessibleLeave = {
      enabled: true,
      sound: {
        source: "server",
        serverId: "old-server",
        soundId: "old-clip",
        name: "Old clip",
        mediaUrl: "https://attacker.test/old-clip.mp3",
        volume: 1,
      },
    };
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sound_settings")) {
        return {
          bind: () => ({
            first: async () => ({
              sound_settings: JSON.stringify({
                voiceJoinSoundboard: { enabled: false, sound: null },
                voiceLeaveSoundboard: inaccessibleLeave,
              }),
            }),
          }),
        };
      }
      if (sql.includes("FROM attachments")) {
        return {
          bind: () => ({
            first: async () => null,
          }),
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: async () => {
            (mocks.db as DbTestState).lastBindings = bindings;
          },
        }),
      };
    });

    const response = await PATCH({
      request: new Request("https://meet.test/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          sound_settings: {
            voiceJoinSoundboard: { enabled: false, sound: null },
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(JSON.stringify((mocks.db as DbTestState).lastBindings)).toContain(
      "old-clip",
    );
    expect(
      JSON.stringify((mocks.db as DbTestState).lastBindings),
    ).not.toContain("attacker.test");
  });

  it("persists multiple trigger scopes and validates every server clip", async () => {
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sound_settings")) {
        return {
          bind: () => ({ first: async () => ({ sound_settings: null }) }),
        };
      }
      if (sql.includes("FROM attachments")) {
        return {
          bind: (_userId: string, serverId: string, soundId: string) => ({
            first: async () =>
              serverId === "server-1" && soundId === "clip-1"
                ? {
                    id: "clip-1",
                    server_id: "server-1",
                    sound_name: "Server clip",
                    sound_emoji: "🎚️",
                    sound_volume: 0.75,
                  }
                : null,
          }),
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: async () => {
            (mocks.db as DbTestState).lastBindings = bindings;
          },
        }),
      };
    });

    const response = await PATCH({
      request: new Request("https://meet.test/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          sound_settings: {
            voiceJoinSoundboard: {
              "*": {
                enabled: true,
                sound: {
                  source: "server",
                  serverId: "server-1",
                  soundId: "clip-1",
                  name: "Forged global name",
                  volume: 1,
                },
              },
              "server-2": {
                enabled: true,
                sound: {
                  source: "server",
                  serverId: "server-1",
                  soundId: "clip-1",
                  name: "Forged override name",
                  volume: 1,
                },
              },
            },
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(JSON.stringify((mocks.db as DbTestState).lastBindings)).toContain(
      "Server clip",
    );
    expect(
      JSON.stringify((mocks.db as DbTestState).lastBindings),
    ).not.toContain("Forged global name");
  });
});
