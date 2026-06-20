/**
 * Channel Service — pure business logic for channel operations.
 */

import { AuditLogAction } from "@/lib/audit-logger";
import { CacheKey } from "@/lib/cache";
import { ServiceError } from "@/lib/service-error";
import type { VoiceChannelStatus } from "@/lib/types";
import { sanitizeChannelName } from "@/lib/validations";
import { sanitizeVoiceChannelStatus } from "@/lib/voice-channel-status";
import type { D1Database } from "@cloudflare/workers-types";
import type { AuditLogDescriptor, BroadcastDescriptor } from "./server.service";

// ─── ID generator (injectable) ───────────────────────────────────────────────

let _genId = (): string => crypto.randomUUID();
export function setChannelIdGenerator(fn: () => string): void {
  _genId = fn;
}

type RawChannelRecord = {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  channel_type: string;
  category_id: string | null;
  position: number;
  allow_public_shares: number | null;
  voice_status_text?: string | null;
  voice_status_media?: string | null;
  created_at: string;
};

function parseStoredVoiceChannelStatus(row: Pick<RawChannelRecord, "voice_status_text" | "voice_status_media">): VoiceChannelStatus | null {
  let media: unknown = null;

  if (typeof row.voice_status_media === "string" && row.voice_status_media.trim()) {
    try {
      media = JSON.parse(row.voice_status_media);
    } catch {
      media = null;
    }
  }

  return sanitizeVoiceChannelStatus({
    text: row.voice_status_text,
    media,
  });
}

