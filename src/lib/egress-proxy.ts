// ── egress-proxy ────────────────────────────────────────────────────────────
// Client for the house egress proxy (https://egress.115jon.com), a signed
// relay on a US server. From Cloudflare's shared IP ranges TikTok's player API
// sometimes answers 404 and tikwm answers "Free Api Limit" for everyone, so
// the TikTok chain in `share-preview-proxy` asks the proxy instead.
//
// Wire contract (see docs/deploy.md):
//
//   POST {base}/fetch    { url, method: "GET" | "HEAD", headers?, nonce }
//   POST {base}/resolve  { url, headers?, nonce }   (follows <= 5 redirects)
//
//   ts  = unix seconds (the proxy accepts +-60 s)
//   sig = hex(HMAC_SHA256(key = EGRESS_PROXY_SECRET, msg = ts + "\n" + body))
//   X-Egress-Timestamp: ts, X-Egress-Signature: sig
//
// The proxy answers JSON. `/fetch` wraps the upstream's answer in an
// envelope (status, headers, utf8 or base64 body) and never follows
// redirects. A failure of the proxy itself is `{ ok: false, error, message }`
// with a status that says what to do (mapped in `EgressError`). A non-JSON
// answer is a Cloudflare error page in front of the proxy: transient.
//
// The client is off when `EGRESS_PROXY_SECRET` is unset (local dev, Worker
// Previews); callers check `egressEnabled` and fetch directly instead.
//
// SERVER-SIDE ONLY (Effect Schema; see `lenient-schema`).

import { Schema } from "effect";
import { clog } from "@/lib/console-logger";
import { looseStruct, safeParseJson } from "@/lib/schema";
import {
  lenient,
  lenientBoolean,
  lenientNumber,
  lenientString,
  lenientText,
} from "@/lib/lenient-schema";
import { readTextCapped, safeFetch } from "@/lib/safe-fetch";
import {
  parseRetryAfter,
  upstreamGuard,
  type GuardErrorOutcome,
} from "@/lib/upstream-guard";

const log = clog("egress-proxy");

export const DEFAULT_EGRESS_PROXY_URL = "https://egress.115jon.com";

/** The proxy's own circuit: shared by every provider that goes through it. */
export const EGRESS_PROXY_CIRCUIT = "egress-proxy";

/** Suffix that keys a provider's circuit apart from its direct path. */
export function egressProviderName(provider: string): string {
  return `${provider}@egress`;
}

/** How long a rejected request (bad signature, blocked host, ...) pauses the proxy. */
const HARD_FAILURE_BACKOFF_SECONDS = 10 * 60;
/** The proxy's own request ceiling; its upstream timeout sits below this. */
const EGRESS_TIMEOUT_MS = 25_000;
/** Envelope cap: base64 inflates a 8 MiB body by a third. */
const EGRESS_MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;

export interface EgressEnv {
  EGRESS_PROXY_SECRET?: unknown;
  EGRESS_PROXY_URL?: unknown;
}

export interface EgressRequest {
  url: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
}

export interface EgressCallOptions {
  timeoutMs?: number;
  /** Test hook: the clock the signature timestamp is taken from. */
  now?: () => number;
}

/**
 * What the caller should do about a failed proxy call.
 *
 * - `backoff`: 429 or 503. Pause the proxy for `retryAfterSeconds`.
 * - `transient`: 424 (the upstream failed), a 5xx, or a non-JSON answer.
 *   Count it as a soft failure; a retry later may work.
 * - `hard`: 400, 401, 403, 413. The request itself was refused; repeating it
 *   cannot help, so the circuit opens for a long while.
 * - `refused`: `/resolve` met a redirect outside the allowlist (422).
 */
export type EgressErrorKind = "backoff" | "transient" | "hard" | "refused";

export class EgressError extends Error {
  constructor(
    readonly kind: EgressErrorKind,
    message: string,
    readonly details: {
      status?: number;
      code?: string;
      retryAfterSeconds?: number;
      location?: string;
    } = {},
  ) {
    super(message);
    this.name = "EgressError";
  }

  get status(): number | undefined {
    return this.details.status;
  }
  get code(): string | undefined {
    return this.details.code;
  }
  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }
  get location(): string | undefined {
    return this.details.location;
  }
}

/** Thrown when a call is made without configuration; callers should check `egressEnabled`. */
export class EgressDisabledError extends Error {
  constructor() {
    super("The egress proxy is not configured");
    this.name = "EgressDisabledError";
  }
}

interface EgressConfig {
  secret: string;
  baseUrl: string;
}

function readEgressConfig(env: EgressEnv): EgressConfig | null {
  const secret = env.EGRESS_PROXY_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") return null;
  const configured = env.EGRESS_PROXY_URL;
  const baseUrl =
    typeof configured === "string" && configured.trim() !== ""
      ? configured.trim()
      : DEFAULT_EGRESS_PROXY_URL;
  return { secret, baseUrl: baseUrl.replace(/\/+$/, "") };
}

