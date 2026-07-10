import { createFileRoute } from "@tanstack/react-router";
import { requireActiveVoiceRoomSession, requireAuth } from "@/lib/api-helpers";
import { clog } from "@/lib/console-logger";
import { resolveListenTogetherAudioStream } from "@/services/listen-together.service";

// Googlevideo rejects very large tail ranges, but 64 KB slices trigger too
// many upstream requests during normal playback. 1 MB keeps the request count
// low while still staying well below the "fetch the whole file" pattern that
// was failing in the HAR.
const LISTEN_TOGETHER_UPSTREAM_CHUNK_BYTES = 10 * 1024 * 1024;
const LISTEN_TOGETHER_UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const LISTEN_TOGETHER_IN_MEMORY_MAX_BYTES = 24 * 1024 * 1024;
const LISTEN_TOGETHER_IN_MEMORY_TTL_MS = 5 * 60 * 1000;
const streamLog = clog("listen-together:stream");

const listenTogetherInMemoryStreamCache = new Map<
  string,
  {
    bytes: Uint8Array;
    contentLength: number;
    mimeType: string | null;
    expiresAt: number;
  }
>();

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

function getListenTogetherMemoryCacheKey(
  videoId: string,
  preferredFormat: "mp4" | "webm",
) {
  return `${preferredFormat}:${videoId}`;
}

function readListenTogetherMemoryStream(cacheKey: string) {
  const cached = listenTogetherInMemoryStreamCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    listenTogetherInMemoryStreamCache.delete(cacheKey);
    return null;
  }

  return cached;
}

