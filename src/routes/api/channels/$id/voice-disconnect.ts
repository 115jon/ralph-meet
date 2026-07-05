import { createFileRoute } from "@tanstack/react-router";

import {
  apiSuccess,
  buildVoiceChannelRoomSlug,
  getCorsHeaders,
  getDB,
  getEnv,
  handleCorsPreflightIfNeeded,
  requireAuth,
} from "@/lib/api-helpers";

type VoiceDisconnectBody = {
  server_id?: string | null;
  gateway_session_id?: string | null;
  voice_session_id?: string | null;
};

async function readVoiceDisconnectBody(request: Request): Promise<VoiceDisconnectBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return await request.json() as VoiceDisconnectBody;
  }

  const raw = await request.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw) as VoiceDisconnectBody;
  } catch {
    return {};
  }
}

const OPTIONS = async ({ request }: any) => {
  return handleCorsPreflightIfNeeded(request)
    ?? new Response(null, { status: 204, headers: getCorsHeaders(request) });
};

const POST = async ({ request, params }: any) => {
  const preflight = handleCorsPreflightIfNeeded(request);
  if (preflight) return preflight;

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const { id: channelId } = params;
  const body = await readVoiceDisconnectBody(request);

  const gatewaySessionId = request.headers.get("X-Gateway-Session-Id")?.trim()
    || body.gateway_session_id?.trim()
    || null;
  const voiceSessionId = request.headers.get("X-Voice-Session-Id")?.trim()
    || body.voice_session_id?.trim()
    || null;

  if (!gatewaySessionId && !voiceSessionId) {
    return apiSuccess({ disconnected: false }, 202, request);
  }

  let serverId = body.server_id?.trim() || null;
  if (!serverId) {
    const row = await getDB().prepare(
      "SELECT server_id FROM channels WHERE id = ?",
    ).bind(channelId).first<{ server_id: string | null }>();

    serverId = row?.server_id?.trim() || null;
  }

  if (!serverId) {
    return apiSuccess({ disconnected: false }, 202, request);
  }

  const env = getEnv();
  const roomSlug = buildVoiceChannelRoomSlug(serverId, channelId);
  const globalGatewayStub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName("global-gateway"));
  const roomGatewayStub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomSlug));
  const voiceRoomStub = env.VOICE_ROOM.get(env.VOICE_ROOM.idFromName(roomSlug));

  const tasks: Promise<Response>[] = [];

  if (gatewaySessionId) {
    tasks.push(globalGatewayStub.fetch("https://internal/disconnect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        channel_id: channelId,
        session_id: gatewaySessionId,
      }),
    }));
  }

  if (voiceSessionId) {
    tasks.push(roomGatewayStub.fetch("https://internal/disconnect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        session_id: voiceSessionId,
      }),
    }));

    tasks.push(voiceRoomStub.fetch("https://internal/disconnect-participant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: voiceSessionId,
      }),
    }));
  }

  const settled = await Promise.allSettled(tasks);
  const disconnected = settled.some((result) => result.status === "fulfilled" && result.value.ok);

  return apiSuccess({ disconnected }, 202, request);
};

export const Route = createFileRoute("/api/channels/$id/voice-disconnect")({
  server: {
    handlers: {
      OPTIONS,
      POST,
    },
  },
});
