import { createFileRoute } from "@tanstack/react-router";
import {
  requireActiveVoiceRoomSession,
  requireAuth,
} from "@/lib/api-helpers";
import { searchListenTogether } from "@/services/listen-together.service";

const GET = async ({ request }: any) => {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const filter = url.searchParams.get("filter") === "collection" ? "collection" : "track";
  const roomSlug = url.searchParams.get("roomSlug")?.trim();
  const serverId = url.searchParams.get("serverId")?.trim() ?? null;
  const channelId = url.searchParams.get("channelId")?.trim() ?? null;

  if (!roomSlug) {
    return Response.json({ error: "Missing roomSlug parameter" }, { status: 400 });
  }

  const sessionCheck = await requireActiveVoiceRoomSession(
    request,
    auth.userId,
    roomSlug,
    {
      serverId,
      channelId,
      errorMessage: "You must be actively connected to this voice room to search Listen Together.",
    },
  );
  if (sessionCheck instanceof Response) return sessionCheck;

  const response = await searchListenTogether(query, filter);
  return Response.json(response, {
    headers: {
      "Cache-Control": "private, max-age=30",
    },
  });
};

export const Route = createFileRoute("/api/listen-together/search")({
  server: {
    handlers: { GET },
  },
});
