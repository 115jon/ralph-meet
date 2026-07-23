/**
 * Presence Service — pure business logic for user presence operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases. Side effects (broadcasts) are returned declaratively.
 */

import { ServiceError } from "@/lib/service-error";
import { clog } from "@/lib/console-logger";
import type { D1Database } from "@cloudflare/workers-types";
import type { BroadcastDescriptor } from "./server.service";

const log = clog("presence.service");

// ─── Valid statuses ───────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(["online", "idle", "dnd", "offline"]);

// ─── getPresence ─────────────────────────────────────────────────────────────

export async function getPresence(
  db: D1Database,
  userId: string,
): Promise<{ status: string; custom_status: string | null }> {
  const user = (await db
    .prepare(`SELECT status, custom_status FROM users WHERE id = ?`)
    .bind(userId)
    .first()) as { status: string; custom_status: string | null } | null;

  return {
    status: user?.status ?? "online",
    custom_status: user?.custom_status ?? null,
  };
}

// ─── updatePresence ──────────────────────────────────────────────────────────

export interface UpdatePresenceInput {
  status: string;
  custom_status?: string | null;
}

export async function updatePresence(
  db: D1Database,
  userId: string,
  input: UpdatePresenceInput,
): Promise<{
  status: string;
  custom_status: string | null;
  broadcasts: BroadcastDescriptor[];
  cacheInvalidationServerIds: string[];
  presenceChanged: boolean;
}> {
  if (!VALID_STATUSES.has(input.status)) {
    throw ServiceError.badRequest("Invalid status");
  }

  const customStatus = input.custom_status ?? null;

  try {
    const { results: memberships } = await db
      .prepare("SELECT server_id FROM server_members WHERE user_id = ?")
      .bind(userId)
      .all();

    const updateResult = await db
      .prepare(
        `UPDATE users SET status = ?, custom_status = ?, updated_at = datetime('now')
         WHERE id = ? AND (status IS NOT ? OR custom_status IS NOT ?)`,
      )
      .bind(input.status, customStatus, userId, input.status, customStatus)
      .run();

    const presenceChanged = updateResult.meta?.changes !== 0;

    if (!presenceChanged) {
      const user = await db
        .prepare("SELECT id FROM users WHERE id = ?")
        .bind(userId)
        .first();
      if (!user) throw ServiceError.notFound("User not found");

      return {
        status: input.status,
        custom_status: customStatus,
        broadcasts: [],
        cacheInvalidationServerIds: [],
        presenceChanged: false,
      };
    }

    return {
      status: input.status,
      custom_status: customStatus,
      broadcasts: (memberships ?? []).map(
        (membership: Record<string, unknown>) => ({
          type: "server",
          target: membership.server_id as string,
          event: "PRESENCE_UPDATE",
          data: {
            user_id: userId,
            status: input.status,
            custom_status: customStatus,
          },
        }),
      ),
      cacheInvalidationServerIds: presenceChanged
        ? (memberships ?? [])
            .map((membership: Record<string, unknown>) => membership.server_id)
            .filter(
              (serverId): serverId is string => typeof serverId === "string",
            )
        : [],
      presenceChanged,
    };
  } catch (error) {
    log.error("Failed to update presence in DB:", error);
    throw error;
  }
}
