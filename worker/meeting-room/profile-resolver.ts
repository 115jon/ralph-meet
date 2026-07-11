interface ProfileRow {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
}

interface ProfileDatabase {
  prepare(query: string): {
    bind(value: string): {
      first<T>(): Promise<T | null>;
    };
  };
}

interface ProfileCache {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
}

interface ClerkProfileResponse {
  username?: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
  unsafe_metadata?: { displayName?: string };
}

interface ProfileLogger {
  error(...args: unknown[]): void;
}

export interface MeetingProfile {
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: string | null;
}

export interface ResolveMeetingProfileInput {
  db: ProfileDatabase;
  cache: ProfileCache;
  clerkSecret: string;
  fetch: typeof globalThis.fetch;
  log: ProfileLogger;
  userId: string;
}

export async function resolveMeetingProfile({
  db,
  cache,
  clerkSecret,
  fetch,
  log,
  userId,
}: ResolveMeetingProfileInput): Promise<MeetingProfile | null> {
  let d1Name: string | null = null;
  let d1Username: string | null = null;
  let d1DisplayName: string | null = null;
  let d1Avatar: string | null = null;
  let d1AnyAvatar: string | null = null;
  let d1AvatarDisplay: string | null = null;

  try {
    const row = await db
      .prepare(
        "SELECT username, display_name, avatar_url, avatar_display FROM users WHERE id = ?",
      )
      .bind(userId)
      .first<ProfileRow>();
    if (row) {
      d1Username = row.username;
      d1DisplayName = row.display_name;
      d1Name = row.display_name?.trim() || row.username;
      d1AnyAvatar = row.avatar_url;
      d1AvatarDisplay = row.avatar_display;
      if (row.avatar_url?.startsWith("/api/avatars/")) {
        d1Avatar = row.avatar_url;
      }
    }
  } catch (error) {
    // D1 is a fallback source; Clerk can still provide the profile.
    log.error("D1 profile fetch failed:", error);
  }

  const cacheKey = `clerk:profile:${userId}`;
  type ClerkCached = { name: string; imageUrl?: string };
  let clerkData: ClerkCached | null = null;
  try {
    clerkData = await cache.get<ClerkCached>(cacheKey, "json");
  } catch {
    // Treat malformed or unavailable cache data as a miss.
  }

  if (!clerkData) {
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${clerkSecret}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      log.error(`Clerk API error: ${response.status}`);
      if (d1Name) {
        return {
          name: d1Name,
          username: d1Username ?? d1Name,
          displayName: d1DisplayName,
          avatarUrl: d1Avatar ?? d1AnyAvatar ?? undefined,
          avatarDisplay: d1AvatarDisplay,
        };
      }
      return null;
    }

    const user = (await response.json()) as ClerkProfileResponse;
    const clerkName =
      user.unsafe_metadata?.displayName ||
      [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      user.username ||
      "Guest";
    clerkData = { name: clerkName, imageUrl: user.image_url };
    cache
      .put(cacheKey, JSON.stringify(clerkData), { expirationTtl: 300 })
      .catch(() => {});
  }

  return {
    name: d1Name || clerkData.name,
    username: d1Username ?? d1Name ?? clerkData.name,
    displayName: d1DisplayName,
    avatarUrl: d1Avatar ?? clerkData.imageUrl,
    avatarDisplay: d1AvatarDisplay,
  };
}
