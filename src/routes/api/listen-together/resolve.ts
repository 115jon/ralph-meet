import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireActiveVoiceRoomSession, requireAuth } from "@/lib/api-helpers";
import { clog } from "@/lib/console-logger";
import { validateBody } from "@/lib/validate-body";
import { resolveListenTogetherUrl } from "@/services/listen-together.service";

const resolveLog = clog("listen-together:resolve");

export const listenTogetherResolveBodySchema = z
  .object({
    roomSlug: z.string().optional(),
    serverId: z.string().nullable().optional(),
    channelId: z.string().nullable().optional(),
    url: z.string().optional(),
  })
  .passthrough();

function getListenTogetherSourceHost(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const POST = async ({ request }: any) => {
  const startedAt = Date.now();
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const bodyResult = await validateBody(
    request,
    listenTogetherResolveBodySchema,
    request,
  );
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;

  const roomSlug = body.roomSlug?.trim();
  const sourceUrl = body.url?.trim();
  const serverId = body.serverId?.trim() ?? null;
  const channelId = body.channelId?.trim() ?? null;
  const cf = (
    request as Request & {
      cf?: {
        country?: string;
        regionCode?: string;
        colo?: string;
      };
    }
  ).cf;

  if (!roomSlug || !sourceUrl) {
    resolveLog.warn(
      "Rejecting listen together resolve without required parameters",
      {
        userId: auth.userId,
        roomSlug: roomSlug ?? null,
        hasUrl: !!sourceUrl,
        serverId,
        channelId,
        country: cf?.country ?? null,
        regionCode: cf?.regionCode ?? null,
        colo: cf?.colo ?? null,
      },
    );
    return Response.json({ error: "Missing roomSlug or url" }, { status: 400 });
  }

  const sessionCheck = await requireActiveVoiceRoomSession(
    request,
    auth.userId,
    roomSlug,
    {
      serverId,
      channelId,
      errorMessage:
        "You must be actively connected to this voice room to resolve media.",
    },
  );
  if (sessionCheck instanceof Response) return sessionCheck;

  try {
    const resolved = await resolveListenTogetherUrl(sourceUrl);
    resolveLog.info("Listen together resolve completed", {
      userId: auth.userId,
      roomSlug,
      sourceHost: getListenTogetherSourceHost(sourceUrl),
      serverId,
      channelId,
      exactSessionMatched: sessionCheck.exactSessionMatched,
      kind: resolved.kind,
      resolvedCount: resolved.resolvedCount,
      skippedCount: resolved.skippedCount,
      country: cf?.country ?? null,
      regionCode: cf?.regionCode ?? null,
      colo: cf?.colo ?? null,
      durationMs: Date.now() - startedAt,
    });
    return Response.json(resolved, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve media";
    resolveLog.warn("Listen together resolve failed", {
      userId: auth.userId,
      roomSlug,
      sourceHost: getListenTogetherSourceHost(sourceUrl),
      serverId,
      channelId,
      exactSessionMatched: sessionCheck.exactSessionMatched,
      country: cf?.country ?? null,
      regionCode: cf?.regionCode ?? null,
      colo: cf?.colo ?? null,
      durationMs: Date.now() - startedAt,
      message,
    });
    return Response.json({ error: message }, { status: 400 });
  }
};

export const Route = createFileRoute("/api/listen-together/resolve")({
  server: {
    handlers: { POST },
  },
});
