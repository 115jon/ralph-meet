import type { D1Database } from '@cloudflare/workers-types';
import { clog } from "@/lib/console-logger";
import { genId } from './api-helpers';

const log = clog("Audit Logger");

export enum AuditLogAction {
  SERVER_UPDATE = 'SERVER_UPDATE',
  CHANNEL_CREATE = 'CHANNEL_CREATE',
  CHANNEL_UPDATE = 'CHANNEL_UPDATE',
  CHANNEL_DELETE = 'CHANNEL_DELETE',
  ROLE_CREATE = 'ROLE_CREATE',
  ROLE_UPDATE = 'ROLE_UPDATE',
  ROLE_DELETE = 'ROLE_DELETE',
  MEMBER_KICK = 'MEMBER_KICK',
  MEMBER_BAN = 'MEMBER_BAN',
  MEMBER_UNBAN = 'MEMBER_UNBAN',
  MEMBER_ROLE_UPDATE = 'MEMBER_ROLE_UPDATE',
}

export async function logAuditAction({
  db,
  serverId,
  actorId,
  actionType,
  targetId,
  changes,
  reason,
}: {
  db: D1Database;
  serverId: string;
  actorId: string;
  actionType: AuditLogAction;
  targetId?: string | null;
  changes?: Record<string, any> | null;
  reason?: string | null;
}) {
  const id = genId();
  const changesStr = changes ? JSON.stringify(changes) : null;

  try {
    await db
      .prepare(
        `INSERT INTO server_audit_logs (id, server_id, actor_id, action_type, target_id, changes, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, serverId, actorId, actionType, targetId || null, changesStr, reason || null)
      .run();
  } catch (error) {
    log.error('Failed to log action:', error);
    // We intentionally don't throw here to avoid failing the main request
    // if the audit log insertion fails.
  }
}
