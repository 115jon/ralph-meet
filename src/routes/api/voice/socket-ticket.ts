import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  apiError,
  buildVoiceChannelRoomSlug,
  getCorsHeaders,
  getDB,
  getEnv,
  handleCorsPreflightIfNeeded,
  requireAuth,
} from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { checkRateLimitDOFailClosed } from "@/lib/rate-limit";
import { getOrCreateDemoSession } from "@/lib/voice/demo-session";
import { isPublicDemoRoomSlug } from "@/lib/voice/realtime-policy";
import { validateBody } from "@/lib/validate-body";
import {
  issueSocketTicket,
  type SocketTicketAudience,
} from "@/lib/voice/socket-ticket";

const SOCKET_TICKET_TTL_MS = 60_000;
const DEMO_TICKET_RATE_LIMIT = { limit: 12, windowMs: 60 * 60 * 1000 };
const DEMO_SESSION_TICKET_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

const OPTIONS = async ({ request }: { request: Request }) =>
  handleCorsPreflightIfNeeded(request) ??
  new Response(null, { status: 204, headers: getCorsHeaders(request) });

export const socketTicketRequestBodySchema = z
  .object({
    audience: z.unknown().optional(),
    channelId: z.unknown().optional(),
    roomSlug: z.unknown().optional(),
    serverId: z.unknown().optional(),
  })
  .passthrough();

type SocketTicketRequestBody = z.infer<typeof socketTicketRequestBodySchema>;

type SocketTicketEnv = CloudflareEnv & {
  REALTIME_TICKET_SECRET?: string;
};

type TicketAdmission = {
  accessMode: "authenticated" | "public-demo";
  cookie?: string;
  roomSlug: string;
  serverId?: string;
  subject: string;
};

const POST = async ({ request }: { request: Request }) => {
  const env = getEnv() as SocketTicketEnv;
  const config = getSocketTicketConfig(env);
  if (!config.ok) {
    return noStore(
      apiError(
        "Realtime admission is not configured",
        503,
        config.code,
        request,
      ),
    );
  }

  const bodyResult = await validateBody(
    request,
    socketTicketRequestBodySchema,
    request,
  );
  if (bodyResult instanceof Response) return noStore(bodyResult);
  const body = bodyResult;

  const audience = parseAudience(body.audience);
  if (!audience) {
    return noStore(
      apiError("Invalid socket audience", 400, "INVALID_AUDIENCE", request),
    );
  }

  const hasChannelId =
    typeof body.channelId === "string" && body.channelId.trim().length > 0;
  const admission =
    audience !== "global" && !hasChannelId
      ? await authorizePublicDemoTicket(
          request,
          config.ticketSecret,
          body,
          audience,
        )
      : await authorizeAuthenticatedTicket(request, body, audience);
  if (admission instanceof Response) return noStore(admission);

  const expiresAt = Date.now() + SOCKET_TICKET_TTL_MS;
  const ticket = await issueSocketTicket(
    {
      accessMode: admission.accessMode,
      audience,
      expiresAt,
      nonce: crypto.randomUUID(),
      roomSlug: admission.roomSlug,
      ...(admission.serverId ? { serverId: admission.serverId } : {}),
      subject: admission.subject,
    },
    config.ticketSecret,
  );

  const response = Response.json({
    access_mode: admission.accessMode,
    audience,
    expires_at: expiresAt,
    room_slug: admission.roomSlug,
    ticket,
  });
  if (admission.cookie) response.headers.append("Set-Cookie", admission.cookie);
  return noStore(response);
};

