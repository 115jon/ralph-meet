import { createFileRoute } from "@tanstack/react-router";
import {
  requireActiveVoiceRoomSession,
  requireAuth,
} from "@/lib/api-helpers";
import { clog } from "@/lib/console-logger";
import { searchListenTogether } from "@/services/listen-together.service";

const searchLog = clog("listen-together:search");

const GET = async ({ request }: any) => {
  const startedAt = Date.now();
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const filter = url.searchParams.get("filter") === "collection" ? "collection" : "track";
  const roomSlug = url.searchParams.get("roomSlug")?.trim();
  const serverId = url.searchParams.get("serverId")?.trim() ?? null;
  const channelId = url.searchParams.get("channelId")?.trim() ?? null;
  const cf = (request as Request & {
    cf?: {
      country?: string;
      regionCode?: string;
      colo?: string;
    };
  }).cf;

  if (!roomSlug) {
    searchLog.warn("Rejecting listen together search without room slug", {
      userId: auth.userId,
      filter,
      queryLength: query.length,
      serverId,
      channelId,
      country: cf?.country ?? null,
      regionCode: cf?.regionCode ?? null,
      colo: cf?.colo ?? null,
    });
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
  searchLog.info("Listen together search completed", {
    userId: auth.userId,
    roomSlug,
    filter,
    queryLength: query.length,
    resultCount: response.results.length,
    serverId,
    channelId,
    exactSessionMatched: sessionCheck.exactSessionMatched,
    country: cf?.country ?? null,
    regionCode: cf?.regionCode ?? null,
    colo: cf?.colo ?? null,
    durationMs: Date.now() - startedAt,
  });
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
