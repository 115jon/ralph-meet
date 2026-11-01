import { Schema } from "effect";

// /api/friends (src/routes/api/friends.ts, services/social.service.ts
// listRelationships) and the RELATIONSHIP_* events, the parts the app shows.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

export const FriendUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
  status: OptionalText,
  custom_status: OptionalText,
});
export type FriendUser = typeof FriendUserSchema.Type;

/** The relationship row's `type`, from the signed-in user's side. */
export const RELATIONSHIP = {
  friend: 0,
  blocked: 1,
  /** They asked you. */
  incoming: 2,
  /** You asked them. */
  outgoing: 3,
} as const;

export const RelationshipSchema = Schema.Struct({
  user: FriendUserSchema,
  type: Schema.Number,
  created_at: Schema.optional(Schema.Unknown),
});
export type Relationship = typeof RelationshipSchema.Type;

export const RelationshipListSchema = Schema.Array(RelationshipSchema);

/** POST /api/friends: the new row (3 sent, 0 when it accepted theirs). */
export const FriendRequestResultSchema = Schema.Struct({
  user: FriendUserSchema,
  type: Schema.Number,
});

export const RelationshipRemoveEvent = Schema.Struct({
  user_id: Schema.String,
});
