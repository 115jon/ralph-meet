import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ensureUserProfileSchema } from "@/lib/ensure-user-profile-schema";
import { getCurrentUser } from "@/lib/kova-auth-server";
import { DEFAULT_MEDIA_CONTENT_FILTER } from "@/lib/media-content-filter";
import {
  applyProfileThemeDefaults,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import { normalizeUsernameForStorage } from "@/lib/validations";
import { ServiceError } from "@/lib/service-error";
import { getMe } from "@/services/user.service";
import { clog } from "@/lib/console-logger";
import type { AvatarDisplay } from "@/lib/avatar-display";
import {
  ALL_SERVERS_SOUND_SCOPE,
  normalizeSoundboardTriggerMap,
  normalizeSoundboardTriggerConfig,
  validatePersistedSoundboardTriggerMap,
  type SoundboardTriggerMap,
} from "@/lib/voice/soundboard-trigger";

const log = clog("users/me");

type UserProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: AvatarDisplay | null;
  banner_url: string | null;
  banner_content_type: string | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  profile_accent_color: string | null;
  profile_background_color: string | null;
  profile_banner_color: string | null;
  display_name_style: DisplayNameStyle | string | null;
  theme_preference: string | null;
  theme_sync_enabled: number;
  media_content_filter: string;
  updated_at: string | null;
  created_at: string | null;
  bio: string | null;
  pronouns: string | null;
  status: string;
  custom_status: string | null;
};

const USER_ID_REFERENCES = [
  ["servers", "owner_id"],
  ["server_members", "user_id"],
  ["member_roles", "user_id"],
  ["messages", "author_id"],
  ["invites", "inviter_id"],
  ["relationships", "user_id"],
  ["relationships", "target_user_id"],
  ["dm_recipients", "user_id"],
  ["read_states", "user_id"],
  ["attachments", "user_id"],
  ["message_reactions", "user_id"],
  ["server_bans", "user_id"],
  ["server_bans", "banned_by"],
  ["notifications", "user_id"],
  ["notifications", "from_user_id"],
  ["server_audit_logs", "actor_id"],
] as const;

const GET = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  await ensureUserProfileSchema(db);

  try {
    const user = await getMe(db, userId);
    await backfillMissingAvatar(db, user, request.headers);
    const settingsRow = await db
      .prepare("SELECT sound_settings FROM users WHERE id = ?")
      .bind(userId)
      .first<{ sound_settings: string | null }>();
    return apiSuccess({
      ...user,
      sound_settings: parseStoredSoundSettings(settingsRow?.sound_settings),
    });
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) {
      try {
        const synced = await syncUserFromRalphAuth(db, userId, request.headers);
        if (synced) return apiSuccess(synced);
      } catch (syncErr) {
        log.error("Auto-sync from Ralph Auth failed:", syncErr);
      }
      return apiError(
        "User profile not found. Please sign out and sign back in.",
        404,
      );
    }
    throw e;
  }
};

