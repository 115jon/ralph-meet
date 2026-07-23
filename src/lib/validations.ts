import { z } from "zod";

export function normalizeUsername(value: string): string {
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

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Username must be at least 2 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(
    /^[a-z0-9][a-z0-9_.-]*$/,
    "Username may only contain letters, numbers, dots, hyphens, and underscores",
  )
  .transform(normalizeUsername);

export const DisplayNameSchema = z
  .string()
  .trim()
  .max(80, "Display name must be at most 80 characters");

export const ProfileIdentityPatchSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  username: UsernameSchema.optional(),
});

export type ProfileIdentityPatch = z.infer<typeof ProfileIdentityPatchSchema>;

export const ChannelNameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name is too long")
  .transform((val) => {
    // We'll pass the type during validation if needed,
    // but for shared schema we'll just trim.
    return val.trim();
  });

export const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  channel_type: z.enum(["text", "voice", "dm"]).default("text"),
  category_id: z
    .uuid()
    .nullable()
    .optional()
    .or(z.string().length(0))
    .transform((v) => (v === "" ? null : v)),
  description: z.string().max(1024).nullable().optional(),
});

export const CreateCategorySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.trim().toUpperCase()),
});

/**
 * Sanitizes a channel name based on its type.
 * Text channels: lowercase, collapse whitespace into hyphens, preserve visible Unicode.
 * Voice channels: trimmed, allowed spaces and special chars.
 */
export function sanitizeChannelName(
  name: string,
  type: "text" | "voice" | "dm",
  isFinal: boolean = false,
): string {
  if (type === "text") {
    let sanitized = name
      .toLowerCase()
      .replace(/\s+/gu, "-") // Discord-style spacing for text channels
      .split("")
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && (code < 0x7f || code > 0x9f);
      })
      .join("") // Strip control chars but keep visible Unicode
      .replace(/-+/g, "-"); // Collapse multiple hyphens

    if (isFinal) {
      sanitized = sanitized.replace(/^-+|-+$/g, ""); // Trim hyphens from ends if final
    }
    return sanitized;
  }
  return isFinal ? name.trim() : name;
}

// ── API Route Input Schemas ────────────────────────────────────────────────

export const CreateServerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name is too long")
    .transform((v) => v.trim()),
  icon_url: z.string().min(1).nullable().optional(),
});

export const SendMessageSchema = z.object({
  content: z.string().max(4000, "Message too long").default(""),
  reply_to_id: z.string().uuid().nullable().optional(),
  nonce: z.string().max(100).optional(),
  attachment_ids: z.array(z.string().uuid()).max(10).optional(),
});

export const EditMessageSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(4000, "Message too long")
    .transform((v) => v.trim()),
});

export const DeleteMessageSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
});

export const UpdateServerSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .transform((v) => v.trim())
      .optional(),
    icon_url: z.string().min(1).nullable().optional(),
    invites_paused: z.boolean().optional(),
    allow_public_shares: z.boolean().optional(),
    show_source_in_shares: z.boolean().optional(),
    allow_share_indexing: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.name ||
      d.icon_url !== undefined ||
      d.invites_paused !== undefined ||
      d.allow_public_shares !== undefined ||
      d.show_source_in_shares !== undefined ||
      d.allow_share_indexing !== undefined,
    { message: "No changes provided" },
  );

export const UpdateRoleSchema = z.object({
  role: z.number().int().min(0).max(2),
});

export const AddReactionSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  emoji: z.string().min(1).max(128),
});

export const RemoveReactionSchema = AddReactionSchema.extend({
  target_user_id: z.string().min(1).max(128).optional(),
});

export const PinMessageSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  pinned: z.boolean(),
});
