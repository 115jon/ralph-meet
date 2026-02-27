import { z } from "zod";

export const ChannelNameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name is too long")
  .transform((val, ctx) => {
    // We'll pass the type during validation if needed,
    // but for shared schema we'll just trim.
    return val.trim();
  });

export const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  channel_type: z.enum(["text", "voice", "dm"]).default("text"),
  category_id: z.uuid().nullable().optional().or(z.string().length(0)).transform(v => v === "" ? null : v),
  description: z.string().max(1024).nullable().optional(),
});

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100).transform(v => v.trim().toUpperCase()),
});

/**
 * Sanitizes a channel name based on its type.
 * Text channels: lowercase, no spaces (replaced with hyphens), no special chars.
 * Voice channels: trimmed, allowed spaces and special chars.
 */
export function sanitizeChannelName(name: string, type: "text" | "voice" | "dm", isFinal: boolean = false): string {
  if (type === "text") {
    let sanitized = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, "") // Remove special chars
      .replace(/\s+/g, "-")      // Replace spaces with hyphens
      .replace(/-+/g, "-");      // Collapse multiple hyphens

    if (isFinal) {
      sanitized = sanitized.replace(/^-+|-+$/g, ""); // Trim hyphens from ends if final
    }
    return sanitized;
  }
  return isFinal ? name.trim() : name;
}

// ── API Route Input Schemas ────────────────────────────────────────────────

export const CreateServerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long").transform(v => v.trim()),
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
  content: z.string().min(1, "Content is required").max(4000, "Message too long").transform(v => v.trim()),
});

export const DeleteMessageSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
});

export const UpdateServerSchema = z.object({
  name: z.string().min(1).max(100).transform(v => v.trim()).optional(),
  icon_url: z.string().min(1).nullable().optional(),
}).refine(d => d.name || d.icon_url !== undefined, { message: "No changes provided" });

export const UpdateRoleSchema = z.object({
  role: z.number().int().min(0).max(2),
});

export const AddReactionSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  emoji: z.string().min(1).max(32),
});

export const PinMessageSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  pinned: z.boolean(),
});

