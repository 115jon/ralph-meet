// POST /api/voice/move on the Effect edge: a member with MOVE_MEMBERS drags
// someone in a server voice channel onto another voice channel of the same
// server. The route file only wires these handlers.
//
// Flow: check the mover (both channels, role hierarchy) and the moved user
// (a member who can see the target), sign a move grant for the target, then
// tell the source channel's room. The room sends the user's voice session(s)
// a VoiceMove frame and ends them at once, so the move never waits on the
// client: an offline or old client is out of the source room either way.
// Ending them changes that room's roster, which the room pushes to the
// global gateway itself (realtime/VOICE_ROSTER.md), so the sidebar follows
// the move with no further step here.
// A current client joins the target with the grant, which stands in for
// CONNECT there (realtime/voice-move.ts, src/lib/voice/voice-move-grant.ts).

import { Effect, Schema, type Layer } from "effect";

import {
  apiError,
  apiSuccess,
  buildVoiceChannelRoomSlug,
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "@/lib/api-helpers";
import { AuditLogAction, logAuditAction } from "@/lib/audit-logger";
import { getDisplayName } from "@/lib/display-name";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getUserChannelPermissionsForDb } from "@/lib/require-permission";
import { validateBody } from "@/lib/validate-body";
import {
  issueVoiceMoveGrant,
  VOICE_MOVE_GRANT_TTL_MS,
} from "@/lib/voice/voice-move-grant";
import { decideVoiceMove } from "@/lib/voice-move-permissions";
import { Database, RateLimiter, WorkerEnv } from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import { signedInUserId } from "@/server/kova-auth";
import {
  serializeVoiceMoveRequest,
  VOICE_MOVE_GRANT_PATH,
  VOICE_MOVE_PATH,
  type VoiceMoveGrantRecord,
  type VoiceMoveNotice,
} from "../../../realtime/voice-move";

/** Generous for a moderator clearing a room, tight enough to stop a loop. */
export const VOICE_MOVE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const Id = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));

export const voiceMoveBodySchema = Schema.Struct({
  user_id: Id,
  from_channel_id: Id,
  to_channel_id: Id,
  server_id: Schema.optional(Id),
});

const OPTIONS = async ({ request }: { request: Request }) =>
  handleCorsPreflightIfNeeded(request) ??
  new Response(null, { status: 204, headers: getCorsHeaders(request) });

interface ChannelRow {
  id: string;
  server_id: string | null;
  channel_type: string;
  name: string;
}

