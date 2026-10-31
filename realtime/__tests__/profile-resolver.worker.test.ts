import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveMeetingProfile,
  type ResolveMeetingProfileInput,
} from "../meeting-room/profile-resolver";

// Profiles come from our own D1 `users` row and nothing else. With no row the
// answer is `null` (the caller keeps the identity the client sent); there is no
// third-party lookup to fall back to, and these tests fail if one appears.

type ProfileRow = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
};

function createDb(row: ProfileRow | null) {
  const bound: string[] = [];
  const queries: string[] = [];
  const db: ResolveMeetingProfileInput["db"] = {
    prepare: (query) => {
      queries.push(query);
      return {
        // The resolver asks for its own row type through `first<T>()`; the
        // fake returns the canned row whatever T is.
        bind: (value) => {
          bound.push(value);
          return { first: async <T>() => row as T | null };
        },
      };
    },
  };
  return { db, bound, queries };
}

function resolve(row: ProfileRow | null, userId = "user-1") {
  const { db, bound, queries } = createDb(row);
  const log = { error: vi.fn() };
  return {
    bound,
    log,
    queries,
    profile: resolveMeetingProfile({ db, log, userId }),
  };
}

describe("Meeting profile resolver", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  afterEach(() => {
    // Whatever the case, nothing may leave the Worker to build a profile.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockClear();
  });

  it("returns the stored identity of the requested user", async () => {
    const { profile, bound, queries } = resolve(
      {
        username: "d1-user",
        display_name: "D1 Display",
        avatar_url: "/api/avatars/custom.png",
        avatar_display: "cover",
      },
      "user-42",
    );

    await expect(profile).resolves.toEqual({
      name: "D1 Display",
      username: "d1-user",
      displayName: "D1 Display",
      avatarUrl: "/api/avatars/custom.png",
      avatarDisplay: "cover",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("FROM users WHERE id = ?");
    expect(bound).toEqual(["user-42"]);
  });

  it("names the user after their handle when there is no display name", async () => {
    await expect(
      resolve({
        username: "d1-user",
        display_name: null,
        avatar_url: null,
        avatar_display: null,
      }).profile,
    ).resolves.toEqual({
      name: "d1-user",
      username: "d1-user",
      displayName: null,
      avatarUrl: undefined,
      avatarDisplay: null,
    });

    const blank = await resolve({
      username: "d1-user",
      display_name: "   ",
      avatar_url: null,
      avatar_display: null,
    }).profile;
    expect(blank?.name).toBe("d1-user");
  });

  it("trims a padded display name for the name", async () => {
    const result = await resolve({
      username: "d1-user",
      display_name: "  Ada  ",
      avatar_url: null,
      avatar_display: null,
    }).profile;

    expect(result?.name).toBe("Ada");
  });

  it("keeps an avatar hosted outside our own avatar route", async () => {
    const result = await resolve({
      username: "d1-user",
      display_name: null,
      avatar_url: "https://cdn.example/avatar.png",
      avatar_display: null,
    }).profile;

    expect(result?.avatarUrl).toBe("https://cdn.example/avatar.png");
  });

  it("has no profile for a user without a stored row", async () => {
    const { profile, log } = resolve(null);

    await expect(profile).resolves.toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("has no profile, and says why, when D1 cannot be read", async () => {
    const failure = new Error("D1 unavailable");
    const log = { error: vi.fn() };
    const db: ResolveMeetingProfileInput["db"] = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw failure;
          },
        }),
      }),
    };

    await expect(
      resolveMeetingProfile({ db, log, userId: "user-1" }),
    ).resolves.toBeNull();
    expect(log.error).toHaveBeenCalledWith("D1 profile fetch failed:", failure);
  });
});
