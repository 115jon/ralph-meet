import { Schema } from "effect";

// Only what the app shows; the server sends more and we ignore it. Fields the
// server may omit or null are optional here, so a missing one never drops a
// whole list.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

export const ServerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon_url: OptionalText,
});
export type Server = typeof ServerSchema.Type;

export const CategorySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rank: Schema.Number,
});
export type Category = typeof CategorySchema.Type;

/** Any channel type decodes; the tree keeps only text and voice. */
export const ChannelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  channel_type: Schema.String,
  category_id: OptionalText,
  position: Schema.Number,
});
export type Channel = typeof ChannelSchema.Type;

export const ServerChannelsSchema = Schema.Struct({
  categories: Schema.Array(CategorySchema),
  channels: Schema.Array(ChannelSchema),
});

export const ReadStatesSchema = Schema.Struct({
  read_states: Schema.Array(
    Schema.Struct({ channel_id: Schema.String, last_read_at: Schema.String }),
  ),
  last_messages: Schema.Array(
    Schema.Struct({
      channel_id: Schema.String,
      last_message_at: Schema.NullOr(Schema.String),
    }),
  ),
});

/** A member of a voice channel, from the gateway's voice channel events. */
export const VoiceMemberSchema = Schema.Struct({
  user_id: Schema.String,
  name: Schema.optional(Schema.String),
  username: OptionalText,
  display_name: OptionalText,
  avatar_url: OptionalText,
  self_mute: Schema.optional(Schema.Boolean),
  self_deaf: Schema.optional(Schema.Boolean),
  self_video: Schema.optional(Schema.Boolean),
  self_stream: Schema.optional(Schema.Boolean),
  /** False while the room holds their session for a resume (a lost socket). */
  connected: Schema.optional(Schema.Boolean),
});
export type VoiceMember = typeof VoiceMemberSchema.Type;
