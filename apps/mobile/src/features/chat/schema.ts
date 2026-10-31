import { Schema } from "effect";

// Only what the read-only chat shows; the server sends more and we ignore it.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

const AuthorSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
});

const AttachmentSchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  content_type: OptionalText,
});
export type Attachment = typeof AttachmentSchema.Type;

/** Link previews: the placeholder row prints the title or the URL's host. */
const EmbedSchema = Schema.Struct({
  url: Schema.optional(Schema.String),
  rawTitle: Schema.optional(Schema.String),
});
export type Embed = typeof EmbedSchema.Type;

export const MessageSchema = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  author_id: Schema.String,
  author: Schema.optional(AuthorSchema),
  content: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  attachments: Schema.optional(Schema.Array(AttachmentSchema)),
  embeds: Schema.optional(Schema.Array(EmbedSchema)),
});
export type Message = typeof MessageSchema.Type;

export const MessagePageSchema = Schema.Struct({
  messages: Schema.Array(MessageSchema),
  hasMoreBefore: Schema.optional(Schema.Boolean),
});

/** MESSAGE_UPDATE: the fields an edit changes. */
export const MessageEditSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.optional(Schema.NullOr(Schema.String)),
  embeds: Schema.optional(Schema.Array(EmbedSchema)),
});

/** MESSAGE_DELETE */
export const MessageRefSchema = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.optional(Schema.String),
});
