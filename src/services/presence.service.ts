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
  userId: string
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
  input: UpdatePresenceInput
): Promise<{
  status: string;
  custom_status: string | null;
  broadcast: BroadcastDescriptor;
}> {
  if (!VALID_STATUSES.has(input.status)) {
    throw ServiceError.badRequest("Invalid status");
  }

  const customStatus = input.custom_status ?? null;

  try {
    await db
      .prepare(
        `UPDATE users SET status = ?, custom_status = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(input.status, customStatus, userId)
      .run();
  } catch (error) {
    // Log but don't block — presence broadcast is more important than DB write
    log.error("Failed to update presence in DB:", error);
  }

  return {
    status: input.status,
    custom_status: customStatus,
    broadcast: {
      type: "all",
      event: "PRESENCE_UPDATE",
      data: {
        user_id: userId,
        status: input.status,
        custom_status: customStatus,
      },
    },
  };
}
