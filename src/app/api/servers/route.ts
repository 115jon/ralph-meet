import { apiSuccess, apiError, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { ensureUser } from "@/lib/ensure-user";
import { DEFAULT_EVERYONE_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { CreateServerSchema } from "@/lib/validations";
import { NextResponse } from "next/server";

// GET /api/servers — list servers the current user is a member of
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();

  // Ensure the user exists in D1
  await ensureUser(userId);

  // Cache-aside: check KV first, then D1
  const results = await cacheFetch(
    CacheKey.userServers(userId),
    CacheTTL.USER_SERVERS,
    async () => {
      const { results } = await db.prepare(
        `SELECT s.* FROM servers s
         INNER JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = ?
         ORDER BY s.created_at ASC`
      ).bind(userId).all();
      return results;
    }
  );

  return apiSuccess(results);
}

// POST /api/servers — create a new server
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // Rate limit: 5 servers per hour
  const rl = checkRateLimit(userId, "server-create", RATE_LIMITS.SERVER_CREATE);
  if (rl) return rl;

  // Validate input with Zod
  const raw = await request.json();
  const parsed = CreateServerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { name, icon_url } = parsed.data;

  const db = getDB();

  // Ensure the user exists in D1 before FK-referencing them
  await ensureUser(userId);

  const serverId = genId();
  const now = new Date().toISOString();
  const textCategoryId = genId();
  const voiceCategoryId = genId();
  const channelId = genId();
  const voiceChannelId = genId();

  const everyoneRoleId = genId();
  const ownerRoleId = genId();

  // Atomic batch: create server + member + roles + categories + channels
  await db.batch([
    db.prepare(
      `INSERT INTO servers (id, name, owner_id, icon_url, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(serverId, name, userId, icon_url ?? null, now),
    db.prepare(
      `INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)`
    ).bind(serverId, userId, now),

    // Create @everyone role (is_default = 1), position 0
    db.prepare(
      `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at) VALUES (?, ?, '@everyone', NULL, ?, 0, 1, ?)`
    ).bind(everyoneRoleId, serverId, DEFAULT_EVERYONE_PERMISSIONS, now),

    // Create Owner role (is_default = 0), position 1
    db.prepare(
      `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at) VALUES (?, ?, 'Owner', '#FACC15', ?, 1, 0, ?)`
    ).bind(ownerRoleId, serverId, PERMISSIONS.ADMINISTRATOR, now),

    // Assign creator to Owner role
    db.prepare(
      `INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)`
    ).bind(serverId, userId, ownerRoleId),

    db.prepare(
      `INSERT INTO categories (id, server_id, name, rank) VALUES (?, ?, 'TEXT CHANNELS', 0)`
    ).bind(textCategoryId, serverId),
    db.prepare(
      `INSERT INTO categories (id, server_id, name, rank) VALUES (?, ?, 'VOICE CHANNELS', 1)`
    ).bind(voiceCategoryId, serverId),
    db.prepare(
      `INSERT INTO channels (id, server_id, name, channel_type, category_id, position, created_at)
       VALUES (?, ?, 'general', 'text', ?, 0, ?)`
    ).bind(channelId, serverId, textCategoryId, now),
    db.prepare(
      `INSERT INTO channels (id, server_id, name, channel_type, category_id, position, created_at)
       VALUES (?, ?, 'General', 'voice', ?, 1, ?)`
    ).bind(voiceChannelId, serverId, voiceCategoryId, now),
  ]);

  // Cache invalidation
  await cacheDel(CacheKey.userServers(userId));

  return NextResponse.json({
    id: serverId,
    name,
    owner_id: userId,
    icon_url: icon_url ?? null,
    created_at: now,
  }, { status: 201 });
}

