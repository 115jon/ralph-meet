import { Schema } from "effect";

// Only what the chat shows; the server sends more and we ignore it. Shapes
// follow src/services/message.service.ts (formatMessageRow, createMessage).

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNumber = Schema.optional(Schema.Number);

export const AuthorSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  display_name: OptionalText,
  avatar_url: OptionalText,
});
export type Author = typeof AuthorSchema.Type;

const AttachmentSchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  content_type: OptionalText,
  /** API-relative (`/api/attachments/...`) or an absolute external URL. */
  url: Schema.optional(Schema.String),
  /** A GIF sent as a video (the picker's mp4s): loops silently. */
  isGif: Schema.optional(Schema.Boolean),
  thumbnailUrl: OptionalText,
});
export type Attachment = typeof AttachmentSchema.Type;

const EmbedImageSchema = Schema.Struct({
  url: Schema.String,
  width: OptionalNumber,
  height: OptionalNumber,
});

const EmbedMediaSchema = Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  width: OptionalNumber,
  height: OptionalNumber,
  thumbnailUrl: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
  isGif: Schema.optional(Schema.Boolean),
  durationSeconds: OptionalNumber,
});

const EmbedVideoSchema = Schema.Struct({
  url: Schema.String,
  width: OptionalNumber,
  height: OptionalNumber,
  /** "direct": a playable file. "player": an iframe page, opened instead. */
  kind: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
  durationSeconds: OptionalNumber,
});

const EmbedNameSchema = Schema.Struct({ name: Schema.optional(Schema.String) });

/** Link previews (src/lib/types.ts EmbedInfo), the parts the app draws. */
const EmbedSchema = Schema.Struct({
  url: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  /** The link is the media itself: draw it bare. */
  direct: Schema.optional(Schema.Boolean),
  rawTitle: Schema.optional(Schema.String),
  rawDescription: Schema.optional(Schema.String),
  provider: Schema.optional(EmbedNameSchema),
  author: Schema.optional(EmbedNameSchema),
  /** "thumbnail": a small picture beside the text; else large under it. */
  imageLayout: Schema.optional(Schema.String),
  thumbnail: Schema.optional(EmbedImageSchema),
  media: Schema.optional(Schema.Array(EmbedMediaSchema)),
  video: Schema.optional(EmbedVideoSchema),
});
export type Embed = typeof EmbedSchema.Type;

const ReactionSchema = Schema.Struct({
  emoji: Schema.String,
  count: Schema.Number,
  me: Schema.Boolean,
  users: Schema.optional(Schema.Array(Schema.String)),
});
export type Reaction = typeof ReactionSchema.Type;

const ReplyPreviewSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.NullOr(Schema.String),
  author_id: Schema.String,
  author: Schema.optional(AuthorSchema),
  attachment_count: OptionalNumber,
});
export type ReplyPreview = typeof ReplyPreviewSchema.Type;

export const MessageSchema = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  author_id: Schema.String,
  author: Schema.optional(AuthorSchema),
  content: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: OptionalText,
  reply_to_id: OptionalText,
  reply_to: Schema.optional(Schema.NullOr(ReplyPreviewSchema)),
  attachments: Schema.optional(Schema.Array(AttachmentSchema)),
  embeds: Schema.optional(Schema.Array(EmbedSchema)),
  reactions: Schema.optional(Schema.Array(ReactionSchema)),
  /** Echoed back on the sender's own MESSAGE_CREATE and POST answer. */
  nonce: Schema.optional(Schema.String),
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
  updated_at: OptionalText,
  embeds: Schema.optional(Schema.Array(EmbedSchema)),
});

/** MESSAGE_DELETE */
export const MessageRefSchema = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.optional(Schema.String),
});

/** REACTION_ADD and REACTION_REMOVE */
export const ReactionEventSchema = Schema.Struct({
  message_id: Schema.String,
  channel_id: Schema.String,
  user_id: Schema.String,
  emoji: Schema.String,
});

/** TYPING_START */
export const TypingEventSchema = Schema.Struct({
  channel_id: Schema.String,
  user_id: Schema.String,
});

/** POST /api/channels/:id/messages/upload */
export const UploadSchema = Schema.Struct({
  id: Schema.String,
  file_url: Schema.String,
  file_name: Schema.String,
  content_type: Schema.String,
});
