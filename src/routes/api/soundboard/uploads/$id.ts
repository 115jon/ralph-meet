import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  getBucket,
  getDB,
  getEnv,
  requireAuth,
} from "@/lib/api-helpers";
import {
  getR2ObjectRangeBounds,
  resolveR2ByteRangeHeader,
  toR2GetOptions,
} from "@/lib/r2-range";
import { verifySoundboardMediaCapability } from "@/lib/voice/soundboard-media-capability";

interface SoundboardUploadRouteContext {
  request: Request;
  params: { id?: string };
}

const GET = async ({
  request,
  params,
}: SoundboardUploadRouteContext): Promise<Response> => {
  const soundId = params.id?.trim();
  if (!soundId || soundId.includes("/")) {
    return apiError("Soundboard upload not found", 404);
  }

  const requestUrl = new URL(request.url);
  const capabilityToken = requestUrl.searchParams.get("cap");
  let attachment: {
    file_key: string;
    filename: string;
    content_type: string;
  } | null;

  if (capabilityToken !== null) {
    const env = getEnv() as CloudflareEnv & {
      REALTIME_TICKET_SECRET?: string;
    };
    if (!env.REALTIME_TICKET_SECRET) {
      return apiError("Soundboard upload not found", 404);
    }
    const roomSlug = requestUrl.searchParams.get("room_slug");
    const playbackId = requestUrl.searchParams.get("playback_id");
    if (!roomSlug || !playbackId) {
      return apiError("Soundboard upload not found", 404);
    }
    const verification = await verifySoundboardMediaCapability(
      capabilityToken,
      env.REALTIME_TICKET_SECRET,
      { now: Date.now(), soundId, roomSlug, playbackId },
    );
    if (!verification.ok) {
      return apiError("Soundboard upload not found", 404);
    }

    attachment = await getDB()
      .prepare(
        `SELECT a.file_key, a.filename, a.content_type
         FROM attachments a
         JOIN server_members sm
           ON sm.server_id = a.soundboard_server_id
          AND sm.user_id = ?
         WHERE a.id = ?
           AND a.soundboard_server_id = ?
           AND a.content_type LIKE 'audio/%'
          LIMIT 1`,
      )
      .bind(
        verification.claims.issuerSubject,
        soundId,
        verification.claims.sourceServerId,
      )
      .first<{
        file_key: string;
        filename: string;
        content_type: string;
      }>();
  } else {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    attachment = await getDB()
      .prepare(
        `SELECT a.file_key, a.filename, a.content_type
         FROM attachments a
         WHERE a.id = ?
           AND a.soundboard_server_id IS NOT NULL
           AND a.content_type LIKE 'audio/%'
           AND EXISTS (
             SELECT 1
             FROM server_members sm
             WHERE sm.server_id = a.soundboard_server_id
               AND sm.user_id = ?
           )
         LIMIT 1`,
      )
      .bind(soundId, authResult.userId)
      .first<{
        file_key: string;
        filename: string;
        content_type: string;
      }>();
  }

  if (!attachment || !attachment.content_type.startsWith("audio/")) {
    return apiError("Soundboard upload not found", 404);
  }

  const rangeHeader = request.headers.get("Range");
  const bucket = getBucket();
  const metadata = await bucket.head(attachment.file_key);
  if (!metadata) return apiError("Soundboard upload not found", 404);

  const parsedRange = resolveR2ByteRangeHeader(rangeHeader, metadata.size);
  if (parsedRange.requested && parsedRange.invalid) {
    const errorHeaders = new Headers();
    errorHeaders.set("Content-Range", `bytes */${metadata.size}`);
    errorHeaders.set("Accept-Ranges", "bytes");
    return new Response(null, { status: 416, headers: errorHeaders });
  }

  const object = await bucket.get(
    attachment.file_key,
    toR2GetOptions(parsedRange.range),
  );
  if (!object) return apiError("Soundboard upload not found", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", attachment.content_type);
  headers.set(
    "Content-Disposition",
    `inline; filename="${attachment.filename.replace(/["\\\r\n]/g, "_")}"`,
  );
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Cache-Control",
    parsedRange.requested ? "no-store" : "private, no-store",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  let status = 200;
  if (parsedRange.requested) {
    status = 206;
    let offset = parsedRange.offset ?? 0;
    let length = parsedRange.length ?? metadata.size - offset;

    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      offset >= metadata.size ||
      length <= 0 ||
      offset + length > metadata.size
    ) {
      const errorHeaders = new Headers(headers);
      errorHeaders.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers: errorHeaders });
    }

    const objectRange = getR2ObjectRangeBounds(object.range);
    if (objectRange.offset !== undefined) offset = objectRange.offset;
    if (objectRange.length !== undefined) length = objectRange.length;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      offset >= metadata.size ||
      length <= 0 ||
      offset + length > metadata.size
    ) {
      const errorHeaders = new Headers(headers);
      errorHeaders.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers: errorHeaders });
    }
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${metadata.size}`,
    );
    headers.set("Content-Length", length.toString());
  } else {
    headers.set("Content-Length", metadata.size.toString());
  }

  return new Response(object.body as ReadableStream, { status, headers });
};

export { GET };

export const Route = createFileRoute("/api/soundboard/uploads/$id")({
  server: {
    handlers: {
      GET,
    },
  },
});
