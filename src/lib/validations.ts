import { Schema, SchemaTransformation } from "effect";
import { withDefault } from "@/lib/schema";

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsernameForStorage(
  value: string,
  fallback: string,
): string {
  const normalized = normalizeUsername(value)
    .replace(/[^a-z0-9_.-]/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 32);
  if (normalized.length >= 2) return normalized;

  const normalizedFallback = normalizeUsername(fallback)
    .replace(/[^a-z0-9_.-]/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 32);
  return normalizedFallback.length >= 2 ? normalizedFallback : "user_account";
}

/**
 * Trims after the checks piped before it, like
 * `.min(1).transform((v) => v.trim())`: "   " passes `min(1)` and decodes to "".
 */
const trimmed = SchemaTransformation.trim();

/** `z.string().uuid(message?)`. */
const uuid = (message?: string) =>
  Schema.String.check(Schema.isUUID(undefined, message ? { message } : {}));

// Username checks run on the normalized (trimmed, lowercased) value.
export const UsernameSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: normalizeUsername,
      encode: (value: string) => value,
    }),
  ),
).check(
  Schema.isMinLength(2, { message: "Username must be at least 2 characters" }),
  Schema.isMaxLength(32, { message: "Username must be at most 32 characters" }),
  Schema.isPattern(/^[a-z0-9][a-z0-9_.-]*$/, {
    message:
      "Username may only contain letters, numbers, dots, hyphens, and underscores",
  }),
);

export const DisplayNameSchema = Schema.Trim.check(
  Schema.isMaxLength(80, {
    message: "Display name must be at most 80 characters",
  }),
);

export const ProfileIdentityPatchSchema = Schema.Struct({
  displayName: Schema.optional(DisplayNameSchema),
  username: Schema.optional(UsernameSchema),
});

/** An empty string stands for "no category" and decodes to `null`. */
const CategoryIdSchema = Schema.Union([
  Schema.NullOr(uuid()),
  Schema.Literal(""),
]).pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.String),
    SchemaTransformation.transform({
      decode: (value) => (value === "" ? null : value),
      encode: (value) => value,
    }),
  ),
);

export const CreateChannelSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  channel_type: withDefault(Schema.Literals(["text", "voice", "dm"]), "text"),
  category_id: Schema.optional(CategoryIdSchema),
  description: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024))),
  ),
});

export const CreateCategorySchema = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ).pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transform({
        decode: (value: string) => value.trim().toUpperCase(),
        encode: (value: string) => value,
      }),
    ),
  ),
});

// ── API Route Input Schemas ────────────────────────────────────────────────

export const CreateServerSchema = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1, { message: "Name is required" }),
    Schema.isMaxLength(100, { message: "Name is too long" }),
  ).pipe(Schema.decodeTo(Schema.String, trimmed)),
  icon_url: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  ),
});

export const UpdateServerSchema = Schema.Struct({
  name: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)).pipe(
      Schema.decodeTo(Schema.String, trimmed),
    ),
  ),
  icon_url: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  ),
  invites_paused: Schema.optional(Schema.Boolean),
  allow_public_shares: Schema.optional(Schema.Boolean),
  show_source_in_shares: Schema.optional(Schema.Boolean),
  allow_share_indexing: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter(
    (d) =>
      !!d.name ||
      d.icon_url !== undefined ||
      d.invites_paused !== undefined ||
      d.allow_public_shares !== undefined ||
      d.show_source_in_shares !== undefined ||
      d.allow_share_indexing !== undefined,
    { message: "No changes provided" },
  ),
);

export const AddReactionSchema = Schema.Struct({
  message_id: uuid("Invalid message ID"),
  emoji: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});

export const RemoveReactionSchema = Schema.Struct({
  ...AddReactionSchema.fields,
  target_user_id: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ),
});
