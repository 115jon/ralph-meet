import { Schema } from "effect";

import { apiJson } from "@/lib/api";

import type { UserStatus } from "./status";

const PresenceSchema = Schema.Struct({
  status: Schema.String,
  custom_status: Schema.optional(Schema.NullOr(Schema.String)),
});
export type Presence = typeof PresenceSchema.Type;

/**
 * POST /api/presence (src/routes/api/presence.ts): saves both fields and
 * broadcasts PRESENCE_UPDATE to every server the user is in. An omitted
 * custom_status is saved as null, so both are always sent.
 */
export function postPresence(
  status: UserStatus,
  customStatus: string | null,
): Promise<Presence> {
  return apiJson("/api/presence", PresenceSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, custom_status: customStatus }),
  });
}
