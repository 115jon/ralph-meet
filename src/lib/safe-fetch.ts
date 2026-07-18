// ── safe-fetch ──────────────────────────────────────────────────────────────
// Hardened wrapper around the platform `fetch` for external/upstream requests.
//
// Goals:
//   1. Always bound request time with a timeout (via AbortSignal), while still
//      honouring any caller-supplied signal.
//   2. Provide capped body readers for BUFFERED reads (HTML / JSON metadata) so
//      a pathological upstream cannot exhaust Worker memory.
//   3. Stay a drop-in replacement: `safeFetch(url, init)` returns a normal
//      `Response`, so streaming pass-through paths (media proxying) are
//      unaffected — they simply don't call the capped readers.
//
// These limits are intentionally GENEROUS. They exist to stop abuse and
// runaway upstreams, not to constrain legitimate media. Streamed media never
// flows through the capped readers, so large video playback is unaffected.

/** Default request timeout for a single upstream fetch. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Default cap for BUFFERED text/JSON reads (metadata like HTML pages and API
 * responses). 12 MiB is far larger than any legitimate oEmbed/HTML payload but
 * prevents multi-GB responses from being materialised in memory.
 */
export const DEFAULT_MAX_BUFFER_BYTES = 12 * 1024 * 1024;

export interface SafeFetchOptions {
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Combine an optional caller signal with a timeout signal so either can abort
 * the request. Uses `AbortSignal.any` when available (workerd + modern
 * browsers), falling back to a manual controller.
 */
function withTimeoutSignal(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([callerSignal, timeoutSignal]);
  }
  // Fallback: propagate whichever fires first into a fresh controller.
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  if (callerSignal.aborted) controller.abort(callerSignal.reason);
  else
    callerSignal.addEventListener("abort", () => onAbort(callerSignal.reason), {
      once: true,
    });
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else
    timeoutSignal.addEventListener(
      "abort",
      () => onAbort(timeoutSignal.reason),
      { once: true },
    );
  return controller.signal;
}

/**
 * `fetch` with a mandatory timeout. Preserves a caller-supplied `signal` by
 * combining it with the timeout. Returns a standard `Response`.
 */
export async function safeFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options?: SafeFetchOptions,
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const signal = withTimeoutSignal(init?.signal, timeoutMs);
  return fetch(input, { ...init, signal });
}

/** Raised when a buffered read exceeds the configured byte cap. */
export class ResponseTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Response body exceeded ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Read a response body as text, aborting once `maxBytes` is exceeded. Use this
 * for HTML/metadata reads instead of `response.text()`.
 */
export async function readTextCapped(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BUFFER_BYTES,
): Promise<string> {
  // Fast reject via Content-Length when the upstream is honest.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Read a response body as JSON, aborting once `maxBytes` is exceeded. Use this
 * for API/metadata reads instead of `response.json()`.
 */
export async function readJsonCapped<T = unknown>(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BUFFER_BYTES,
): Promise<T> {
  const text = await readTextCapped(response, maxBytes);
  return JSON.parse(text) as T;
}
