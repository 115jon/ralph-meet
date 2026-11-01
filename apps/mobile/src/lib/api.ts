import { Schema } from "effect";

import { useSession } from "@/features/auth/session";

import { config } from "./config";

/**
 * Fetches `path` on the Ralph API with the session's Bearer token. The server
 * authenticates `Authorization: Bearer` itself (src/server/kova-auth.ts) and
 * attaches its own publishable key when it asks Kova, so none is sent here.
 * A 401 may mean the token is dead; `confirmSignedOut` asks again before the
 * session is dropped and the route guard takes over.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { token } = useSession.getState();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401 && token) {
    if (__DEV__) console.info(`[auth] 401 from ${path}`);
    await confirmSignedOut(token);
  }
  return response;
}

// Kova once answered "no session" for a token it had accepted 38 seconds
// earlier, and one 401 on a background POST signed the user out. Signing out
// throws the session away for good, so one refusal is not enough: the token's
// own profile must be refused twice, a moment apart.
const CONFIRM_RETRY_MS = 1500;
let confirming: { token: string; done: Promise<void> } | null = null;

/** Signs out only if `token` is still current and /api/users/me refuses it twice. */
function confirmSignedOut(token: string): Promise<void> {
  // Many requests fail together when a token dies; ask once for all of them.
  if (confirming?.token === token) return confirming.done;
  const done = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(CONFIRM_RETRY_MS);
      if (useSession.getState().token !== token) return;
      if (!(await meRefuses(token))) return;
    }
    const session = useSession.getState();
    if (session.token === token) await session.signOut();
  })().finally(() => {
    if (confirming?.token === token) confirming = null;
  });
  confirming = { token, done };
  return done;
}

/** True only on a definite 401; offline or a 5xx says nothing about the session. */
async function meRefuses(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.status === 401;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A non-2xx answer. `status` 401 is what RealtimeSocket reads as a refusal. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`${path} failed: ${status}`);
    this.name = "ApiError";
  }
}

/**
 * Fetches `path` and decodes the JSON body with `schema`, so screens only
 * ever see data that matched it. Throws ApiError on a non-2xx answer and a
 * SchemaError when the body does not match.
 */
export async function apiJson<S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<S["Type"]> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw new ApiError(response.status, path);
  return Schema.decodeUnknownSync(schema)(await response.json());
}

/** An API-relative media path (avatars, icons) as an absolute URL. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("/") ? `${config.apiBaseUrl}${path}` : path;
}

/**
 * An image source for `url`: the API's own media (attachments sit behind
 * auth) gets the session's Bearer token, anything else goes bare.
 */
export interface MediaSource {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export function mediaSource(url: string): MediaSource {
  const uri = mediaUrl(url) ?? url;
  const { token } = useSession.getState();
  if (!token || !uri.startsWith(`${config.apiBaseUrl}/`)) return { uri };
  return { uri, headers: { Authorization: `Bearer ${token}` } };
}

// Only what the app shows; the server sends more and we ignore it.
const MeSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
  // Optional so an older server never fails the whole profile.
  banner_url: Schema.optional(Schema.NullOr(Schema.String)),
  banner_content_type: Schema.optional(Schema.NullOr(Schema.String)),
  /** "online", "idle", "dnd" or "offline" (shown as Invisible). */
  status: Schema.optional(Schema.String),
  custom_status: Schema.optional(Schema.NullOr(Schema.String)),
});
export type Me = typeof MeSchema.Type;

/** GET /api/users/me: the profile of the token's owner. */
export function getMe(): Promise<Me> {
  return apiJson("/api/users/me", MeSchema);
}
