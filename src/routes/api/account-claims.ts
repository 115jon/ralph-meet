import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { getCurrentUser } from "@/lib/kova-auth-server";
import { getMe } from "@/services/user.service";

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  match_method: string;
};

type UserProfileRow = ClaimCandidate & {
  bio: string | null;
  status: string;
  custom_status: string | null;
  theme_preference: string | null;
  theme_sync_enabled: number;
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
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const db = getDB();
  await ensureIdentityClaimsTable(db);

  const existingClaim = await db
    .prepare("SELECT legacy_user_id FROM user_identity_claims WHERE auth_user_id = ? LIMIT 1")
    .bind(authResult.userId)
    .first<{ legacy_user_id: string }>()
    .catch(() => null);

  if (existingClaim?.legacy_user_id) {
    return apiSuccess({ claimed: true, candidates: [] });
  }

  const candidates = await findClaimCandidates(db, authResult.userId, request.headers);
  return apiSuccess({ claimed: false, candidates });
};

const POST = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: { legacyUserId?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const legacyUserId = body.legacyUserId?.trim();
  if (!legacyUserId || legacyUserId === userId) {
    return apiError("Invalid legacy account", 400);
  }

  const db = getDB();
  await ensureIdentityClaimsTable(db);

  const existingClaim = await db
    .prepare("SELECT legacy_user_id FROM user_identity_claims WHERE auth_user_id = ? OR legacy_user_id = ? LIMIT 1")
    .bind(userId, legacyUserId)
    .first<{ legacy_user_id: string }>()
    .catch(() => null);

  if (existingClaim) {
    return apiError("This account has already been claimed", 409);
  }

  const candidates = await findClaimCandidates(db, userId, request.headers);
  const candidate = candidates.find((c) => c.id === legacyUserId);
  if (!candidate) {
    return apiError("That account is not eligible for claiming", 403);
  }

  const legacy = await db
    .prepare(
      `SELECT id, username, display_name, avatar_url, bio, status, custom_status
            , theme_preference, theme_sync_enabled
       FROM users
       WHERE id = ?
       LIMIT 1`
    )
    .bind(legacyUserId)
    .first<UserProfileRow>()
    .catch(() => null);

  if (!legacy) return apiError("Legacy account not found", 404);

  const authUser = await getCurrentUser(request.headers);
  const email = authUser?.email ?? authUser?.primaryEmailAddress?.emailAddress ?? null;
  const now = new Date().toISOString();

  const references = await getExistingUserIdReferences(db);
  const legacyHoldingUsername = `${legacy.username}__claimed__${Date.now()}`;
  const statements = [
    db.prepare("PRAGMA defer_foreign_keys = ON"),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    db.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?").bind(legacyHoldingUsername, now, legacyUserId),
    db
      .prepare(
        `INSERT INTO users (id, username, display_name, avatar_url, bio, status, custom_status, theme_preference, theme_sync_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        legacy.username,
        legacy.display_name,
        legacy.avatar_url,
        legacy.bio,
        legacy.status,
        legacy.custom_status,
        legacy.theme_preference,
        legacy.theme_sync_enabled,
        now,
        now
      ),
    ...references.map(([table, column]) =>
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(userId, legacyUserId)
    ),
    ...(await tableExists(db, "channel_permission_overrides")
      ? [
          db
            .prepare(
              `UPDATE channel_permission_overrides
               SET target_id = ?
               WHERE target_type = 'user' AND target_id = ?`
            )
            .bind(userId, legacyUserId),
        ]
      : []),
    db.prepare("DELETE FROM users WHERE id = ?").bind(legacyUserId),
    db
      .prepare(
        `INSERT INTO user_identity_claims (auth_user_id, legacy_user_id, email, match_method, claimed_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(userId, legacyUserId, email, candidate.match_method, now),
  ];

  await db.batch(statements);
  return apiSuccess(await getMe(db, userId));
};

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

async function getExistingUserIdReferences(db: any) {
  const references: (typeof USER_ID_REFERENCES)[number][] = [];
  for (const reference of USER_ID_REFERENCES) {
    const [table, column] = reference;
    if ((await tableExists(db, table)) && (await columnExists(db, table, column))) {
      references.push(reference);
    }
  }
  return references;
}

async function tableExists(db: any, table: string) {
  const row = await db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(table)
    .first()
    .catch(() => null);
  return Boolean(row);
}

async function columnExists(db: any, table: string, column: string) {
  const { results = [] } = await db.prepare(`PRAGMA table_info(${table})`).all().catch(() => ({ results: [] }));
  return results.some((row: { name?: string }) => row.name === column);
}

async function findClaimCandidates(db: any, authUserId: string, headers: Headers): Promise<ClaimCandidate[]> {
  const authUser = await getCurrentUser(headers);
  if (!authUser) return [];

  const email = authUser.email ?? authUser.primaryEmailAddress?.emailAddress ?? null;
  const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ");
  const displayName = authUser.name ?? fullName;
  const candidateValues = buildClaimCandidates({
    email,
    username: authUser.username ?? null,
    displayName,
  });

  if (!candidateValues.length) return [];

  const placeholders = candidateValues.map(() => "?").join(", ");
  const { results = [] } = await db
    .prepare(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE id != ?
         AND id NOT IN (SELECT legacy_user_id FROM user_identity_claims)
         AND lower(username) IN (${placeholders})
       ORDER BY created_at ASC
       LIMIT 5`
    )
    .bind(authUserId, ...candidateValues)
    .all()
    .catch(() => ({ results: [] as ClaimCandidate[] }));

  return (results as ClaimCandidate[]).map((row) => ({
    ...row,
    match_method: candidateValues.includes(row.username.toLowerCase()) ? "username" : "profile",
  }));
}

function buildClaimCandidates(input: {
  email: string | null;
  username: string | null;
  displayName: string | null;
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

export const Route = createFileRoute("/api/account-claims")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
