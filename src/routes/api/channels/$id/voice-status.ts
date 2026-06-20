import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireActiveVoiceChannelSession, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { requireChannelPermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import type { VoiceChannelStatus } from "@/lib/types";
import { updateVoiceChannelStatus } from "@/services/channel.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";

const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  if (!accessResult.serverId) {
    return apiError("Voice statuses are only available for server voice channels", 400);
  }

  const permissionResult = await requireChannelPermission(
    accessResult.serverId,
    channelId,
    userId,
    PERMISSIONS.CONNECT,
    "You do not have permission to set this voice channel status"
  );
  if (permissionResult instanceof Response) return permissionResult;

  const activeVoiceSessionResult = await requireActiveVoiceChannelSession(
    request,
    userId,
    channelId,
    accessResult.serverId,
    "You must be actively connected to this voice channel to change its status.",
  );
  if (activeVoiceSessionResult instanceof Response) return activeVoiceSessionResult;

  const body = await request.json();
  const { voice_status } = body as { voice_status?: VoiceChannelStatus | null };

  if (voice_status === undefined) {
    return apiError("Nothing to update", 400);
  }

  const db = getDB();

  try {
    const result = await updateVoiceChannelStatus(db, channelId, userId, voice_status);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess(result.channel);
  } catch (error) {
    if (error instanceof ServiceError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/channels/$id/voice-status")({
  server: {
    handlers: {
      PATCH,
    },
  },
});