function writeListenTogetherMemoryStream(
  cacheKey: string,
  value: {
    bytes: Uint8Array;
    contentLength: number;
    mimeType: string | null;
  },
) {
  listenTogetherInMemoryStreamCache.set(cacheKey, {
    ...value,
    expiresAt: Date.now() + LISTEN_TOGETHER_IN_MEMORY_TTL_MS,
  });
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

function buildRangeResponseFromBuffer(
  bytes: Uint8Array,
  options: {
    requestedRange: string | null;
    contentLength: number;
    mimeType: string | null;
    includeBody: boolean;
  },
) {
  const parsedRange = parseByteRange(
    options.requestedRange,
    options.contentLength,
  );
  if (parsedRange === null) {
    return null;
  }

  if (parsedRange === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${options.contentLength}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const { start, end } = parsedRange;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
    "Content-Type": options.mimeType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  const toBody = (view: Uint8Array) => new Uint8Array(view).buffer;

  if (!options.requestedRange) {
    headers.set("Content-Length", String(options.contentLength));
    return new Response(options.includeBody ? toBody(bytes) : null, {
      status: 200,
      headers,
    });
  }

  const sliced = bytes.slice(start, end + 1);
  headers.set(
    "Content-Range",
    `bytes ${start}-${end}/${options.contentLength}`,
  );
  headers.set("Content-Length", String(sliced.byteLength));

  return new Response(options.includeBody ? toBody(sliced) : null, {
    status: 206,
    headers,
  });
}

export async function makeSyntheticRangeResponse(
  upstream: Response,
  range: string,
) {
  const match = range.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const contentLength = Number(upstream.headers.get("Content-Length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0) return null;

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
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${contentLength}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const buffer = new Uint8Array(await upstream.arrayBuffer());
  const sliced = buffer.slice(start, Math.min(end + 1, buffer.length));
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

function toGooglevideoQueryRange(range: string | null) {
  if (!range) return null;
  const match = range.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

async function fetchListenTogetherUpstream(
  upstreamUrl: URL,
  range: string | null,
  strategy: "header" | "query" = "header",
) {
  const requestUrl = new URL(upstreamUrl.toString());
  const headers = new Headers({
    Accept: "*/*",
    "User-Agent": LISTEN_TOGETHER_UPSTREAM_USER_AGENT,
  });

  if (strategy === "query") {
    const queryRange = toGooglevideoQueryRange(range);
    if (queryRange) {
      requestUrl.searchParams.set("range", queryRange);
    }
  } else if (range) {
    headers.set("Range", range);
  }

  return fetch(requestUrl.toString(), {
    method: "GET",
    headers,
    redirect: "follow",
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

  try {
    const range = request.headers.get("Range");
    streamLog.debug("Proxy request accepted", {
      userId: auth.userId,
      roomSlug,
      videoId,
      preferredFormat,
      includeBody,
      hasRange: !!range,
      exactSessionMatched: sessionCheck.exactSessionMatched,
      country: cf?.country ?? null,
      regionCode: cf?.regionCode ?? null,
      colo: cf?.colo ?? null,
    });

    const memoryCacheKey = getListenTogetherMemoryCacheKey(
      videoId,
      preferredFormat,
    );
    const memoryCached = readListenTogetherMemoryStream(memoryCacheKey);
    if (memoryCached) {
      streamLog.debug("Serving listen together audio from in-memory cache", {
        roomSlug,
        videoId,
        preferredFormat,
        includeBody,
        hasRange: !!range,
      });
      const response = buildRangeResponseFromBuffer(memoryCached.bytes, {
        requestedRange: range,
        contentLength: memoryCached.contentLength,
        mimeType: memoryCached.mimeType,
        includeBody,
      });
      if (response) return response;
    }

    let resolved = await resolveListenTogetherAudioStream(
      videoId,
      preferredFormat,
    );
    let upstreamUrl = new URL(resolved.url);
    if (!upstreamUrl.hostname.toLowerCase().includes("googlevideo.com")) {
      streamLog.error("Resolved listen together stream host is not allowed", {
        roomSlug,
        videoId,
        preferredFormat,
        host: upstreamUrl.hostname.toLowerCase(),
      });
      return Response.json(
        { error: "Resolved stream host is not allowed" },
        { status: 502 },
      );
    }

    const upstreamRange = normalizeListenTogetherUpstreamRange(range, {
      includeBody,
    });
    let upstream = await fetchListenTogetherUpstream(
      upstreamUrl,
      upstreamRange,
      "header",
    );

    if (!upstream.ok) {
      streamLog.warn("Upstream fetch failed; refreshing resolved stream URL", {
        roomSlug,
        videoId,
        preferredFormat,
        upstreamRange,
        status: upstream.status,
      });
      resolved = await resolveListenTogetherAudioStream(
        videoId,
        preferredFormat,
        { forceRefresh: true },
      );
      upstreamUrl = new URL(resolved.url);
      if (!upstreamUrl.hostname.toLowerCase().includes("googlevideo.com")) {
        streamLog.error(
          "Refreshed listen together stream host is not allowed",
          {
            roomSlug,
            videoId,
            preferredFormat,
            host: upstreamUrl.hostname.toLowerCase(),
          },
        );
        return Response.json(
          { error: "Resolved stream host is not allowed" },
          { status: 502 },
        );
      }

      upstream = await fetchListenTogetherUpstream(
        upstreamUrl,
        upstreamRange,
        "header",
      );
    }

    if (!upstream.ok && upstreamRange) {
      streamLog.warn("Header range retry failed; retrying with query range", {
        roomSlug,
        videoId,
        preferredFormat,
        upstreamRange,
        status: upstream.status,
      });
      upstream = await fetchListenTogetherUpstream(
        upstreamUrl,
        upstreamRange,
        "query",
      );
    }

    if (!upstream.ok) {
      const knownLength = resolved.contentLength ?? null;
      const canAttemptBufferedFallback =
        knownLength === null ||
        knownLength <= LISTEN_TOGETHER_IN_MEMORY_MAX_BYTES;

      const fullStream = canAttemptBufferedFallback
        ? await fetchListenTogetherUpstream(upstreamUrl, null, "header")
        : null;
      if (fullStream?.ok) {
        streamLog.warn("Falling back to buffered upstream response", {
          roomSlug,
          videoId,
          preferredFormat,
          upstreamRange,
        });
        const bytes = new Uint8Array(await fullStream.arrayBuffer());
        const totalLength =
          Number(fullStream.headers.get("Content-Length")) || bytes.byteLength;
        const mimeType =
          fullStream.headers.get("Content-Type") ||
          resolved.mimeType ||
          "application/octet-stream";

        if (totalLength <= LISTEN_TOGETHER_IN_MEMORY_MAX_BYTES) {
          writeListenTogetherMemoryStream(memoryCacheKey, {
            bytes,
            contentLength: totalLength,
            mimeType,
          });
        }

        const bufferedResponse = buildRangeResponseFromBuffer(bytes, {
          requestedRange: range,
          contentLength: totalLength,
          mimeType,
          includeBody,
        });
        if (bufferedResponse) {
          return bufferedResponse;
        }
      }

      streamLog.error("All upstream audio fetch strategies failed", {
        roomSlug,
        videoId,
        preferredFormat,
        upstreamRange,
        canAttemptBufferedFallback,
      });
      return Response.json(
        { error: "Failed to fetch upstream audio stream" },
        { status: 502 },
      );
    }

    if (includeBody && range && upstream.status === 200) {
      const syntheticRange = await makeSyntheticRangeResponse(
        upstream.clone(),
        range,
      );
      if (syntheticRange) return syntheticRange;
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

      return new Response(null, {
        status: range ? upstream.status : 200,
        headers,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
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
    return Response.json({ error: message }, { status: 502 });
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
