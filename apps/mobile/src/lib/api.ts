import { Schema } from "effect";

import { useSession } from "@/features/auth/session";

import { config } from "./config";

/**
 * Fetches `path` on the Ralph API with the session's Bearer token. The server
 * authenticates `Authorization: Bearer` itself (src/server/kova-auth.ts) and
 * attaches its own publishable key when it asks Kova, so none is sent here.
 * A 401 means the token is dead: sign out and let the route guard take over,
 * unless a newer session replaced it while the request was in flight.
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
  const session = useSession.getState();
  if (response.status === 401 && token && session.token === token) {
    await session.signOut();
  }
  return response;
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

// Only what the app shows; the server sends more and we ignore it.
const MeSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
});
export type Me = typeof MeSchema.Type;

/** GET /api/users/me: the profile of the token's owner. */
export function getMe(): Promise<Me> {
  return apiJson("/api/users/me", MeSchema);
}
