/**
 * Channel Service — pure business logic for channel operations.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { ServiceError } from "@/lib/service-error";
import { sanitizeChannelName } from "@/lib/validations";
import type { D1Database } from "@cloudflare/workers-types";
import type { AuditLogDescriptor, BroadcastDescriptor } from "./server.service";

// ─── ID generator (injectable) ───────────────────────────────────────────────

let _genId = (): string => crypto.randomUUID();
export function setChannelIdGenerator(fn: () => string): void {
  _genId = fn;
}

// ─── deleteChannel ───────────────────────────────────────────────────────────

export async function deleteChannel(
  db: D1Database,
  channelId: string
): Promise<{
  serverId: string;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  const channel = (await db
    .prepare(
      `SELECT server_id, name, channel_type FROM channels WHERE id = ?`
    )
    .bind(channelId)
    .first()) as {
      server_id: string;
      name: string;
      channel_type: string;
    } | null;

  if (!channel) {
    throw ServiceError.notFound("Channel not found");
  }

  await db.prepare(`DELETE FROM channels WHERE id = ?`).bind(channelId).run();

  return {
    serverId: channel.server_id,
    cacheKeysToInvalidate: [CacheKey.serverChannels(channel.server_id)],
    broadcast: {
      type: "all",
      event: "CHANNEL_DELETE",
      data: { id: channelId, server_id: channel.server_id },
    },
    auditLog: {
      serverId: channel.server_id,
      actorId: "", // filled by route handler
      actionType: AuditLogAction.CHANNEL_DELETE,
      targetId: channelId,
      changes: { name: channel.name, channel_type: channel.channel_type },
    },
  };
}

// ─── createChannel ───────────────────────────────────────────────────────────

export interface CreateChannelInput {
  name: string;
  channel_type?: string;
  description?: string | null;
  category_id?: string | null;
}

export async function createChannel(
  db: D1Database,
  serverId: string,
  actorId: string,
  input: CreateChannelInput
): Promise<{
  channel: Record<string, unknown>;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  const channelType = input.channel_type || "text";
  const sanitizedName = sanitizeChannelName(
    input.name,
    channelType as "text" | "voice" | "dm",
    true
  );

  if (!sanitizedName) {
    throw ServiceError.badRequest("Invalid channel name");
  }

  const channelId = _genId();
  const now = new Date().toISOString();

  // Get next position
  const posRow = (await db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM channels WHERE server_id = ?`
    )
    .bind(serverId)
    .first()) as { next_pos: number } | null;

  await db
    .prepare(
      `INSERT INTO channels (id, server_id, name, description, channel_type, category_id, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      channelId,
      serverId,
      sanitizedName,
      input.description ?? null,
      channelType,
      input.category_id ?? null,
      posRow?.next_pos ?? 0,
      now
    )
    .run();

  const channel = {
    id: channelId,
    server_id: serverId,
    name: sanitizedName,
    description: input.description ?? null,
    channel_type: channelType,
    category_id: input.category_id ?? null,
    position: posRow?.next_pos ?? 0,
    created_at: now,
  };

  return {
    channel,
    cacheKeysToInvalidate: [CacheKey.serverChannels(serverId)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: serverId },
    },
    auditLog: {
      serverId,
      actorId,
      actionType: AuditLogAction.CHANNEL_CREATE,
      targetId: channelId,
      changes: {
        name: channel.name,
        channel_type: channel.channel_type,
        category_id: channel.category_id,
      },
    },
  };
}

// ─── listServerChannels ──────────────────────────────────────────────────────

export async function listServerChannels(
  db: D1Database,
  serverId: string
): Promise<{
  categories: Array<{ id: string;[key: string]: unknown }>;
  channels: Array<{ id: string;[key: string]: unknown }>;
}> {
  const [catResult, chanResult] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM categories WHERE server_id = ? ORDER BY rank ASC`
      )
      .bind(serverId)
      .all(),
    db
      .prepare(
        `SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC`
      )
      .bind(serverId)
      .all(),
  ]);

  return {
    categories: (catResult.results ?? []) as Array<{ id: string;[key: string]: unknown }>,
    channels: (chanResult.results ?? []) as Array<{ id: string;[key: string]: unknown }>,
  };
}

// ─── listPermissionOverrides ─────────────────────────────────────────────────

export async function listPermissionOverrides(
  db: D1Database,
  channelId: string
): Promise<Record<string, unknown>[]> {
  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel?.server_id) {
    throw ServiceError.notFound("Channel not found");
  }

  const { results } = await db
    .prepare(
      `SELECT id, target_id, target_type, allow, deny
       FROM channel_permission_overrides
       WHERE channel_id = ?`
    )
    .bind(channelId)
    .all();

  return results ?? [];
}

// ─── upsertPermissionOverride ────────────────────────────────────────────────

export async function upsertPermissionOverride(
  db: D1Database,
  channelId: string,
  targetId: string,
  targetType: 'role' | 'user',
  allow: number,
  deny: number
): Promise<{ serverId: string; broadcast: BroadcastDescriptor }> {
  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel?.server_id) {
    throw ServiceError.notFound("Channel not found");
  }

  const id = _genId();

  await db.prepare(
    `INSERT INTO channel_permission_overrides (id, channel_id, target_id, target_type, allow, deny)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, target_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny`
  ).bind(id, channelId, targetId, targetType, allow, deny).run();

  return {
    serverId: channel.server_id,
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: channel.server_id, id: channelId },
    },
  };
}

// ─── deletePermissionOverride ────────────────────────────────────────────────

export async function deletePermissionOverride(
  db: D1Database,
  channelId: string,
  targetId: string
): Promise<{ serverId: string; broadcast: BroadcastDescriptor }> {
  const channel = await db
    .prepare(`SELECT server_id FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { server_id: string } | null;

  if (!channel?.server_id) {
    throw ServiceError.notFound("Channel not found");
  }

  await db.prepare(
    `DELETE FROM channel_permission_overrides WHERE channel_id = ? AND target_id = ?`
  ).bind(channelId, targetId).run();

  return {
    serverId: channel.server_id,
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: channel.server_id, id: channelId },
    },
  };
}

// ─── reorderChannels ─────────────────────────────────────────────────────────

export interface ReorderInput {
  channels?: Array<{ id: string; position: number; category_id: string | null }>;
  categories?: Array<{ id: string; rank: number }>;
}

export async function reorderChannels(
  db: D1Database,
  serverId: string,
  input: ReorderInput
): Promise<{
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
}> {
  const statements = [];

  if (input.channels?.length) {
    for (const ch of input.channels) {
      statements.push(
        db.prepare(
          `UPDATE channels SET position = ?, category_id = ? WHERE id = ? AND server_id = ?`
        ).bind(ch.position, ch.category_id, ch.id, serverId)
      );
    }
  }

  if (input.categories?.length) {
    for (const cat of input.categories) {
      statements.push(
        db.prepare(
          `UPDATE categories SET rank = ? WHERE id = ? AND server_id = ?`
        ).bind(cat.rank, cat.id, serverId)
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return {
    cacheKeysToInvalidate: [CacheKey.serverChannels(serverId)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: serverId },
    },
  };
}
