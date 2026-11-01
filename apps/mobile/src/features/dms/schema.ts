import { Schema } from "effect";

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** The other side of a DM (src/services/social.service.ts listDMs). */
const RecipientSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
  status: OptionalText,
  custom_status: OptionalText,
});
export type Recipient = typeof RecipientSchema.Type;

export const DmChannelSchema = Schema.Struct({
  id: Schema.String,
  created_at: Schema.String,
  recipient: RecipientSchema,
});
export type DmChannel = typeof DmChannelSchema.Type;

/** PRESENCE_UPDATE, the part the DM list shows. */
export const PresenceEventSchema = Schema.Struct({
  user_id: Schema.String,
  status: Schema.String,
});
