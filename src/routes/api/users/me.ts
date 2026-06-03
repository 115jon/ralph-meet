import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { getCurrentUser } from "@/lib/kova-auth-server";
import { ServiceError } from "@/lib/service-error";
import { getMe } from "@/services/user.service";

type UserProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  updated_at: string | null;
  bio: string | null;
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

  try {
    const user = await getMe(db, userId);
    await backfillMissingAvatar(db, user, request.headers);
    return apiSuccess(user);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) {
      try {
        const synced = await syncUserFromRalphAuth(db, userId, request.headers);
        if (synced) return apiSuccess(synced);
      } catch (syncErr) {
        console.error("[users/me] Auto-sync from Ralph Auth failed:", syncErr);
      }
      return apiError("User profile not found. Please sign out and sign back in.", 404);
    }
    throw e;
  }
};

async function backfillMissingAvatar(db: any, user: UserProfileRow, headers: Headers) {
  if (user.avatar_url) return;

  try {
    const authUser = await getCurrentUser(headers);
    const avatarUrl = authUser?.imageUrl ?? authUser?.image ?? null;
    if (!avatarUrl) return;

    await db
      .prepare(`UPDATE users SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')`)
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

  const email = authUser.email ?? authUser.primaryEmailAddress?.emailAddress ?? null;
  const username = authUser.username ?? (email ? email.split("@")[0] : null) ?? `user_${userId.slice(-6)}`;
  const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ");
  const displayName = authUser.name ?? (fullName || username);
  const avatarUrl = authUser.imageUrl ?? authUser.image ?? null;
  const bio = authUser.bio ?? null;
  const now = new Date().toISOString();

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
      `INSERT INTO users (id, username, display_name, avatar_url, bio, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'online', ?)
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
         bio = COALESCE(users.bio, excluded.bio)`
    )
    .bind(userId, username, displayName, avatarUrl, bio, now)
    .run();

  return {
    id: userId,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    updated_at: now,
    bio,
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
      )`
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
  const existingClaim = await db
    .prepare("SELECT legacy_user_id FROM user_identity_claims WHERE auth_user_id = ? LIMIT 1")
    .bind(input.authUserId)
    .first()
    .catch(() => null) as { legacy_user_id: string } | null;

  if (existingClaim?.legacy_user_id) {
    const mapped = await getMe(db, input.authUserId).catch(() => null);
    if (mapped) return mapped;
  }

  const candidates = buildClaimCandidates(input);
  if (!candidates.length) return null;

  const placeholders = candidates.map(() => "?").join(", ");
  const { results = [] } = await db
    .prepare(
      `SELECT id, username, display_name, avatar_url, updated_at, bio, status, custom_status
       FROM users
       WHERE id != ? AND lower(username) IN (${placeholders})`
    )
    .bind(input.authUserId, ...candidates)
    .all()
    .catch(() => ({ results: [] })) as { results?: UserProfileRow[] };

  if (results.length !== 1) return null;
  const legacy = results[0];

  const existingNewUser = await db
    .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
    .bind(input.authUserId)
    .first()
    .catch(() => null) as { id: string } | null;

  if (!existingNewUser) {
    await db
      .prepare(
        `INSERT INTO users (id, username, display_name, avatar_url, bio, status, custom_status, created_at, updated_at)
         SELECT ?, username, display_name, avatar_url, bio, status, custom_status, created_at, ?
         FROM users WHERE id = ?`
      )
      .bind(input.authUserId, input.now, legacy.id)
      .run();
  }

  const statements = USER_ID_REFERENCES.map(([table, column]) =>
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(input.authUserId, legacy.id)
  );
  statements.push(
    db
      .prepare(
        `UPDATE channel_permission_overrides
         SET target_id = ?
         WHERE target_type = 'user' AND target_id = ?`
      )
      .bind(input.authUserId, legacy.id)
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
           claimed_at = excluded.claimed_at`
      )
      .bind(input.authUserId, legacy.id, input.email, input.now)
  );

  await db.batch(statements);

  const merged = await getMe(db, input.authUserId);
  if (!merged.avatar_url && input.avatarUrl) {
    await db
      .prepare("UPDATE users SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')")
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
    },
  },
});