/** True when the Worker has the secret, so the proxy path may be used. */
export function egressEnabled(env: EgressEnv): boolean {
  return readEgressConfig(env) !== null;
}

// ── Signing ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** 16 random bytes as hex: one per request, so the proxy can reject replays. */
export function createEgressNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** `hex(HMAC_SHA256(secret, timestamp + "\n" + body))`. */
export async function signEgressBody(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${body}`),
  );
  return toHex(new Uint8Array(signature));
}

/** The only request headers the proxy forwards. */
const FORWARDED_HEADERS = [
  "user-agent",
  "accept",
  "accept-language",
  "referer",
] as const;

type ForwardedHeaderName = (typeof FORWARDED_HEADERS)[number];
type ForwardedHeaders = Partial<Record<ForwardedHeaderName, string>>;

function isForwardedHeaderName(name: string): name is ForwardedHeaderName {
  return (FORWARDED_HEADERS as readonly string[]).includes(name);
}

function pickForwardedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): ForwardedHeaders {
  const picked: ForwardedHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (isForwardedHeaderName(lower)) picked[lower] = value;
  }
  return picked;
}

// ── Envelope ────────────────────────────────────────────────────────────────

/** Every field is optional: the shape is checked by hand below. */
const EgressEnvelope = looseStruct({
  ok: lenientBoolean,
  status: lenientNumber,
  url: lenientString,
  headers: lenient(Schema.Record(Schema.String, Schema.String)),
  encoding: lenientText,
  body: lenientString,
  hops: lenientNumber,
  error: lenientText,
  message: lenientText,
  location: lenientString,
});

type DecodedEnvelope = typeof EgressEnvelope.Type;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Statuses a `Response` cannot carry a body with. */
function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

function retryAfterFrom(response: Response): number | undefined {
  return parseRetryAfter(response.headers.get("Retry-After"));
}

/** Map a proxy failure (not a failure of the upstream) to what to do about it. */
function failureFor(
  response: Response,
  envelope: DecodedEnvelope | undefined,
): EgressError {
  const status = response.status;
  const code = envelope?.error;
  const message = envelope?.message ?? code ?? `HTTP ${status}`;
  const retryAfterSeconds = retryAfterFrom(response);
  const details = { status, code, retryAfterSeconds };

  if (status === 429 || status === 503) {
    return new EgressError("backoff", message, details);
  }
  if (status === 422 && code === "redirect_not_allowed") {
    return new EgressError("refused", message, {
      ...details,
      location: envelope?.location,
    });
  }
  if (
    status === 200 ||
    status === 408 ||
    status === 424 ||
    status === 425 ||
    status >= 500
  ) {
    return new EgressError("transient", message, details);
  }
  // 400, 401, 403, 413 and anything else the proxy refuses outright.
  return new EgressError("hard", message, details);
}

async function callEgress(
  env: EgressEnv,
  path: "/fetch" | "/resolve",
  payload: Record<string, unknown>,
  options?: EgressCallOptions,
): Promise<{ response: Response; envelope: DecodedEnvelope }> {
  const config = readEgressConfig(env);
  if (!config) throw new EgressDisabledError();

  const body = JSON.stringify({ ...payload, nonce: createEgressNonce() });
  const timestamp = String(Math.floor((options?.now ?? Date.now)() / 1000));
  const signature = await signEgressBody(config.secret, timestamp, body);

  let response: Response;
  let text: string;
  try {
    response = await safeFetch(
      `${config.baseUrl}${path}`,
      {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "X-Egress-Timestamp": timestamp,
          "X-Egress-Signature": signature,
        },
      },
      { timeoutMs: options?.timeoutMs ?? EGRESS_TIMEOUT_MS },
    );
    text = await readTextCapped(response, EGRESS_MAX_ENVELOPE_BYTES);
  } catch (error) {
    throw new EgressError(
      "transient",
      error instanceof Error ? error.message : String(error),
    );
  }

  const decoded = safeParseJson(EgressEnvelope, text);
  if (!decoded.success) {
    // Cloudflare's error page in front of the proxy, or a reset mid-body.
    throw new EgressError("transient", "The egress proxy did not answer JSON", {
      status: response.status,
    });
  }
  const envelope = decoded.data;
  if (response.status !== 200 || envelope.ok !== true) {
    throw failureFor(response, envelope);
  }
  return { response, envelope };
}

/**
 * Fetch `request.url` from the proxy's network. Resolves to a `Response` that
 * carries the upstream's status, the forwarded headers (content-type,
 * cache-control, location, retry-after) and body, so callers read it like a
 * direct fetch. A 4xx or 5xx FROM THE UPSTREAM resolves normally; only a
 * failure of the proxy itself throws `EgressError`.
 */
export async function egressFetch(
  env: EgressEnv,
  request: EgressRequest,
  options?: EgressCallOptions,
): Promise<Response> {
  const { envelope } = await callEgress(
    env,
    "/fetch",
    {
      url: request.url,
      method: request.method ?? "GET",
      headers: pickForwardedHeaders(request.headers),
    },
    options,
  );

  const status = envelope.status;
  if (
    status === undefined ||
    !Number.isInteger(status) ||
    status < 200 ||
    status > 599 ||
    envelope.body === undefined ||
    (envelope.encoding !== "utf8" && envelope.encoding !== "base64")
  ) {
    throw new EgressError("transient", "The egress proxy sent a bad envelope");
  }

  let payload: BodyInit | null;
  try {
    payload = isNullBodyStatus(status)
      ? null
      : envelope.encoding === "base64"
        ? decodeBase64(envelope.body)
        : envelope.body;
  } catch {
    throw new EgressError("transient", "The egress proxy sent a bad body");
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(envelope.headers ?? {})) {
    try {
      headers.set(name, value);
    } catch {
      // A header name or value `Headers` rejects is not worth failing for.
    }
  }
  // The body is already decoded, so the upstream's framing headers lie.
  headers.delete("content-encoding");
  headers.delete("content-length");

  const response = new Response(payload, { status, headers });
  try {
    Object.defineProperty(response, "url", {
      value: envelope.url ?? request.url,
    });
  } catch {
    // `url` stays empty on runtimes that freeze it.
  }
  return response;
}

export interface EgressResolveResult {
  url: string;
  status: number;
  hops: number;
}

/**
 * Follow a short link on the proxy (<= 5 redirects, all inside the
 * allowlist) and return where it ended. Throws `EgressError`; a redirect that
 * leaves the allowlist is kind `refused` with its `location`.
 */
export async function egressResolve(
  env: EgressEnv,
  request: { url: string; headers?: Record<string, string> },
  options?: EgressCallOptions,
): Promise<EgressResolveResult> {
  const { envelope } = await callEgress(
    env,
    "/resolve",
    { url: request.url, headers: pickForwardedHeaders(request.headers) },
    options,
  );
  if (!envelope.url) {
    throw new EgressError("transient", "The egress proxy sent a bad envelope");
  }
  return {
    url: envelope.url,
    status: envelope.status ?? 200,
    hops: envelope.hops ?? 0,
  };
}

// ── Guarded calls ───────────────────────────────────────────────────────────

/**
 * What a proxy failure means for the circuits. `backoff` and `hard` pause the
 * whole proxy (they say nothing about one provider); `transient` is a soft
 * failure on the provider's own `@egress` circuit.
 */
function classifyEgressError(error: unknown): GuardErrorOutcome {
  if (!(error instanceof EgressError)) return "failure";

  switch (error.kind) {
    case "backoff":
      upstreamGuard.trip(EGRESS_PROXY_CIRCUIT, error.retryAfterSeconds);
      return "ignore";
    case "hard":
      // One structured line; the open circuit stops anything repeating it.
      log.error("The egress proxy refused a request", {
        status: error.status,
        code: error.code,
        message: error.message,
      });
      upstreamGuard.trip(EGRESS_PROXY_CIRCUIT, HARD_FAILURE_BACKOFF_SECONDS);
      return "ignore";
    case "refused":
      return "ignore";
    case "transient":
      return "failure";
  }
}

/**
 * `egressFetch` behind two circuits: the proxy's own (paused by 429/503 and
 * by rejected requests) and `provider`'s `@egress` one (opened by the
 * upstream's 429s, `tripOn` statuses and repeated transient failures). The
 * direct path's circuit for the same provider is a different key, so a blocked
 * direct path never stops the proxy path.
 */
export async function guardedEgressFetch(
  env: EgressEnv,
  provider: string,
  request: EgressRequest,
  options?: EgressCallOptions & { tripOn?: ReadonlyArray<number> },
): Promise<Response> {
  upstreamGuard.assertClosed(EGRESS_PROXY_CIRCUIT);
  return upstreamGuard.run(
    egressProviderName(provider),
    () => egressFetch(env, request, options),
    { tripOn: options?.tripOn, classifyError: classifyEgressError },
  );
}

/** `egressResolve` behind the same two circuits. */
export async function guardedEgressResolve(
  env: EgressEnv,
  provider: string,
  request: { url: string; headers?: Record<string, string> },
  options?: EgressCallOptions,
): Promise<EgressResolveResult> {
  const name = egressProviderName(provider);
  upstreamGuard.assertClosed(EGRESS_PROXY_CIRCUIT);
  upstreamGuard.assertClosed(name);
  try {
    const result = await egressResolve(env, request, options);
    upstreamGuard.recordSuccess(name);
    return result;
  } catch (error) {
    const outcome = classifyEgressError(error);
    if (outcome === "failure") upstreamGuard.recordFailure(name);
    throw error;
  }
}
