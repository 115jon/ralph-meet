import { Option, Schema } from "effect";

import { useSession } from "@/features/auth/session";
import { ApiError, apiFetch, apiJson, getMe } from "@/lib/api";

// The account endpoints the You tab uses, the same ones the web's settings
// call (src/components/chat/settings/AccountPanel.tsx, SessionsPanel.tsx).

/** Kova sends dates as ISO strings or epoch milliseconds. */
const Timestamp = Schema.NullOr(Schema.Union([Schema.String, Schema.Number]));

const SessionSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  lastActiveAt: Schema.optional(Timestamp),
  createdAt: Schema.optional(Timestamp),
  isCurrent: Schema.Boolean,
});
export type AccountSession = typeof SessionSchema.Type;

const SessionsSchema = Schema.Struct({ sessions: Schema.Array(SessionSchema) });

/**
 * GET /api/sessions (src/routes/api/sessions.ts). Ralph Auth app sessions
 * are per app, so the server reports only the token's own session, and its
 * DELETE answers 501: there are no other sessions to list or sign out here.
 */
export async function fetchSessions(): Promise<readonly AccountSession[]> {
  return (await apiJson("/api/sessions", SessionsSchema)).sessions;
}

export function sessionDate(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const ErrorBody = Schema.Struct({ error: Schema.String });
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

/** The server refused a profile change; `message` is its reason. */
export class ProfileRejected extends Error {
  override readonly name = "ProfileRejected";
}

/** The web's DisplayNameSchema (src/lib/validations.ts): trimmed, at most 80. */
export const DISPLAY_NAME_MAX = 80;

/**
 * PATCH /api/update-profile with { displayName } (src/routes/api/
 * update-profile.ts), then reloads /api/users/me so every screen sees the
 * new name. An empty name clears it (the username shows instead). Throws
 * ProfileRejected with the server's message when it refuses the name.
 */
export async function updateDisplayName(displayName: string): Promise<void> {
  const path = "/api/update-profile";
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: displayName.trim() }),
  });
  if (!response.ok) {
    const body = Option.getOrUndefined(
      decodeErrorBody(await response.json().catch(() => null)),
    );
    if (body) throw new ProfileRejected(body.error);
    throw new ApiError(response.status, path);
  }
  useSession.getState().setUser(await getMe());
}