export const PATCH = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const body = await request.json().catch(() => null);
  const incoming =
    body && typeof body === "object" && "sound_settings" in body
      ? (body as { sound_settings?: unknown }).sound_settings
      : null;
  if (!incoming || typeof incoming !== "object") {
    return apiError("Invalid sound settings", 400, "INVALID_SOUND_SETTINGS");
  }

  const db = getDB();
  await ensureUserProfileSchema(db);
  const currentRow = await db
    .prepare("SELECT sound_settings FROM users WHERE id = ?")
    .bind(userId)
    .first<{ sound_settings: string | null }>();
  const current = parseStoredSoundSettingsRecord(currentRow?.sound_settings);
  const raw = incoming as Record<string, unknown>;
  const requestedFields = [
    "voiceJoinSoundboard",
    "voiceLeaveSoundboard",
    "soundboardVolume",
  ] as const;
  const changedFields = requestedFields.filter((field) => field in raw);
  if (changedFields.length === 0) {
    return apiError(
      "No trigger settings supplied",
      400,
      "INVALID_SOUND_SETTINGS",
    );
  }

  const resolveServerSound = async (serverId: string, soundId: string) => {
    const row = await db
      .prepare(
        `SELECT a.id, a.soundboard_server_id AS server_id,
                a.sound_name, a.sound_emoji,
                COALESCE(a.sound_volume, 1.0) AS sound_volume
         FROM attachments a
         JOIN server_members sm
           ON sm.server_id = a.soundboard_server_id AND sm.user_id = ?
         WHERE a.soundboard_server_id = ? AND a.id = ?
         LIMIT 1`,
      )
      .bind(userId, serverId, soundId)
      .first<{
        id: string;
        server_id: string;
        sound_name: string | null;
        sound_emoji: string | null;
        sound_volume: number;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      serverId: row.server_id,
      name: row.sound_name || "Sound",
      ...(row.sound_emoji ? { emoji: row.sound_emoji } : {}),
      volume: Number(row.sound_volume),
    };
  };

  const validated: Partial<
    Record<(typeof requestedFields)[number], SoundboardTriggerMap | number>
  > = {};
  for (const field of changedFields) {
    if (field === "soundboardVolume") {
      const volume = raw[field];
      if (
        typeof volume !== "number" ||
        !Number.isFinite(volume) ||
        volume < 0 ||
        volume > 100
      ) {
        return apiError(
          "Soundboard volume is invalid",
          400,
          "INVALID_SOUND_SETTINGS",
        );
      }
      validated[field] = volume;
      continue;
    }
    const value = await validatePersistedSoundboardTriggerMap(
      raw[field],
      resolveServerSound,
    );
    if (!value) {
      return apiError(
        "Soundboard trigger selection is invalid or unavailable",
        400,
        "INVALID_SOUND_SELECTION",
      );
    }
    validated[field] = value;
  }

  const soundSettings = JSON.stringify({ ...current, ...validated });
  await db
    .prepare("UPDATE users SET sound_settings = ?, updated_at = ? WHERE id = ?")
    .bind(soundSettings, new Date().toISOString(), userId)
    .run();

  return apiSuccess({ sound_settings: validated });
};

function parseStoredSoundSettingsRecord(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const sanitized = { ...record };
    for (const field of ["voiceJoinSoundboard", "voiceLeaveSoundboard"]) {
      if (field in record) {
        sanitized[field] = parseStoredTriggerMap(record[field]);
      }
    }
    return sanitized;
  } catch {
    return {};
  }
}

function parseStoredSoundSettings(value: string | null | undefined): {
  voiceJoinSoundboard: SoundboardTriggerMap;
  voiceLeaveSoundboard: SoundboardTriggerMap;
  soundboardVolume: number;
} {
  if (!value) {
    return {
      voiceJoinSoundboard: {
        [ALL_SERVERS_SOUND_SCOPE]: { enabled: false, sound: null },
      },
      voiceLeaveSoundboard: {
        [ALL_SERVERS_SOUND_SCOPE]: { enabled: false, sound: null },
      },
      soundboardVolume: 100,
    };
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      voiceJoinSoundboard: parseStoredTriggerMap(parsed.voiceJoinSoundboard),
      voiceLeaveSoundboard: parseStoredTriggerMap(parsed.voiceLeaveSoundboard),
      soundboardVolume:
        typeof parsed.soundboardVolume === "number" &&
        Number.isFinite(parsed.soundboardVolume)
          ? Math.max(0, Math.min(100, parsed.soundboardVolume))
          : 100,
    };
  } catch {
    return {
      voiceJoinSoundboard: {
        [ALL_SERVERS_SOUND_SCOPE]: { enabled: false, sound: null },
      },
      voiceLeaveSoundboard: {
        [ALL_SERVERS_SOUND_SCOPE]: { enabled: false, sound: null },
      },
      soundboardVolume: 100,
    };
  }
}

function parseStoredTriggerMap(value: unknown): SoundboardTriggerMap {
  const normalized = normalizeSoundboardTriggerMap(value);
  return Object.fromEntries(
    Object.entries(normalized).map(([scope, config]) => {
      const normalizedConfig = normalizeSoundboardTriggerConfig(config);
      if (!normalizedConfig.sound) return [scope, normalizedConfig];
      const { mediaUrl: _mediaUrl, ...sound } = normalizedConfig.sound;
      return [scope, { enabled: normalizedConfig.enabled, sound }];
    }),
  );
}

