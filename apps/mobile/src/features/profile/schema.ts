import { Schema } from "effect";

// GET /api/users/:id/profile (src/routes/api/users/$id/profile.ts):
// services/user.service.ts getMe plus getUserProfileMutuals, the parts the
// profile sheet shows.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

export const ProfileUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
  /** Crop and collectibles (src/lib/avatar-display.ts); read loosely. */
  avatar_display: Schema.optional(Schema.Unknown),
  banner_url: OptionalText,
  banner_content_type: OptionalText,
  profile_accent_color: OptionalText,
  profile_background_color: OptionalText,
  profile_banner_color: OptionalText,
  display_name_style: Schema.optional(Schema.Unknown),
  created_at: OptionalText,
  bio: OptionalText,
  pronouns: OptionalText,
  status: OptionalText,
  custom_status: OptionalText,
});
export type ProfileUser = typeof ProfileUserSchema.Type;

const MutualServerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon_url: OptionalText,
});
export type MutualServer = typeof MutualServerSchema.Type;

const MutualFriendSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
});
export type MutualFriend = typeof MutualFriendSchema.Type;

const mutuals = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ count: Schema.Number, items: Schema.Array(item) });

export const ProfileSchema = Schema.Struct({
  user: ProfileUserSchema,
  mutualServers: mutuals(MutualServerSchema),
  mutualFriends: mutuals(MutualFriendSchema),
});
export type Profile = typeof ProfileSchema.Type;

// ── Collectibles inside avatar_display (src/lib/avatar-display.ts) ──────────

const EffectLayerSchema = Schema.Struct({
  src: Schema.String,
  loop: Schema.optional(Schema.Boolean),
  /** How long the layer plays, ms. */
  duration: Schema.optional(Schema.Number),
  /** When it starts after the open, ms. */
  start: Schema.optional(Schema.Number),
  zIndex: Schema.optional(Schema.Number),
});
export type EffectLayer = typeof EffectLayerSchema.Type;

export const CollectiblesSchema = Schema.Struct({
  avatarDecoration: Schema.optional(
    Schema.Struct({
      imageUrl: Schema.String,
      name: Schema.optional(Schema.String),
    }),
  ),
  profileEffect: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      staticFrameSrc: Schema.optional(Schema.String),
      reducedMotionSrc: Schema.optional(Schema.String),
      effectUrls: Schema.optional(Schema.Array(Schema.String)),
      effects: Schema.optional(Schema.Array(EffectLayerSchema)),
    }),
  ),
});
export type Collectibles = typeof CollectiblesSchema.Type;

export const AvatarDisplaySchema = Schema.Struct({
  collectibles: Schema.optional(CollectiblesSchema),
});

// ── Display-name style (src/lib/profile-customization.ts) ───────────────────

export const DISPLAY_NAME_EFFECTS = [
  "solid",
  "gradient",
  "neon",
  "toon",
  "pop",
] as const;

export const DisplayNameStyleSchema = Schema.Struct({
  font: Schema.String,
  effect: Schema.Literals(DISPLAY_NAME_EFFECTS),
  primaryColor: Schema.String,
  secondaryColor: Schema.String,
});
export type DisplayNameStyle = typeof DisplayNameStyleSchema.Type;
