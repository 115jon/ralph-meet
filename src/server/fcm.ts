// ── FCM HTTP v1 from the Worker ─────────────────────────────────────────────
// A service-account JWT (RS256 through WebCrypto) is exchanged at Google's
// OAuth endpoint for an access token, kept in memory until five minutes
// before it expires, and used to POST one message per device token.
//
// Credentials come from the `FCM_SERVICE_ACCOUNT` secret (the service-account
// JSON as a string). Never log tokens, keys or message bodies from here.

import { Schema } from "effect";

import { safeParse, safeParseJson } from "@/lib/schema";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const JWT_LIFETIME_SECONDS = 3600;
/** Refresh the access token this long before Google says it expires. */
const ACCESS_TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;

const ServiceAccountSchema = Schema.Struct({
  project_id: Schema.String,
  client_email: Schema.String,
  private_key: Schema.String,
});
export type ServiceAccount = typeof ServiceAccountSchema.Type;

/** The service account in `json`, or null when it is not one. */
export function parseServiceAccount(json: string): ServiceAccount | null {
  const parsed = safeParseJson(ServiceAccountSchema, json);
  return parsed.success ? parsed.data : null;
}

// ── JWT ─────────────────────────────────────────────────────────────────────

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/** The DER bytes of a PEM `PRIVATE KEY` (PKCS #8) block. */
function pkcs8FromPem(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The signed assertion Google's token endpoint trades for an access token
 * (RFC 7523): RS256 over `iss`/`scope`/`aud`/`iat`/`exp`, valid one hour.
 */
export async function buildServiceAccountJwt(
  account: Pick<ServiceAccount, "client_email" | "private_key">,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
  };
  const signingInput = `${base64UrlFromJson(header)}.${base64UrlFromJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

// ── Messages ────────────────────────────────────────────────────────────────

/** A message for one device: what `messages:send` takes, minus the token. */
export interface FcmMessage {
  /** Absent on data-only messages the app renders (or acts on) itself. */
  readonly notification?: { readonly title: string; readonly body: string };
  /** FCM data values must be strings. */
  readonly data: Readonly<Record<string, string>>;
  readonly android: {
    readonly priority: "HIGH" | "NORMAL";
    /** How long FCM holds the message for an offline device, e.g. "3600s". */
    readonly ttl?: string;
    readonly notification?: {
      readonly channel_id: string;
      readonly tag: string;
    };
  };
}

export type FcmSendResult =
  | { readonly ok: true }
  /** `staleToken`: FCM says the token is dead; drop it. */
  | {
      readonly ok: false;
      readonly status: number;
      readonly staleToken: boolean;
    };

const FcmErrorSchema = Schema.Struct({
  error: Schema.Struct({
    status: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    details: Schema.optional(
      Schema.Array(
        Schema.Struct({ errorCode: Schema.optional(Schema.String) }),
      ),
    ),
  }),
});

/**
 * Whether an FCM error answer means the token itself is no good:
 * `UNREGISTERED` (app uninstalled, token rotated), `SENDER_ID_MISMATCH`
 * (another project's token), or `INVALID_ARGUMENT` about the registration
 * token. An `INVALID_ARGUMENT` about the payload is our bug, not the token's.
 */
export function isStaleTokenError(body: unknown): boolean {
  const parsed = safeParse(FcmErrorSchema, body);
  if (!parsed.success) return false;
  const { error } = parsed.data;
  const codes = new Set(
    (error.details ?? []).flatMap((detail) =>
      detail.errorCode ? [detail.errorCode] : [],
    ),
  );
  if (error.status) codes.add(error.status);
  if (codes.has("UNREGISTERED") || codes.has("SENDER_ID_MISMATCH")) return true;
  return (
    codes.has("INVALID_ARGUMENT") &&
    /registration token/i.test(error.message ?? "")
  );
}

// ── Sender ──────────────────────────────────────────────────────────────────

const AccessTokenSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
});

export interface FcmSender {
  send(token: string, message: FcmMessage): Promise<FcmSendResult>;
}

export interface FcmSenderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** A sender for one service account; it keeps its own access token. */
export function createFcmSender(
  account: ServiceAccount,
  options: FcmSenderOptions = {},
): FcmSender {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  let cached: { token: string; refreshAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function fetchAccessToken(): Promise<string> {
    const assertion = await buildServiceAccountJwt(
      account,
      Math.floor(now() / 1000),
    );
    const response = await doFetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) {
      throw new Error(`FCM OAuth token exchange failed: ${response.status}`);
    }
    const parsed = safeParse(AccessTokenSchema, await response.json());
    if (!parsed.success) throw new Error("FCM OAuth answer was malformed");
    cached = {
      token: parsed.data.access_token,
      refreshAt:
        now() + parsed.data.expires_in * 1000 - ACCESS_TOKEN_EARLY_REFRESH_MS,
    };
    return cached.token;
  }

  function accessToken(): Promise<string> {
    if (cached && now() < cached.refreshAt) {
      return Promise.resolve(cached.token);
    }
    // One exchange at a time; concurrent sends share it.
    pending ??= fetchAccessToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    async send(token, message) {
      const bearer = await accessToken();
      const response = await doFetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: { token, ...message } }),
        },
      );
      if (response.ok) return { ok: true };
      // A token revoked mid-hour: forget it so the next send exchanges anew.
      if (response.status === 401) cached = null;
      const body: unknown = await response.json().catch(() => null);
      return {
        ok: false,
        status: response.status,
        staleToken: isStaleTokenError(body),
      };
    },
  };
}

// One sender per isolate, rebuilt only when the secret changes.
let isolateSender: { secret: string; sender: FcmSender | null } | null = null;
let warnedMissing = false;

/**
 * The isolate's sender for the `FCM_SERVICE_ACCOUNT` secret, or null when it
 * is unset or malformed (logged once per isolate, without its contents).
 */
export function fcmSenderFor(secret: string | undefined): FcmSender | null {
  if (!secret) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.info("push.disabled: FCM_SERVICE_ACCOUNT is not set");
    }
    return null;
  }
  if (isolateSender?.secret !== secret) {
    const account = parseServiceAccount(secret);
    if (!account)
      console.error("push.disabled: FCM_SERVICE_ACCOUNT is malformed");
    isolateSender = {
      secret,
      sender: account ? createFcmSender(account) : null,
    };
  }
  return isolateSender.sender;
}