const moveMember = Effect.fn("voice.move")(function* (request: Request) {
  const moverId = yield* signedInUserId(request);
  const body = yield* Effect.promise(() =>
    validateBody(request, voiceMoveBodySchema, request),
  );
  if (body instanceof Response) return body;

  const rateLimiter = yield* RateLimiter;
  const limited = yield* rateLimiter.check(
    `voice-move:${moverId}`,
    "move",
    VOICE_MOVE_RATE_LIMIT,
  );
  if (limited) return limited;

  const {
    user_id: targetId,
    from_channel_id: fromId,
    to_channel_id: toId,
  } = body;
  if (targetId === moverId) {
    return apiError(
      "Join the channel to move yourself",
      400,
      "CANNOT_MOVE_SELF",
      request,
    );
  }
  if (fromId === toId) {
    return apiSuccess({ moved: false, reason: "same_channel" }, 200, request);
  }

  const env = yield* WorkerEnv;
  const ticketSecret = env.REALTIME_TICKET_SECRET;
  if (!ticketSecret) {
    return apiError(
      "Realtime admission is not configured",
      503,
      "REALTIME_TICKET_SECRET_MISSING",
      request,
    );
  }

  const db = yield* Database;
  const { results: channelRows } = yield* Effect.promise(() =>
    db
      .prepare(
        "SELECT id, server_id, channel_type, name FROM channels WHERE id IN (?, ?)",
      )
      .bind(fromId, toId)
      .all<ChannelRow>(),
  );
  const from = channelRows?.find((row) => row.id === fromId);
  const to = channelRows?.find((row) => row.id === toId);
  if (!from || !to) {
    return apiError("Channel not found", 404, "CHANNEL_NOT_FOUND", request);
  }
  if (
    from.channel_type !== "voice" ||
    to.channel_type !== "voice" ||
    !from.server_id ||
    !to.server_id
  ) {
    return apiError(
      "Members can only be moved between server voice channels",
      400,
      "VOICE_CHANNEL_REQUIRED",
      request,
    );
  }
  const serverId = from.server_id;
  if (to.server_id !== serverId || (body.server_id ?? serverId) !== serverId) {
    return apiError(
      "Both channels must be in the same server",
      400,
      "SERVER_MISMATCH",
      request,
    );
  }

  // Re-read on every drop: a permission revoked mid-drag is refused here.
  const [server, moverSource, moverTarget, targetInTarget, topRoles, mover] =
    yield* Effect.promise(() =>
      Promise.all([
        db
          .prepare("SELECT owner_id FROM servers WHERE id = ?")
          .bind(serverId)
          .first<{ owner_id: string }>(),
        getUserChannelPermissionsForDb(db, serverId, fromId, moverId),
        getUserChannelPermissionsForDb(db, serverId, toId, moverId),
        getUserChannelPermissionsForDb(db, serverId, toId, targetId),
        db
          .prepare(
            `SELECT mr.user_id AS user_id, MAX(r.position) AS max_position
             FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.server_id = ? AND mr.user_id IN (?, ?)
             GROUP BY mr.user_id`,
          )
          .bind(serverId, moverId, targetId)
          .all<{ user_id: string; max_position: number | null }>(),
        db
          .prepare("SELECT username, display_name FROM users WHERE id = ?")
          .bind(moverId)
          .first<{ username: string; display_name: string | null }>(),
      ]),
    );
  const ownerId = server?.owner_id ?? null;
  const topRoleOf = (userId: string) =>
    topRoles.results?.find((row) => row.user_id === userId)?.max_position ?? 0;

  if (ownerId !== moverId && moverSource === null) {
    return apiError(
      "You do not have permission to move members",
      403,
      "MISSING_PERMISSIONS",
      request,
    );
  }
  // The permission decision comes before any answer about the target, so
  // only someone who may move members learns whether a user is a member.
  const decision = decideVoiceMove(
    {
      isOwner: ownerId === moverId,
      sourcePermissions: moverSource,
      targetPermissions: moverTarget,
      topRole: topRoleOf(moverId),
    },
    { isOwner: ownerId === targetId, topRole: topRoleOf(targetId) },
  );
  if (!decision.ok) {
    return decision.reason === "role_hierarchy"
      ? apiError(
          "You cannot move a member with an equal or higher role",
          403,
          "ROLE_HIERARCHY",
          request,
        )
      : apiError(
          "You do not have permission to move members between these channels",
          403,
          "MISSING_PERMISSIONS",
          request,
        );
  }
  if (targetInTarget === null) {
    return apiError("Member not found", 404, "MEMBER_NOT_FOUND", request);
  }
  // Discord parity: a move may skip CONNECT, never VIEW_CHANNELS. A user
  // put in a channel they cannot see would be in voice somewhere their
  // client cannot show.
  if (!hasPermission(targetInTarget, PERMISSIONS.VIEW_CHANNELS)) {
    return apiError(
      "That member cannot see this channel",
      403,
      "TARGET_CANNOT_VIEW",
      request,
    );
  }

  const grantExpiresAt = Date.now() + VOICE_MOVE_GRANT_TTL_MS;
  const grantId = crypto.randomUUID();
  const gateway = env.MEETING_ROOM.get(
    env.MEETING_ROOM.idFromName("global-gateway"),
  );
  // Before the room tells the client: its first ticket request may follow
  // at once. This also kills any earlier grant for the user (A->B->C).
  const recorded = yield* Effect.promise(() =>
    gateway
      .fetch(`https://internal${VOICE_MOVE_GRANT_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetId,
          jti: grantId,
          channel_id: toId,
          expires_at: grantExpiresAt,
        } satisfies VoiceMoveGrantRecord),
      })
      .then(async (response) => {
        await response.body?.cancel();
        return response.ok;
      })
      .catch(() => false),
  );
  if (!recorded) {
    return apiError(
      "Could not move the member",
      502,
      "VOICE_MOVE_FAILED",
      request,
    );
  }
  const notice: VoiceMoveNotice = {
    channel_id: toId,
    server_id: serverId,
    channel_name: to.name,
    mover_name: mover
      ? getDisplayName({
          username: mover.username,
          display_name: mover.display_name,
        })
      : null,
    grant: yield* Effect.promise(() =>
      issueVoiceMoveGrant(
        {
          jti: grantId,
          subject: targetId,
          serverId,
          channelId: toId,
          expiresAt: grantExpiresAt,
        },
        ticketSecret,
      ),
    ),
    grant_expires_at: grantExpiresAt,
  };

  const room = env.MEETING_ROOM.get(
    env.MEETING_ROOM.idFromName(buildVoiceChannelRoomSlug(serverId, fromId)),
  );
  const roomResponse = yield* Effect.promise(() =>
    room
      .fetch(`https://internal${VOICE_MOVE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializeVoiceMoveRequest(targetId, notice),
      })
      .catch(() => null),
  );
  const moved = roomResponse?.ok
    ? yield* Effect.promise(() =>
        roomResponse
          .json()
          .then((value) =>
            typeof value === "object" &&
            value !== null &&
            "moved" in value &&
            typeof value.moved === "number"
              ? value.moved
              : 0,
          )
          .catch(() => 0),
      )
    : null;
  if (moved === null) {
    return apiError(
      "Could not move the member",
      502,
      "VOICE_MOVE_FAILED",
      request,
    );
  }
  if (moved === 0) {
    // Left or disconnected between the drag and the drop.
    return apiError(
      "That member is not in this voice channel",
      409,
      "NOT_IN_VOICE",
      request,
    );
  }

  yield* Effect.promise(() =>
    logAuditAction({
      db,
      serverId,
      actorId: moverId,
      actionType: AuditLogAction.MEMBER_MOVE,
      targetId,
      changes: { from_channel_id: fromId, to_channel_id: toId },
    }),
  );

  return apiSuccess({ moved: true, sessions: moved }, 200, request);
});

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** The handlers, on the given services (the live ones by default). */
export function voiceMoveRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    OPTIONS,
    POST: async ({ request }: { request: Request }) =>
      noStore(
        await runRoute("voice.move", request, moveMember(request), services),
      ),
  };
}