function mapChannelRecord(row: RawChannelRecord): { id: string; [key: string]: unknown } {
  const {
    allow_public_shares,
    voice_status_text: _voiceStatusText,
    voice_status_media: _voiceStatusMedia,
    ...rest
  } = row;

  return {
    ...rest,
    allow_public_shares: allow_public_shares == null ? null : allow_public_shares === 1,
    voice_status: parseStoredVoiceChannelStatus(row),
  };
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

// ─── updateChannel ───────────────────────────────────────────────────────────

export interface UpdateChannelInput {
  name?: string;
  description?: string | null;
  allow_public_shares?: boolean | null;
}

export async function updateChannel(
  db: D1Database,
  channelId: string,
  actorId: string,
  input: UpdateChannelInput
): Promise<{
  channel: Record<string, unknown>;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  const existing = (await db
    .prepare(
      `SELECT id, server_id, name, description, channel_type, category_id, position, allow_public_shares, voice_status_text, voice_status_media, created_at FROM channels WHERE id = ?`
    )
    .bind(channelId)
    .first()) as RawChannelRecord | null;

  if (!existing) {
    throw ServiceError.notFound("Channel not found");
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  let newName = existing.name;
  let newDescription: string | null = existing.description;

  if (input.name !== undefined) {
    const sanitized = sanitizeChannelName(
      input.name,
      existing.channel_type as "text" | "voice" | "dm",
      true
    );
    if (!sanitized) {
      throw ServiceError.badRequest("Invalid channel name");
    }
    if (sanitized !== existing.name) {
      changes.name = { old: existing.name, new: sanitized };
      newName = sanitized;
    }
  }

  if (input.description !== undefined) {
    const desc = input.description === "" ? null : input.description;
    if (desc !== existing.description) {
      changes.description = { old: existing.description, new: desc };
      newDescription = desc;
    }
  }
  let newAllowPublicShares = existing.allow_public_shares;
  if (input.allow_public_shares !== undefined) {
    const next = input.allow_public_shares === null ? null : input.allow_public_shares ? 1 : 0;
    if (next !== existing.allow_public_shares) {
      changes.allow_public_shares = { old: existing.allow_public_shares, new: next };
      newAllowPublicShares = next;
    }
  }

  if (Object.keys(changes).length === 0) {
    // Nothing changed — return current state without DB write
    const currentChannel = mapChannelRecord(existing);
    return {
      channel: currentChannel,
      cacheKeysToInvalidate: [],
      broadcast: { type: "all", event: "CHANNEL_UPDATE", data: { server_id: existing.server_id, channel: currentChannel } },
      auditLog: {
        serverId: existing.server_id,
        actorId,
        actionType: AuditLogAction.CHANNEL_UPDATE,
        targetId: channelId,
        changes: {},
      },
    };
  }

  await db
    .prepare(
      `UPDATE channels SET name = ?, description = ?, allow_public_shares = ? WHERE id = ?`
    )
    .bind(newName, newDescription, newAllowPublicShares, channelId)
    .run();

  const updated = mapChannelRecord({
    ...existing,
    name: newName,
    description: newDescription,
    allow_public_shares: newAllowPublicShares,
  });

  return {
    channel: updated,
    cacheKeysToInvalidate: [CacheKey.serverChannels(existing.server_id)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: existing.server_id, channel: updated },
    },
    auditLog: {
      serverId: existing.server_id,
      actorId,
      actionType: AuditLogAction.CHANNEL_UPDATE,
      targetId: channelId,
      changes,
    },
  };
}

export async function updateVoiceChannelStatus(
  db: D1Database,
  channelId: string,
  actorId: string,
  status: VoiceChannelStatus | null
): Promise<{
  channel: Record<string, unknown>;
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
  auditLog: AuditLogDescriptor;
}> {
  const existing = (await db
    .prepare(
      `SELECT id, server_id, name, description, channel_type, category_id, position, allow_public_shares, voice_status_text, voice_status_media, created_at FROM channels WHERE id = ?`
    )
    .bind(channelId)
    .first()) as RawChannelRecord | null;

  if (!existing) {
    throw ServiceError.notFound("Channel not found");
  }

  if (existing.channel_type !== "voice") {
    throw ServiceError.badRequest("Only voice channels can have a voice status");
  }

  const previousStatus = parseStoredVoiceChannelStatus(existing);
  const nextStatus = sanitizeVoiceChannelStatus(status);
  const nextText = nextStatus?.text ?? null;
  const nextMedia = nextStatus?.media ? JSON.stringify(nextStatus.media) : null;
  const previousMedia = previousStatus?.media ? JSON.stringify(previousStatus.media) : null;

  if ((previousStatus?.text ?? null) === nextText && previousMedia === nextMedia) {
    const currentChannel = mapChannelRecord(existing);
    return {
      channel: currentChannel,
      cacheKeysToInvalidate: [],
      broadcast: { type: "all", event: "CHANNEL_UPDATE", data: { server_id: existing.server_id, channel: currentChannel } },
      auditLog: {
        serverId: existing.server_id,
        actorId,
        actionType: AuditLogAction.CHANNEL_UPDATE,
        targetId: channelId,
        changes: {},
      },
    };
  }

  await db
    .prepare(
      `UPDATE channels SET voice_status_text = ?, voice_status_media = ? WHERE id = ?`
    )
    .bind(nextText, nextMedia, channelId)
    .run();

  const updated = mapChannelRecord({
    ...existing,
    voice_status_text: nextText,
    voice_status_media: nextMedia,
  });

  return {
    channel: updated,
    cacheKeysToInvalidate: [CacheKey.serverChannels(existing.server_id)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: existing.server_id, channel: updated },
    },
    auditLog: {
      serverId: existing.server_id,
      actorId,
      actionType: AuditLogAction.CHANNEL_UPDATE,
      targetId: channelId,
      changes: {
        voice_status: {
          old: previousStatus,
          new: nextStatus,
        },
      },
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
    allow_public_shares: null,
    voice_status: null,
    created_at: now,
  };

  return {
    channel,
    cacheKeysToInvalidate: [CacheKey.serverChannels(serverId)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: serverId, channel },
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
    channels: ((chanResult.results ?? []) as RawChannelRecord[]).map((row) => mapChannelRecord(row)),
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
