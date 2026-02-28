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
