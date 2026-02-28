/**
 * Service orchestration helpers for route handlers.
 *
 * Executes the declarative side effects (broadcasts, cache invalidation,
 * audit logs) returned by service functions.
 */

import { broadcastToAll, broadcastToChannel, broadcastToUser } from "@/lib/api-helpers";
import { logAuditAction, type AuditLogAction } from "@/lib/audit-logger";
import { cacheDel, cacheDelMany } from "@/lib/cache";
import type { AuditLogDescriptor, BroadcastDescriptor } from "@/services/server.service";
import type { D1Database } from "@cloudflare/workers-types";

/** Execute a broadcast descriptor */
export async function executeBroadcast(
  broadcast: BroadcastDescriptor
): Promise<void> {
  switch (broadcast.type) {
    case "channel":
      await broadcastToChannel(broadcast.target!, broadcast.event, broadcast.data);
      break;
    case "user":
      await broadcastToUser(broadcast.target!, broadcast.event, broadcast.data);
      break;
    case "all":
      await broadcastToAll(broadcast.event, broadcast.data);
      break;
  }
}

/** Execute cache invalidation for a list of keys */
export async function executeInvalidation(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (keys.length === 1) {
    await cacheDel(keys[0]);
  } else {
    await cacheDelMany(keys);
  }
}

/** Execute an audit log descriptor */
export async function executeAuditLog(
  db: D1Database,
  descriptor: AuditLogDescriptor
): Promise<void> {
  await logAuditAction({
    db,
    serverId: descriptor.serverId,
    actorId: descriptor.actorId,
    actionType: descriptor.actionType as AuditLogAction,
    targetId: descriptor.targetId,
    changes: descriptor.changes as Record<string, any> | null,
    reason: descriptor.reason,
  });
}
