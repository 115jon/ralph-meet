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
  log: ProfileLogger;
  userId: string;
}

/**
 * The profile of `userId` from our own D1 `users` row, or `null` when there is
 * none (the user has not been synced yet) or D1 could not be read. Callers
 * treat `null` as "no stored profile" and keep the identity the client sent.
 */
export async function resolveMeetingProfile({
  db,
  log,
  userId,
}: ResolveMeetingProfileInput): Promise<MeetingProfile | null> {
  let row: ProfileRow | null;
  try {
    row = await db
      .prepare(
        "SELECT username, display_name, avatar_url, avatar_display FROM users WHERE id = ?",
      )
      .bind(userId)
      .first<ProfileRow>();
  } catch (error) {
    log.error("D1 profile fetch failed:", error);
    return null;
  }
  if (!row) return null;

  return {
    name: row.display_name?.trim() || row.username,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    avatarDisplay: row.avatar_display,
  };
}