async function backfillMissingAvatar(
  db: any,
  user: UserProfileRow,
  headers: Headers,
) {
  if (user.avatar_url) return;

  try {
    const authUser = await getCurrentUser(headers);
    const avatarUrl = authUser?.imageUrl ?? authUser?.image ?? null;
    if (!avatarUrl) return;

    await db
      .prepare(
        `UPDATE users SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')`,
      )
      .bind(avatarUrl, user.id)
      .run();
    user.avatar_url = avatarUrl;
  } catch {
    // Avatar backfill is best-effort; a missing avatar should not block /me.
  }
}

async function syncUserFromRalphAuth(
  db: any,
  userId: string,
  headers: Headers,
): Promise<UserProfileRow | null> {
  const authUser = await getCurrentUser(headers);
  if (!authUser) return null;

  const email =
    authUser.email ?? authUser.primaryEmailAddress?.emailAddress ?? null;
  const username = normalizeUsernameForStorage(
    authUser.username ??
      (email ? email.split("@")[0] : null) ??
      `user_${userId.slice(-6)}`,
    `user_${userId.slice(-6)}`,
  );
  const fullName = [authUser.firstName, authUser.lastName]
    .filter(Boolean)
    .join(" ");
  const displayName = authUser.name ?? (fullName || username);
  const avatarUrl = authUser.imageUrl ?? authUser.image ?? null;
  const bio = authUser.bio ?? null;
  const now = new Date().toISOString();
  const defaultProfileTheme = applyProfileThemeDefaults({});

  await ensureIdentityClaimsTable(db);

  const claimedUser = await claimLegacyIdentity(db, {
    authUserId: userId,
    email,
    username,
    displayName,
    avatarUrl,
    bio,
    now,
  });

  if (claimedUser) return claimedUser;

  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, avatar_url, bio, status, profile_accent_color, profile_background_color, created_at)
       VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username,
         display_name = CASE
           WHEN users.display_name IS NOT NULL AND users.display_name != '' THEN users.display_name
           ELSE excluded.display_name
         END,
         avatar_url = CASE
           WHEN users.avatar_url LIKE '/api/avatars/%' THEN users.avatar_url
           ELSE excluded.avatar_url
         END,
         bio = COALESCE(users.bio, excluded.bio),
         profile_accent_color = COALESCE(users.profile_accent_color, excluded.profile_accent_color),
         profile_background_color = COALESCE(users.profile_background_color, excluded.profile_background_color)`,
    )
    .bind(
      userId,
      username,
      displayName,
      avatarUrl,
      bio,
      defaultProfileTheme.profile_accent_color,
      defaultProfileTheme.profile_background_color,
      now,
    )
    .run();

  return {
    id: userId,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    avatar_display: null,
    banner_url: null,
    banner_content_type: null,
    nameplate_url: null,
    nameplate_content_type: null,
    profile_accent_color: defaultProfileTheme.profile_accent_color,
    profile_background_color: defaultProfileTheme.profile_background_color,
    profile_banner_color: null,
    display_name_style: null,
    theme_preference: null,
    theme_sync_enabled: 0,
    media_content_filter: DEFAULT_MEDIA_CONTENT_FILTER,
    updated_at: now,
    created_at: now,
    bio,
    pronouns: null,
    status: "online",
    custom_status: null,
  };
}

async function ensureIdentityClaimsTable(db: any) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_identity_claims (
        auth_user_id TEXT PRIMARY KEY,
        legacy_user_id TEXT NOT NULL UNIQUE,
        email TEXT,
        match_method TEXT NOT NULL,
        claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    )
    .run();
}

async function claimLegacyIdentity(
  db: any,
  input: {
    authUserId: string;
    email: string | null;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    now: string;
  },
): Promise<UserProfileRow | null> {
  const existingClaim = (await db
    .prepare(
      "SELECT legacy_user_id FROM user_identity_claims WHERE auth_user_id = ? LIMIT 1",
    )
    .bind(input.authUserId)
    .first()
    .catch(() => null)) as { legacy_user_id: string } | null;

  if (existingClaim?.legacy_user_id) {
    const mapped = await getMe(db, input.authUserId).catch(() => null);
    if (mapped) return mapped;
  }

  const candidates = buildClaimCandidates(input);
  if (!candidates.length) return null;

  const placeholders = candidates.map(() => "?").join(", ");
  const { results = [] } = (await db
    .prepare(
      `SELECT id, username, display_name, avatar_url, avatar_display, updated_at, bio, pronouns, status, custom_status
            , banner_url, banner_content_type, nameplate_url, nameplate_content_type
            , profile_accent_color, profile_background_color, profile_banner_color, display_name_style
            , theme_preference, theme_sync_enabled, media_content_filter
        FROM users
        WHERE id != ? AND lower(username) IN (${placeholders})`,
    )
    .bind(input.authUserId, ...candidates)
    .all()
    .catch(() => ({ results: [] }))) as { results?: UserProfileRow[] };

  if (results.length !== 1) return null;
  const legacy = results[0];

  const existingNewUser = (await db
    .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
    .bind(input.authUserId)
    .first()
    .catch(() => null)) as { id: string } | null;

  if (!existingNewUser) {
    const legacyProfileTheme = applyProfileThemeDefaults(legacy);
    const claimedUsername = normalizeUsernameForStorage(
      legacy.username,
      `user_${input.authUserId.slice(-6)}`,
    );
    const legacyHoldingUsername = normalizeUsernameForStorage(
      `claimed_${legacy.id.slice(-24)}`,
      `legacy_${legacy.id.slice(-8)}`,
    );
    await db.batch([
      db
        .prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(legacyHoldingUsername, legacy.id),
      db
        .prepare(
          `INSERT INTO users (id, username, display_name, avatar_url, avatar_display, banner_url, banner_content_type, nameplate_url, nameplate_content_type, profile_accent_color, profile_background_color, profile_banner_color, display_name_style, theme_preference, theme_sync_enabled, media_content_filter, bio, pronouns, status, custom_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.authUserId,
          claimedUsername,
          legacy.display_name,
          legacy.avatar_url,
          legacy.avatar_display ?? null,
          legacy.banner_url,
          legacy.banner_content_type,
          legacy.nameplate_url,
          legacy.nameplate_content_type,
          legacyProfileTheme.profile_accent_color,
          legacyProfileTheme.profile_background_color,
          legacyProfileTheme.profile_banner_color,
          legacy.display_name_style,
          legacy.theme_preference,
          legacy.theme_sync_enabled,
          legacy.media_content_filter,
          legacy.bio,
          legacy.pronouns,
          legacy.status,
          legacy.custom_status,
          legacy.created_at ?? input.now,
          input.now,
        ),
    ]);
  }

  const statements = USER_ID_REFERENCES.map(([table, column]) =>
    db
      .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
      .bind(input.authUserId, legacy.id),
  );
  statements.push(
    db
      .prepare(
        `UPDATE channel_permission_overrides
         SET target_id = ?
         WHERE target_type = 'user' AND target_id = ?`,
      )
      .bind(input.authUserId, legacy.id),
  );
  statements.push(db.prepare("DELETE FROM users WHERE id = ?").bind(legacy.id));
  statements.push(
    db
      .prepare(
        `INSERT INTO user_identity_claims (auth_user_id, legacy_user_id, email, match_method, claimed_at)
         VALUES (?, ?, ?, 'username', ?)
         ON CONFLICT(auth_user_id) DO UPDATE SET
           legacy_user_id = excluded.legacy_user_id,
           email = excluded.email,
           match_method = excluded.match_method,
           claimed_at = excluded.claimed_at`,
      )
      .bind(input.authUserId, legacy.id, input.email, input.now),
  );

  await db.batch(statements);

  const merged = await getMe(db, input.authUserId);
  if (!merged.avatar_url && input.avatarUrl) {
    await db
      .prepare(
        "UPDATE users SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')",
      )
      .bind(input.avatarUrl, input.authUserId)
      .run();
    merged.avatar_url = input.avatarUrl;
  }

  return merged;
}

function buildClaimCandidates(input: {
  email: string | null;
  username: string;
  displayName: string;
}) {
  const values = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized && /^[a-z0-9_.-]{3,32}$/.test(normalized)) {
      values.add(normalized);
    }
  };

  add(input.username);
  const emailLocalPart = input.email?.split("@")[0] ?? null;
  add(emailLocalPart);
  if (emailLocalPart) {
    for (const suffix of ["dev", "test", "admin"]) {
      if (emailLocalPart.toLowerCase().endsWith(suffix)) {
        add(emailLocalPart.slice(0, -suffix.length));
      }
    }
  }
  add(input.displayName);

  return [...values];
}

export const Route = createFileRoute("/api/users/me")({
  server: {
    handlers: {
      GET,
      PATCH,
    },
  },
});
