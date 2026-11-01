import { createFileRoute } from "@tanstack/react-router";
import { requireActiveVoiceRoomSession, requireAuth } from "@/lib/api-helpers";
import { clog } from "@/lib/console-logger";
import { UpstreamBlockedError } from "@/lib/upstream-guard";
import { YouTubeBotCheckError } from "@/lib/ytdlp/youtube";
import { resolveListenTogetherAudioStream } from "@/services/listen-together.service";

// Googlevideo rejects very large tail ranges, so an open-ended browser range
// is fetched as one bounded slice; the browser asks for the next one.
const LISTEN_TOGETHER_UPSTREAM_CHUNK_BYTES = 10 * 1024 * 1024;
const LISTEN_TOGETHER_UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
/** Statuses that mean the cached URL went stale (expired, or bound elsewhere). */
const STALE_URL_STATUSES = new Set([401, 403, 404, 410]);
const BOT_CHECK_RETRY_AFTER_SECONDS = 20;
const streamLog = clog("listen-together:stream");

/**
 * What went wrong, for the client: the audio element only sees "error", so it
 * HEADs the same URL and reads the status (and this header when CORS lets it).
 */
export type ListenTogetherStreamErrorCode =
  | "YOUTUBE_BOT_CHECK"
  | "RESOLVE_FAILED"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED";

function streamError(
  status: number,
  code: ListenTogetherStreamErrorCode,
  message: string,
  retryAfterSeconds?: number,
) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Listen-Together-Error": code,
  });
  if (retryAfterSeconds) headers.set("Retry-After", String(retryAfterSeconds));
  return Response.json({ error: message, code }, { status, headers });
}

function resolveFailure(error: unknown) {
  if (
    error instanceof YouTubeBotCheckError ||
    error instanceof UpstreamBlockedError
  ) {
    return streamError(
      503,
      "YOUTUBE_BOT_CHECK",
      "YouTube is refusing our server for a moment. Try again shortly.",
      error instanceof UpstreamBlockedError
        ? error.retryAfterSeconds
        : BOT_CHECK_RETRY_AFTER_SECONDS,
    );
  }
  return streamError(
    502,
    "RESOLVE_FAILED",
    "Could not find a playable audio stream for this track.",
  );
}

/** Googlevideo media hosts only (`rr1---sn-x.googlevideo.com`), over https. */
export function isAllowedListenTogetherStreamHost(url: URL) {
  return (
    url.protocol === "https:" &&
    url.hostname.toLowerCase().endsWith(".googlevideo.com")
  );
}

async function cancelUpstreamBody(response: Response | null) {
  try {
    await response?.body?.cancel();
  } catch {
    // The body may already be consumed or locked by the runtime.
  }
}

export function buildProxyHeaders(upstreamHeaders: Headers) {
  const headers = new Headers();
  const passthroughHeaders = [
    "Accept-Ranges",
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "Etag",
    "Last-Modified",
  ];

  for (const header of passthroughHeaders) {
    const value = upstreamHeaders.get(header);
    if (value) headers.set(header, value);
  }

  headers.set("Cache-Control", "private, max-age=60");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function parseByteRange(range: string | null, contentLength: number) {
  if (!range) {
    return {
      start: 0,
      end: contentLength - 1,
    };
  }

  const match = range.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startText = match[1];
  const endText = match[2];
  let start: number;
  let end: number;

  if (!startText && endText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, contentLength - suffixLength);
    end = contentLength - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : contentLength - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= contentLength
  ) {
    return "invalid" as const;
  }

  return {
    start,
    end: Math.min(end, contentLength - 1),
  };
}

