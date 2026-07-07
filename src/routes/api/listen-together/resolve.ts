import { createFileRoute } from "@tanstack/react-router";
import {
  requireActiveVoiceRoomSession,
  requireAuth,
} from "@/lib/api-helpers";
import { resolveListenTogetherUrl } from "@/services/listen-together.service";

const POST = async ({ request }: any) => {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json() as {
    roomSlug?: string;
    serverId?: string | null;
    channelId?: string | null;
    url?: string;
  };

  const roomSlug = body.roomSlug?.trim();
  const sourceUrl = body.url?.trim();
  const serverId = body.serverId?.trim() ?? null;
  const channelId = body.channelId?.trim() ?? null;

  if (!roomSlug || !sourceUrl) {
    return Response.json({ error: "Missing roomSlug or url" }, { status: 400 });
  }

  const sessionCheck = await requireActiveVoiceRoomSession(
    request,
    auth.userId,
    roomSlug,
    {
      serverId,
      channelId,
      errorMessage: "You must be actively connected to this voice room to resolve media.",
    },
  );
  if (sessionCheck instanceof Response) return sessionCheck;

  try {
    const resolved = await resolveListenTogetherUrl(sourceUrl);
    return Response.json(resolved, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve media";
    return Response.json({ error: message }, { status: 400 });
  }
};

export const Route = createFileRoute("/api/listen-together/resolve")({
  server: {
    handlers: { POST },
  },
});
