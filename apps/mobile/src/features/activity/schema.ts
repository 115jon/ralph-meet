import { Schema } from "effect";

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** One row of GET /api/notifications (src/services/notification.service.ts). */
export const NotificationSchema = Schema.Struct({
  id: Schema.String,
  /** "mention", "reply" or "dm". */
  type: Schema.String,
  channel_id: Schema.String,
  server_id: OptionalText,
  message_id: OptionalText,
  from_user: Schema.Struct({
    id: Schema.NullOr(Schema.String),
    username: Schema.String,
    display_name: OptionalText,
    avatar_url: OptionalText,
  }),
  content: OptionalText,
  is_read: Schema.Boolean,
  created_at: Schema.String,
  channel_name: OptionalText,
  server_name: OptionalText,
});
export type Notification = typeof NotificationSchema.Type;

export const NotificationListSchema = Schema.Struct({
  notifications: Schema.Array(NotificationSchema),
  unread_count: Schema.Number,
});

/** NOTIFICATIONS_READ */
export const ReadEventSchema = Schema.Struct({
  ids: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  all: Schema.optional(Schema.Boolean),
});

/** NOTIFICATIONS_CLEAR */
export const ClearEventSchema = Schema.Struct({
  cleared_at: Schema.optional(Schema.String),
});