export async function makeSyntheticRangeResponse(
  upstream: Response,
  range: string,
) {
  const sourceRange = upstream.headers
    .get("Content-Range")
    ?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  const sourceStart = sourceRange ? Number(sourceRange[1]) : 0;
  const sourceEnd = sourceRange
    ? Number(sourceRange[2])
    : Number(upstream.headers.get("Content-Length")) - 1;
  const contentLength = sourceRange
    ? Number(sourceRange[3])
    : Number(upstream.headers.get("Content-Length"));
  if (
    !Number.isFinite(sourceStart) ||
    !Number.isFinite(sourceEnd) ||
    !Number.isFinite(contentLength) ||
    sourceStart < 0 ||
    sourceEnd < sourceStart ||
    contentLength <= sourceEnd
  ) {
    return null;
  }

  const requestedRange = parseByteRange(range, contentLength);
  if (requestedRange === null) return null;
  if (requestedRange === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${contentLength}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const { start, end } = requestedRange;
  if (start < sourceStart || end > sourceEnd) return null;

  const buffer = new Uint8Array(await upstream.arrayBuffer());
  const sliced = buffer.slice(start - sourceStart, end - sourceStart + 1);
  const headers = buildProxyHeaders(upstream.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Range",
    `bytes ${start}-${Math.min(end, contentLength - 1)}/${contentLength}`,
  );
  headers.set("Content-Length", String(sliced.byteLength));

  return new Response(sliced, {
    status: 206,
    headers,
  });
}

function upstreamRangeMatchesRequest(
  upstreamContentRange: string | null,
  requestedRange: string,
) {
  const upstreamRange = upstreamContentRange?.match(
    /^bytes\s+(\d+)-(\d+)\/(\d+)$/i,
  );
  if (!upstreamRange) return false;

  const contentLength = Number(upstreamRange[3]);
  const parsedRequest = parseByteRange(requestedRange, contentLength);
  if (!parsedRequest || parsedRequest === "invalid") return false;

  return (
    Number(upstreamRange[1]) === parsedRequest.start &&
    Number(upstreamRange[2]) === parsedRequest.end
  );
}

export function normalizeListenTogetherUpstreamRange(
  requestedRange: string | null,
  options?: {
    includeBody?: boolean;
    chunkBytes?: number;
  },
) {
  const includeBody = options?.includeBody ?? true;
  const chunkBytes =
    options?.chunkBytes ?? LISTEN_TOGETHER_UPSTREAM_CHUNK_BYTES;

  if (!requestedRange) {
    if (!includeBody) return "bytes=0-1";
    return `bytes=0-${chunkBytes - 1}`;
  }

  const match = requestedRange.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) {
    return requestedRange;
  }

  const start = Number(match[1]);
  const endText = match[2];
  if (!Number.isFinite(start) || start < 0) {
    return requestedRange;
  }

  if (endText) {
    const end = Number(endText);
    if (!Number.isFinite(end) || end < start) {
      return requestedRange;
    }

    if (!includeBody) {
      return `bytes=${start}-${Math.min(end, start + 1)}`;
    }

    return `bytes=${start}-${Math.min(end, start + chunkBytes - 1)}`;
  }

  if (!includeBody) {
    return `bytes=${start}-${start + 1}`;
  }

  return `bytes=${start}-${start + chunkBytes - 1}`;
}

async function fetchListenTogetherUpstream(upstreamUrl: URL, range: string) {
  return fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "*/*",
      Range: range,
      "User-Agent": LISTEN_TOGETHER_UPSTREAM_USER_AGENT,
    },
    redirect: "follow",
  });
}

/**
 * Resolve the track (cached) and relay one bounded range of it. A URL that
 * went stale is resolved again once; nothing else is retried here, so a
 * failing track costs at most two resolves and two upstream fetches.
 */
