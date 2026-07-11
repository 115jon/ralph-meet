import { describe, expect, it, vi } from "vitest";
import { resolveMeetingProfile } from "../meeting-room/profile-resolver";

type ProfileRow = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
};

function createDb(row: ProfileRow | null) {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => row }),
    }),
  };
}

function createCache(value: { name: string; imageUrl?: string } | null) {
  return {
    get: vi.fn(async () => value),
    put: vi.fn(async () => undefined),
  };
}

describe("Meeting profile resolver", () => {
  it("combines D1 identity and cached Clerk profile data", async () => {
    const cache = createCache({ name: "Clerk Name", imageUrl: "clerk.png" });

    await expect(
      resolveMeetingProfile({
        db: createDb({
          username: "d1-user",
          display_name: "D1 Display",
          avatar_url: "/api/avatars/custom.png",
          avatar_display: "cover",
        }),
        cache,
        clerkSecret: "secret",
        fetch: vi.fn(),
        log: { error: vi.fn() },
        userId: "user-1",
      }),
    ).resolves.toEqual({
      name: "D1 Display",
      username: "d1-user",
      displayName: "D1 Display",
      avatarUrl: "/api/avatars/custom.png",
      avatarDisplay: "cover",
    });
    expect(cache.get).toHaveBeenCalledWith("clerk:profile:user-1", "json");
  });

  it("uses Clerk API on cache miss and stores the response for five minutes", async () => {
    const cache = createCache(null);
    const fetch = vi.fn(async () =>
      Response.json({
        username: "clerk-user",
        first_name: "Ada",
        last_name: "Lovelace",
        image_url: "clerk.png",
      }),
    );

    await expect(
      resolveMeetingProfile({
        db: createDb(null),
        cache,
        clerkSecret: "secret",
        fetch,
        log: { error: vi.fn() },
        userId: "user-1",
      }),
    ).resolves.toEqual({
      name: "Ada Lovelace",
      username: "Ada Lovelace",
      displayName: null,
      avatarUrl: "clerk.png",
      avatarDisplay: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/users/user-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
    expect(cache.put).toHaveBeenCalledWith(
      "clerk:profile:user-1",
      JSON.stringify({ name: "Ada Lovelace", imageUrl: "clerk.png" }),
      { expirationTtl: 300 },
    );
  });

  it("falls back to D1 identity when Clerk is unavailable", async () => {
    const cache = createCache(null);
    const fetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    );

    await expect(
      resolveMeetingProfile({
        db: createDb({
          username: "d1-user",
          display_name: null,
          avatar_url: "https://clerk.example/avatar.png",
          avatar_display: null,
        }),
        cache,
        clerkSecret: "secret",
        fetch,
        log: { error: vi.fn() },
        userId: "user-1",
      }),
    ).resolves.toEqual({
      name: "d1-user",
      username: "d1-user",
      displayName: null,
      avatarUrl: "https://clerk.example/avatar.png",
      avatarDisplay: null,
    });
  });
});
