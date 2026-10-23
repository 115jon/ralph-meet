import { createFileRoute } from "@tanstack/react-router";

import { getDB, getEnv } from "@/lib/api-helpers";
import {
  CatalogIngestConflictError,
  CatalogStorageError,
  CatalogValidationError,
  MAX_INGEST_BODY_BYTES,
  describeError,
  getCollectiblesIngestState,
  ingestCollectiblesCatalog,
  ingestRetryAfterMs,
  type CollectiblesIngestInput,
} from "@/lib/collectibles-catalog";

/**
 * Machine-to-machine endpoint for the off-Cloudflare catalog fetcher (the
 * upstream blocks Workers egress). Bearer COLLECTIBLES_INGEST_TOKEN only.
 *
 * GET  → { etag, syncedAt, formatVersion } so the fetcher can send
 *        If-None-Match upstream.
 * POST → body: raw upstream JSON (optionally Content-Encoding: gzip),
 *        X-Upstream-ETag: upstream ETag. With X-Upstream-Not-Modified: 1 and
 *        no body it only refreshes syncedAt (free; not rate limited).
 */

class PayloadTooLargeError extends Error {}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function fail(
  error: string,
  code: string,
  status: number,
  headers?: HeadersInit,
) {
  return json({ error, code }, status, headers);
}

async function sha256(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/** Compares fixed-length digests so neither length nor content leaks. */
async function tokensMatch(provided: string, expected: string) {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

/** null when authorised, otherwise the error response. */
async function authorize(request: Request): Promise<Response | null> {
  const env = getEnv() as unknown as Record<string, unknown>;
  const expected = env.COLLECTIBLES_INGEST_TOKEN;
  if (typeof expected !== "string" || expected.length < 32) {
    return fail(
      "Catalog ingest is not configured",
      "COLLECTIBLES_INGEST_DISABLED",
      503,
    );
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (!match || !(await tokensMatch(match[1], expected))) {
    return fail("Unauthorized", "UNAUTHORIZED", 401, {
      "WWW-Authenticate": "Bearer",
    });
  }
  return null;
}

/** Reads the body up to `limit` decompressed bytes, inflating gzip. */
async function readBody(request: Request, limit: number) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) return "";

  let stream: ReadableStream<Uint8Array> = request.body;
  const encoding = request.headers.get("Content-Encoding")?.toLowerCase();
  if (encoding === "gzip") {
    stream = stream.pipeThrough(
      new DecompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
  } else if (encoding && encoding !== "identity") {
    throw new CatalogValidationError(
      `Unsupported Content-Encoding ${encoding}`,
    );
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new CatalogValidationError(
      `Unreadable request body: ${describeError(error)}`,
    );
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export const GET = async ({ request }: { request: Request }) => {
  const denied = await authorize(request);
  if (denied) return denied;

  const state = await getCollectiblesIngestState(getDB());
  return json({
    etag: state.etag,
    syncedAt: state.syncedAt,
    formatVersion: state.formatVersion,
  });
};

export const POST = async ({ request }: { request: Request }) => {
  const denied = await authorize(request);
  if (denied) return denied;

  const db = getDB();
  const etag = request.headers.get("X-Upstream-ETag")?.trim() || null;
  const notModified = request.headers.get("X-Upstream-Not-Modified") === "1";

  let input: CollectiblesIngestInput;
  if (notModified) {
    if (!etag) {
      return fail(
        "X-Upstream-Not-Modified needs X-Upstream-ETag",
        "COLLECTIBLES_INGEST_BAD_REQUEST",
        400,
      );
    }
    input = { notModified: true, etag };
  } else {
    const state = await getCollectiblesIngestState(db);
    const retryAfterMs = ingestRetryAfterMs(state);
    if (retryAfterMs > 0) {
      const seconds = Math.ceil(retryAfterMs / 1000);
      return fail(
        `One ingest per 5 minutes. Try again in ${seconds}s.`,
        "COLLECTIBLES_INGEST_RATE_LIMITED",
        429,
        { "Retry-After": String(seconds) },
      );
    }
    try {
      input = {
        body: await readBody(request, MAX_INGEST_BODY_BYTES),
        etag,
      };
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return fail(
          `Body is over ${MAX_INGEST_BODY_BYTES} bytes`,
          "COLLECTIBLES_INGEST_TOO_LARGE",
          413,
        );
      }
      return fail(describeError(error), "COLLECTIBLES_INGEST_REJECTED", 422);
    }
  }

  try {
    const catalog = await ingestCollectiblesCatalog(db, input);
    return json({
      outcome: catalog.sync?.lastOutcome ?? "updated",
      syncedAt: catalog.syncedAt,
      etag,
      categories: catalog.categories.length,
      items: catalog.items.length,
      counts: catalog.counts,
    });
  } catch (error) {
    const message = describeError(error);
    if (error instanceof CatalogValidationError) {
      return fail(message, "COLLECTIBLES_INGEST_REJECTED", 422);
    }
    if (error instanceof CatalogIngestConflictError) {
      return fail(message, "COLLECTIBLES_INGEST_ETAG_MISMATCH", 409);
    }
    if (error instanceof CatalogStorageError) {
      return fail(message, "COLLECTIBLES_INGEST_TOO_LARGE", 413);
    }
    console.error("Collectibles ingest failed:", message);
    return fail(message, "COLLECTIBLES_INGEST_FAILED", 500);
  }
};

export const Route = createFileRoute("/api/collectibles/ingest")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
