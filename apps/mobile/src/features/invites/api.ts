import { Schema } from "effect";

import { apiJson } from "@/lib/api";

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** GET /api/invites/:code (src/services/social.service.ts getInviteInfo). */
const InvitePreviewSchema = Schema.Struct({
  code: Schema.String,
  server: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    icon_url: OptionalText,
    member_count: Schema.optional(Schema.Number),
  }),
  inviter: Schema.optional(
    Schema.Struct({
      username: Schema.String,
      display_name: OptionalText,
      avatar_url: OptionalText,
    }),
  ),
});
export type InvitePreview = typeof InvitePreviewSchema.Type;

const JoinSchema = Schema.Struct({
  joined: Schema.optional(Schema.Boolean),
  already_member: Schema.optional(Schema.Boolean),
});

const CreatedInviteSchema = Schema.Struct({
  code: Schema.String,
  expires_at: OptionalText,
});

/** A new invite lasts a week, with no use limit. */
const INVITE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const JSON_HEADERS = { "Content-Type": "application/json" };

function invitePath(code: string, rest = ""): string {
  return `/api/invites/${encodeURIComponent(code)}${rest}`;
}

/** The server an invite leads to. Throws ApiError 404/410 when it is dead. */
export function fetchInvite(code: string) {
  return apiJson(invitePath(code), InvitePreviewSchema);
}

/** POST /api/invites/:code/join. */
export function joinInvite(code: string) {
  return apiJson(invitePath(code, "/join"), JoinSchema, { method: "POST" });
}

/** POST /api/servers/:id/invites: a week-long link to share. */
export function createInvite(serverId: string) {
  return apiJson(
    `/api/servers/${encodeURIComponent(serverId)}/invites`,
    CreatedInviteSchema,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ max_age: INVITE_MAX_AGE_SECONDS }),
    },
  );
}
