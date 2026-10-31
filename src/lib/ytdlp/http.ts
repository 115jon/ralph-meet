import { requireActiveVoiceRoomSession, requireAuth } from "@/lib/api-helpers";
import { lenient, lenientBoolean, lenientString } from "@/lib/lenient-schema";
import { safeParse } from "@/lib/schema";
import { Schema } from "effect";
import { getYtDlpUpstreamStatus, syncYtDlpUpstream } from "./upstream";
import { resolveYouTubePlayback } from "./youtube";

const BACKGROUND_SYNC_MAX_AGE_MS = 1000 * 60 * 60 * 6;

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/** The resolve request. A field of the wrong type is ignored rather than failing the call. */
const ResolveRequestBody = Schema.Struct({
  url: lenientString,
  videoId: lenientString,
  roomSlug: lenientString,
  serverId: lenientString,
  channelId: lenientString,
  preferredKind: lenient(Schema.Literals(["audio", "video", "muxed", "any"])),
  preferredContainer: lenient(Schema.Literals(["mp4", "webm"])),
  includeFormats: lenientBoolean,
});

function isStaleStatus(status: { syncedAt: string | null }) {
  if (!status.syncedAt) return true;
  const timestamp = Date.parse(status.syncedAt);
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp > BACKGROUND_SYNC_MAX_AGE_MS;
}

async function readResolveBody(
  request: Request,
): Promise<typeof ResolveRequestBody.Type> {
  const body = safeParse(
    ResolveRequestBody,
    await request.json().catch(() => null),
  );
  return body.success ? body.data : {};
}

export async function handleYtDlpRequest(
  request: Request,
  ctx: ExecutionContextLike,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/ytdlp/")) {
    return null;
  }

  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (url.pathname === "/api/ytdlp/status" && request.method === "GET") {
    const status = await getYtDlpUpstreamStatus();
    if (isStaleStatus(status)) {
      ctx.waitUntil(syncYtDlpUpstream().catch(() => {}));
    }

    return Response.json(status, {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  if (url.pathname === "/api/ytdlp/sync" && request.method === "POST") {
    const status = await syncYtDlpUpstream(true);
    return Response.json(status, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (url.pathname === "/api/ytdlp/resolve" && request.method === "POST") {
    const body = await readResolveBody(request);
    const source = body.url?.trim() || body.videoId?.trim();
    if (!source) {
      return Response.json(
        { error: "Missing url or videoId" },
        { status: 400 },
      );
    }

    const roomSlug = body.roomSlug?.trim();
    if (roomSlug) {
      const sessionCheck = await requireActiveVoiceRoomSession(
        request,
        auth.userId,
        roomSlug,
        {
          serverId: body.serverId?.trim() ?? null,
          channelId: body.channelId?.trim() ?? null,
          errorMessage:
            "You must be actively connected to this voice room to resolve YouTube media.",
        },
      );
      if (sessionCheck instanceof Response) return sessionCheck;
    }

    const status = await getYtDlpUpstreamStatus();
    if (isStaleStatus(status)) {
      ctx.waitUntil(syncYtDlpUpstream().catch(() => {}));
    }

    try {
      const resolved = await resolveYouTubePlayback(source, {
        preferredKind: body.preferredKind ?? "audio",
        preferredContainer: body.preferredContainer,
        includeFormats: body.includeFormats,
      });

      return Response.json(resolved, {
        headers: {
          "Cache-Control": "private, max-age=30",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to resolve YouTube playback";
      return Response.json({ error: message }, { status: 502 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
