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

// Only what the app shows; the server sends more and we ignore it.
const MeSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
});
export type Me = typeof MeSchema.Type;

const decodeMe = Schema.decodeUnknownSync(MeSchema);

/** GET /api/users/me: the profile of the token's owner. */
export async function getMe(): Promise<Me> {
  const response = await apiFetch("/api/users/me");
  if (!response.ok) throw new Error(`users/me failed: ${response.status}`);
  return decodeMe(await response.json());
}