export async function streamListenTogetherAudio(args: {
  videoId: string;
  preferredFormat: "mp4" | "webm";
  range: string | null;
  includeBody: boolean;
  logContext?: Record<string, unknown>;
}): Promise<Response> {
  const { videoId, preferredFormat, range, includeBody } = args;
  const context = { videoId, preferredFormat, ...args.logContext };

  let resolved: Awaited<ReturnType<typeof resolveListenTogetherAudioStream>>;
  try {
    resolved = await resolveListenTogetherAudioStream(videoId, preferredFormat);
  } catch (error) {
    streamLog.warn("Could not resolve listen together audio", {
      ...context,
      message: error instanceof Error ? error.message : String(error),
    });
    return resolveFailure(error);
  }

  let upstreamUrl = new URL(resolved.url);
  if (!isAllowedListenTogetherStreamHost(upstreamUrl)) {
    streamLog.error("Resolved listen together stream host is not allowed", {
      ...context,
      host: upstreamUrl.hostname.toLowerCase(),
    });
    return streamError(
      502,
      "HOST_NOT_ALLOWED",
      "Resolved stream host is not allowed",
    );
  }

  const upstreamRange = normalizeListenTogetherUpstreamRange(range, {
    includeBody,
  });
  let upstream = await fetchListenTogetherUpstream(upstreamUrl, upstreamRange);

  if (STALE_URL_STATUSES.has(upstream.status)) {
    streamLog.warn("Upstream refused the cached URL; resolving it again", {
      ...context,
      upstreamRange,
      status: upstream.status,
      itag: resolved.itag,
    });
    await cancelUpstreamBody(upstream);
    try {
      resolved = await resolveListenTogetherAudioStream(
        videoId,
        preferredFormat,
        { forceRefresh: true },
      );
    } catch (error) {
      streamLog.warn("Refreshing the listen together stream failed", {
        ...context,
        message: error instanceof Error ? error.message : String(error),
      });
      return resolveFailure(error);
    }
    upstreamUrl = new URL(resolved.url);
    if (!isAllowedListenTogetherStreamHost(upstreamUrl)) {
      return streamError(
        502,
        "HOST_NOT_ALLOWED",
        "Resolved stream host is not allowed",
      );
    }
    upstream = await fetchListenTogetherUpstream(upstreamUrl, upstreamRange);
  }

  if (!upstream.ok) {
    await cancelUpstreamBody(upstream);
    streamLog.error("Upstream audio fetch failed", {
      ...context,
      upstreamRange,
      status: upstream.status,
      itag: resolved.itag,
    });
    if (upstream.status === 429) {
      return streamError(
        503,
        "UPSTREAM_FAILED",
        "YouTube is rate limiting playback. Try again shortly.",
        BOT_CHECK_RETRY_AFTER_SECONDS,
      );
    }
    return streamError(
      502,
      "UPSTREAM_FAILED",
      "Failed to fetch upstream audio stream",
    );
  }

  if (
    includeBody &&
    range &&
    (upstream.status === 200 ||
      !upstreamRangeMatchesRequest(
        upstream.headers.get("Content-Range"),
        range,
      ))
  ) {
    // No clone: it declines from the headers alone, before reading the body.
    // (Awaiting cancel() on one branch of a cloned body waits for the other.)
    const syntheticRange = await makeSyntheticRangeResponse(upstream, range);
    if (syntheticRange) {
      // A 416 never read the body; a slice already drained it.
      await cancelUpstreamBody(upstream);
      return syntheticRange;
    }
  }

  const headers = buildProxyHeaders(upstream.headers);
  if (resolved.contentLength && !headers.get("Content-Length")) {
    headers.set("Content-Length", String(resolved.contentLength));
  }
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") ||
      resolved.mimeType ||
      "application/octet-stream",
  );

  if (!includeBody) {
    if (!range) {
      headers.delete("Content-Range");
      if (resolved.contentLength) {
        headers.set("Content-Length", String(resolved.contentLength));
      }
    }

    await cancelUpstreamBody(upstream);
    return new Response(null, {
      status: range ? upstream.status : 200,
      headers,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function proxyListenTogetherStream(
  request: Request,
  includeBody: boolean,
): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const roomSlug = url.searchParams.get("roomSlug")?.trim();
  const videoId = url.searchParams.get("videoId")?.trim();
  const preferredFormat =
    url.searchParams.get("format") === "webm" ? "webm" : "mp4";
  const serverId = url.searchParams.get("serverId")?.trim() ?? null;
  const channelId = url.searchParams.get("channelId")?.trim() ?? null;
  const cf = (
    request as Request & {
      cf?: {
        country?: string;
        regionCode?: string;
        colo?: string;
      };
    }
  ).cf;

  if (!roomSlug || !videoId) {
    streamLog.warn(
      "Rejecting listen together stream request without required parameters",
      {
        userId: auth.userId,
        roomSlug: roomSlug ?? null,
        videoId: videoId ?? null,
        preferredFormat,
        includeBody,
        serverId,
        channelId,
        country: cf?.country ?? null,
        regionCode: cf?.regionCode ?? null,
        colo: cf?.colo ?? null,
      },
    );
    return Response.json(
      { error: "Missing roomSlug or videoId" },
      { status: 400 },
    );
  }

  const sessionCheck = await requireActiveVoiceRoomSession(
    request,
    auth.userId,
    roomSlug,
    {
      serverId,
      channelId,
      errorMessage:
        "You must be actively connected to this voice room to stream media.",
    },
  );
  if (sessionCheck instanceof Response) return sessionCheck;

  const range = request.headers.get("Range");
  try {
    return await streamListenTogetherAudio({
      videoId,
      preferredFormat,
      range,
      includeBody,
      logContext: {
        userId: auth.userId,
        roomSlug,
        hasRange: !!range,
        colo: cf?.colo ?? null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to proxy audio stream";
    streamLog.error("Listen together proxy failed", {
      roomSlug,
      videoId,
      preferredFormat,
      includeBody,
      message,
    });
    return streamError(502, "UPSTREAM_FAILED", message);
  }
}

const GET = async ({ request }: any) =>
  proxyListenTogetherStream(request, true);
const HEAD = async ({ request }: any) =>
  proxyListenTogetherStream(request, false);

export const Route = createFileRoute("/api/listen-together/stream")({
  server: {
    handlers: { GET, HEAD },
  },
});
