import { Schema } from "effect";

// GET /api/servers/:id/members (src/services/server.service.ts
// listServerMembers, plus fresh status from the route): only what the
// members page, mentions and the profile sheet show.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

export const RoleSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: OptionalText,
  permissions: Schema.optional(Schema.Number),
  position: Schema.Number,
  is_default: Schema.optional(Schema.Boolean),
});
export type Role = typeof RoleSchema.Type;

export const MemberUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
  /** The profile status they picked; who is connected comes from presence. */
  status: OptionalText,
  custom_status: OptionalText,
  /** A JSON string here, an object from the profile route: read loosely. */
  display_name_style: Schema.optional(Schema.Unknown),
  created_at: OptionalText,
});
export type MemberUser = typeof MemberUserSchema.Type;

export const ServerMemberSchema = Schema.Struct({
  user: MemberUserSchema,
  roles: Schema.optional(Schema.Array(RoleSchema)),
  joined_at: OptionalText,
});
export type ServerMember = typeof ServerMemberSchema.Type;

export const MemberListSchema = Schema.Array(ServerMemberSchema);

// ── Gateway events (src/stores/chat-gateway.ts) ─────────────────────────────

export const MemberAddEvent = Schema.Struct({
  server_id: Schema.String,
  user: MemberUserSchema,
  roles: Schema.optional(Schema.Array(RoleSchema)),
});

export const MemberRemoveEvent = Schema.Struct({
  server_id: Schema.String,
  user_id: Schema.String,
});

export const MemberUpdateEvent = Schema.Struct({
  server_id: Schema.String,
  user_id: Schema.String,
  roles: Schema.optional(Schema.Array(RoleSchema)),
});

/** USER_PROFILE_UPDATE: the fields a member row shows. */
export const ProfileUpdateEvent = Schema.Struct({
  user_id: Schema.String,
  username: Schema.optional(Schema.String),
  display_name: OptionalText,
  avatar_url: OptionalText,
  display_name_style: Schema.optional(Schema.Unknown),
});
export type ProfileUpdate = typeof ProfileUpdateEvent.Type;