async function authorizeAuthenticatedTicket(
  request: Request,
  body: SocketTicketRequestBody,
  audience: SocketTicketAudience,
): Promise<TicketAdmission | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  if (audience === "global") {
    return {
      accessMode: "authenticated",
      roomSlug: "global-gateway",
      subject: authResult.userId,
    };
  }

  if (typeof body.channelId !== "string" || !body.channelId.trim()) {
    return apiError("channelId is required", 400, "CHANNEL_REQUIRED", request);
  }

  const channelId = body.channelId.trim();
  const channelAccess = await requireChannelAccess(
    authResult.userId,
    channelId,
  );
  if (channelAccess instanceof Response) return channelAccess;

  if (
    typeof body.roomSlug === "string" &&
    body.roomSlug.startsWith("dm-call-")
  ) {
    const callRoomSlug = await getAuthorizedDmCallRoomSlug(
      authResult.userId,
      channelId,
    );
    if (!callRoomSlug || callRoomSlug !== body.roomSlug) {
      return apiError(
        "Channel not found or access denied",
        403,
        "ROOM_NOT_ALLOWED",
        request,
      );
    }
    return {
      accessMode: "authenticated",
      roomSlug: callRoomSlug,
      subject: authResult.userId,
    };
  }

  if (!channelAccess.serverId) {
    return apiError(
      "Server voice channel required",
      400,
      "SERVER_VOICE_REQUIRED",
      request,
    );
  }

  const channel = await getDB()
    .prepare("SELECT channel_type FROM channels WHERE id = ? AND server_id = ?")
    .bind(channelId, channelAccess.serverId)
    .first<{ channel_type: string }>();
  if (channel?.channel_type !== "voice") {
    return apiError(
      "Server voice channel required",
      400,
      "SERVER_VOICE_REQUIRED",
      request,
    );
  }

  if (
    typeof body.serverId === "string" &&
    body.serverId.trim() &&
    body.serverId.trim() !== channelAccess.serverId
  ) {
    return apiError(
      "Channel not found or access denied",
      403,
      "SERVER_MISMATCH",
      request,
    );
  }

  const permissions = await getUserChannelPermissions(
    channelAccess.serverId,
    channelId,
    authResult.userId,
  );
  if (
    permissions === null ||
    !hasPermission(permissions, PERMISSIONS.CONNECT)
  ) {
    return apiError(
      "You do not have permission to connect to this voice channel",
      403,
      "CONNECT_DENIED",
      request,
    );
  }

  return {
    accessMode: "authenticated",
    roomSlug: buildVoiceChannelRoomSlug(channelAccess.serverId, channelId),
    serverId: channelAccess.serverId,
    subject: authResult.userId,
  };
}

async function authorizePublicDemoTicket(
  request: Request,
  ticketSecret: string,
  body: SocketTicketRequestBody,
  audience: SocketTicketAudience,
): Promise<TicketAdmission | Response> {
  if (!isSameOrigin(request)) {
    return apiError(
      "Demo ticket origin is not allowed",
      403,
      "DEMO_ORIGIN_NOT_ALLOWED",
      request,
    );
  }
  if (audience === "global") {
    return apiError(
      "Public demo global gateway is disabled",
      403,
      "GLOBAL_DEMO_DISABLED",
    );
  }
  if (!isPublicDemoRoomSlug(body.roomSlug)) {
    return apiError("Demo room is not allowed", 403, "DEMO_ROOM_NOT_ALLOWED");
  }

  const session = await getOrCreateDemoSession(request, ticketSecret);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipLimit = await checkRateLimitDOFailClosed(
    `demo-ticket-ip:${clientIp}`,
    "issue",
    DEMO_TICKET_RATE_LIMIT,
  );
  if (ipLimit) return ipLimit;

  const sessionLimit = await checkRateLimitDOFailClosed(
    `demo-ticket-session:${session.subject}`,
    "issue",
    DEMO_SESSION_TICKET_RATE_LIMIT,
  );
  if (sessionLimit) return sessionLimit;

  return {
    accessMode: "public-demo",
    cookie: session.cookie ?? undefined,
    roomSlug: body.roomSlug,
    subject: session.subject,
  };
}

async function getAuthorizedDmCallRoomSlug(
  userId: string,
  channelId: string,
): Promise<string | null> {
  const { results } = await getDB()
    .prepare(
      `SELECT user_id FROM dm_recipients WHERE channel_id = ? ORDER BY user_id ASC`,
    )
    .bind(channelId)
    .all<{ user_id: string }>();
  const recipients = (results ?? [])
    .map((row: { user_id: string }) => row.user_id)
    .filter(Boolean);
  if (recipients.length !== 2 || !recipients.includes(userId)) return null;
  return `dm-call-${recipients[0]}-${recipients[1]}`;
}

function getSocketTicketConfig(
  env: SocketTicketEnv,
): { ok: true; ticketSecret: string } | { ok: false; code: string } {
  if (!env.REALTIME_TICKET_SECRET) {
    return { ok: false, code: "REALTIME_TICKET_SECRET_MISSING" };
  }

  return {
    ok: true,
    ticketSecret: env.REALTIME_TICKET_SECRET,
  };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function parseAudience(value: unknown): SocketTicketAudience | null {
  return value === "global" || value === "room" || value === "voice"
    ? value
    : null;
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const Route = createFileRoute("/api/voice/socket-ticket" as never)({
  server: {
    handlers: {
      OPTIONS,
      POST,
    },
  },
});

export { POST as socketTicketPost, OPTIONS as socketTicketOptions };
