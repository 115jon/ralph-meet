import { describe, expect, it } from "vitest";
import type { Schema } from "effect";
import { safeParse } from "./schema";
import {
  AddReactionSchema,
  ChannelNameSchema,
  CreateCategorySchema,
  CreateChannelSchema,
  CreateServerSchema,
  DeleteMessageSchema,
  DisplayNameSchema,
  EditMessageSchema,
  PinMessageSchema,
  ProfileIdentityPatchSchema,
  RemoveReactionSchema,
  SendMessageSchema,
  UpdateRoleSchema,
  UpdateServerSchema,
  UsernameSchema,
} from "./validations";

function firstMessage(
  schema: Schema.ConstraintDecoder<unknown>,
  input: unknown,
): string | undefined {
  const result = safeParse(schema, input);
  return result.success ? undefined : result.issues[0]?.message;
}

describe("Validation Schemas", () => {
  // ── CreateServerSchema ───────────────────────────────────────────
  describe("CreateServerSchema", () => {
    it("accepts valid server name", () => {
      const result = safeParse(CreateServerSchema, { name: "My Server" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Server");
      }
    });

    it("trims whitespace on name", () => {
      const result = safeParse(CreateServerSchema, { name: "  My Server  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Server");
      }
    });

    it("rejects empty name", () => {
      const result = safeParse(CreateServerSchema, { name: "" });
      expect(result.success).toBe(false);
    });

    it("rejects name over 100 chars", () => {
      const result = safeParse(CreateServerSchema, { name: "x".repeat(101) });
      expect(result.success).toBe(false);
    });

    it("accepts optional icon_url", () => {
      const result = safeParse(CreateServerSchema, {
        name: "Server",
        icon_url: "https://example.com/icon.png",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty icon_url", () => {
      const result = safeParse(CreateServerSchema, {
        name: "Server",
        icon_url: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts relative icon_url path", () => {
      const result = safeParse(CreateServerSchema, {
        name: "Server",
        icon_url: "/api/server-icons/abc123.png",
      });
      expect(result.success).toBe(true);
    });
  });

  // ── UpdateServerSchema ────────────────────────────────────────────
  describe("UpdateServerSchema", () => {
    it("accepts boolean server flags alongside a name update", () => {
      const result = safeParse(UpdateServerSchema, {
        name: "Renamed",
        allow_public_shares: true,
        show_source_in_shares: false,
        allow_share_indexing: false,
      });

      expect(result.success).toBe(true);
    });

    it("rejects database integer flags at the API boundary", () => {
      const result = safeParse(UpdateServerSchema, {
        name: "Renamed",
        allow_public_shares: 1,
        show_source_in_shares: 0,
        allow_share_indexing: 0,
      });

      expect(result.success).toBe(false);
    });
  });

  // ── SendMessageSchema ────────────────────────────────────────────
  describe("SendMessageSchema", () => {
    it("accepts message with content", () => {
      const result = safeParse(SendMessageSchema, { content: "Hello" });
      expect(result.success).toBe(true);
    });

    it("defaults content to empty string", () => {
      const result = safeParse(SendMessageSchema, {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("");
      }
    });

    it("rejects content over 4000 chars", () => {
      const result = safeParse(SendMessageSchema, {
        content: "x".repeat(4001),
      });
      expect(result.success).toBe(false);
    });

    it("validates reply_to_id as UUID", () => {
      const result = safeParse(SendMessageSchema, {
        content: "reply",
        reply_to_id: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("limits attachment_ids to 10", () => {
      const ids = Array.from(
        { length: 11 },
        (_, i) =>
          `${i.toString().padStart(8, "0")}-0000-0000-0000-000000000000`,
      );
      const result = safeParse(SendMessageSchema, {
        content: "test",
        attachment_ids: ids,
      });
      expect(result.success).toBe(false);
    });
  });

  // ── EditMessageSchema ────────────────────────────────────────────
  describe("EditMessageSchema", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("accepts valid edit", () => {
      const result = safeParse(EditMessageSchema, {
        message_id: validId,
        content: "edited",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty content", () => {
      const result = safeParse(EditMessageSchema, {
        message_id: validId,
        content: "",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── DeleteMessageSchema ──────────────────────────────────────────
  describe("DeleteMessageSchema", () => {
    it("accepts valid UUID", () => {
      const result = safeParse(DeleteMessageSchema, {
        message_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID", () => {
      const result = safeParse(DeleteMessageSchema, { message_id: "abc" });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateRoleSchema ─────────────────────────────────────────────
  describe("UpdateRoleSchema", () => {
    it("accepts valid role 0-2", () => {
      expect(safeParse(UpdateRoleSchema, { role: 0 }).success).toBe(true);
      expect(safeParse(UpdateRoleSchema, { role: 1 }).success).toBe(true);
      expect(safeParse(UpdateRoleSchema, { role: 2 }).success).toBe(true);
    });

    it("rejects role > 2", () => {
      expect(safeParse(UpdateRoleSchema, { role: 3 }).success).toBe(false);
    });

    it("rejects non-integer role", () => {
      expect(safeParse(UpdateRoleSchema, { role: 1.5 }).success).toBe(false);
    });

    it("rejects negative role", () => {
      expect(safeParse(UpdateRoleSchema, { role: -1 }).success).toBe(false);
    });
  });

  // ── AddReactionSchema ────────────────────────────────────────────
  describe("AddReactionSchema", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("accepts valid reaction", () => {
      const result = safeParse(AddReactionSchema, {
        message_id: validId,
        emoji: "👍",
      });
      expect(result.success).toBe(true);
    });

    it("accepts custom emoji tokens", () => {
      const result = safeParse(AddReactionSchema, {
        message_id: validId,
        emoji: "<:party_blob:123e4567-e89b-12d3-a456-426614174000>",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty emoji", () => {
      const result = safeParse(AddReactionSchema, {
        message_id: validId,
        emoji: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects emoji over 128 chars", () => {
      const result = safeParse(AddReactionSchema, {
        message_id: validId,
        emoji: "x".repeat(129),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RemoveReactionSchema", () => {
    it("accepts an optional target user for message reaction management", () => {
      const result = safeParse(RemoveReactionSchema, {
        message_id: "550e8400-e29b-41d4-a716-446655440000",
        emoji: "✅",
        target_user_id: "user-42",
      });

      expect(result.success).toBe(true);
    });
  });

  // ── PinMessageSchema ─────────────────────────────────────────────
  describe("PinMessageSchema", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("accepts valid pin", () => {
      const result = safeParse(PinMessageSchema, {
        message_id: validId,
        pinned: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-boolean pinned", () => {
      const result = safeParse(PinMessageSchema, {
        message_id: validId,
        pinned: "yes",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── Messages and normalization the UI relies on ───────────────────
  describe("UsernameSchema", () => {
    it("trims and lowercases before checking", () => {
      expect(safeParse(UsernameSchema, "  Alice_42 ")).toEqual({
        success: true,
        data: "alice_42",
      });
      expect(safeParse(UsernameSchema, "  ab  ").success).toBe(true);
    });

    it("keeps the user-facing messages", () => {
      expect(firstMessage(UsernameSchema, "a")).toBe(
        "Username must be at least 2 characters",
      );
      expect(firstMessage(UsernameSchema, "  a  ")).toBe(
        "Username must be at least 2 characters",
      );
      expect(firstMessage(UsernameSchema, "a".repeat(33))).toBe(
        "Username must be at most 32 characters",
      );
      expect(firstMessage(UsernameSchema, "alice smith")).toBe(
        "Username may only contain letters, numbers, dots, hyphens, and underscores",
      );
    });

    it("reports the first failing check in declaration order", () => {
      // "!" is too short and has an invalid character: length wins.
      expect(firstMessage(UsernameSchema, "!")).toBe(
        "Username must be at least 2 characters",
      );
      // A leading separator is only a pattern failure.
      expect(firstMessage(UsernameSchema, "_ab")).toBe(
        "Username may only contain letters, numbers, dots, hyphens, and underscores",
      );
    });

    it("rejects non-strings", () => {
      expect(safeParse(UsernameSchema, 5).success).toBe(false);
      expect(safeParse(UsernameSchema, null).success).toBe(false);
      expect(safeParse(UsernameSchema, undefined).success).toBe(false);
    });
  });

  describe("DisplayNameSchema", () => {
    it("trims and allows an empty name", () => {
      expect(safeParse(DisplayNameSchema, "  Alice  ")).toEqual({
        success: true,
        data: "Alice",
      });
      expect(safeParse(DisplayNameSchema, "   ")).toEqual({
        success: true,
        data: "",
      });
    });

    it("limits the trimmed length to 80 with the existing message", () => {
      expect(safeParse(DisplayNameSchema, ` ${"x".repeat(80)} `).success).toBe(
        true,
      );
      expect(firstMessage(DisplayNameSchema, "x".repeat(81))).toBe(
        "Display name must be at most 80 characters",
      );
    });
  });

  describe("ProfileIdentityPatchSchema", () => {
    it("accepts an empty patch and explicitly undefined fields", () => {
      expect(safeParse(ProfileIdentityPatchSchema, {})).toEqual({
        success: true,
        data: {},
      });
      expect(
        safeParse(ProfileIdentityPatchSchema, {
          displayName: undefined,
          username: undefined,
        }).success,
      ).toBe(true);
    });

    it("rejects null fields and surfaces the field message", () => {
      expect(
        safeParse(ProfileIdentityPatchSchema, { displayName: null }).success,
      ).toBe(false);
      expect(firstMessage(ProfileIdentityPatchSchema, { username: "a" })).toBe(
        "Username must be at least 2 characters",
      );
    });

    it("drops keys it does not declare", () => {
      expect(
        safeParse(ProfileIdentityPatchSchema, { username: "ab", bio: "x" }),
      ).toEqual({ success: true, data: { username: "ab" } });
    });
  });

  describe("ChannelNameSchema", () => {
    it("keeps the messages and trims after the length checks", () => {
      expect(firstMessage(ChannelNameSchema, "")).toBe("Name is required");
      expect(firstMessage(ChannelNameSchema, "x".repeat(101))).toBe(
        "Name is too long",
      );
      expect(safeParse(ChannelNameSchema, "  general  ")).toEqual({
        success: true,
        data: "general",
      });
      expect(safeParse(ChannelNameSchema, "   ")).toEqual({
        success: true,
        data: "",
      });
    });
  });

  describe("CreateChannelSchema", () => {
    it("defaults channel_type to text", () => {
      expect(safeParse(CreateChannelSchema, { name: "general" })).toEqual({
        success: true,
        data: { name: "general", channel_type: "text" },
      });
    });

    it("accepts every channel type and rejects others", () => {
      for (const channel_type of ["text", "voice", "dm"]) {
        expect(
          safeParse(CreateChannelSchema, { name: "a", channel_type }).success,
        ).toBe(true);
      }
      expect(
        safeParse(CreateChannelSchema, { name: "a", channel_type: "video" })
          .success,
      ).toBe(false);
    });

    it("turns an empty category_id into null", () => {
      const result = safeParse(CreateChannelSchema, {
        name: "a",
        category_id: "",
      });

      expect(result).toMatchObject({
        success: true,
        data: { category_id: null },
      });
    });

    it("accepts null, a UUID, or no category_id and rejects other strings", () => {
      const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

      expect(
        safeParse(CreateChannelSchema, { name: "a", category_id: null }),
      ).toMatchObject({ success: true, data: { category_id: null } });
      expect(
        safeParse(CreateChannelSchema, { name: "a", category_id: uuid }),
      ).toMatchObject({ success: true, data: { category_id: uuid } });
      expect(
        safeParse(CreateChannelSchema, { name: "a", category_id: undefined })
          .success,
      ).toBe(true);
      expect(
        safeParse(CreateChannelSchema, { name: "a", category_id: "nope" })
          .success,
      ).toBe(false);
      expect(
        safeParse(CreateChannelSchema, { name: "a", category_id: " " }).success,
      ).toBe(false);
    });

    it("limits name to 1..100 and description to 1024, allowing null", () => {
      expect(safeParse(CreateChannelSchema, { name: "" }).success).toBe(false);
      expect(
        safeParse(CreateChannelSchema, { name: "x".repeat(101) }).success,
      ).toBe(false);
      expect(
        safeParse(CreateChannelSchema, { name: "a", description: null })
          .success,
      ).toBe(true);
      expect(
        safeParse(CreateChannelSchema, {
          name: "a",
          description: "x".repeat(1024),
        }).success,
      ).toBe(true);
      expect(
        safeParse(CreateChannelSchema, {
          name: "a",
          description: "x".repeat(1025),
        }).success,
      ).toBe(false);
      expect(
        safeParse(CreateChannelSchema, { name: "a", description: 3 }).success,
      ).toBe(false);
    });

    it("does not trim the name", () => {
      expect(safeParse(CreateChannelSchema, { name: "  a  " })).toMatchObject({
        success: true,
        data: { name: "  a  " },
      });
    });
  });

  describe("CreateCategorySchema", () => {
    it("trims and uppercases after the length checks", () => {
      expect(
        safeParse(CreateCategorySchema, { name: "  text rooms " }),
      ).toEqual({
        success: true,
        data: { name: "TEXT ROOMS" },
      });
      expect(safeParse(CreateCategorySchema, { name: "   " })).toEqual({
        success: true,
        data: { name: "" },
      });
    });

    it("requires a name of 1..100 characters", () => {
      expect(safeParse(CreateCategorySchema, {}).success).toBe(false);
      expect(safeParse(CreateCategorySchema, { name: "" }).success).toBe(false);
      expect(
        safeParse(CreateCategorySchema, { name: "x".repeat(101) }).success,
      ).toBe(false);
    });
  });

  describe("message text the UI shows", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("keeps the server name messages", () => {
      expect(firstMessage(CreateServerSchema, { name: "" })).toBe(
        "Name is required",
      );
      expect(firstMessage(CreateServerSchema, { name: "x".repeat(101) })).toBe(
        "Name is too long",
      );
    });

    it("keeps the message and reaction messages", () => {
      expect(
        firstMessage(SendMessageSchema, { content: "x".repeat(4001) }),
      ).toBe("Message too long");
      expect(
        firstMessage(EditMessageSchema, { message_id: "x", content: "ok" }),
      ).toBe("Invalid message ID");
      expect(
        firstMessage(EditMessageSchema, { message_id: validId, content: "" }),
      ).toBe("Content is required");
      expect(
        firstMessage(EditMessageSchema, {
          message_id: validId,
          content: "x".repeat(4001),
        }),
      ).toBe("Message too long");
      expect(
        firstMessage(AddReactionSchema, { message_id: "x", emoji: "a" }),
      ).toBe("Invalid message ID");
      expect(
        firstMessage(RemoveReactionSchema, { message_id: "x", emoji: "a" }),
      ).toBe("Invalid message ID");
      expect(firstMessage(DeleteMessageSchema, { message_id: "x" })).toBe(
        "Invalid message ID",
      );
      expect(
        firstMessage(PinMessageSchema, { message_id: "x", pinned: true }),
      ).toBe("Invalid message ID");
    });

    it("trims edited content after the length checks", () => {
      expect(
        safeParse(EditMessageSchema, { message_id: validId, content: " hi " }),
      ).toEqual({
        success: true,
        data: { message_id: validId, content: "hi" },
      });
      expect(
        safeParse(EditMessageSchema, { message_id: validId, content: "  " }),
      ).toEqual({
        success: true,
        data: { message_id: validId, content: "" },
      });
    });
  });

  describe("UpdateServerSchema extras", () => {
    it("asks for at least one change", () => {
      expect(firstMessage(UpdateServerSchema, {})).toBe("No changes provided");
      expect(firstMessage(UpdateServerSchema, { name: "   " })).toBe(
        "No changes provided",
      );
      expect(firstMessage(UpdateServerSchema, { unknown_flag: true })).toBe(
        "No changes provided",
      );
    });

    it("counts null icons and false flags as changes", () => {
      expect(safeParse(UpdateServerSchema, { icon_url: null }).success).toBe(
        true,
      );
      expect(
        safeParse(UpdateServerSchema, { invites_paused: false }).success,
      ).toBe(true);
      expect(
        safeParse(UpdateServerSchema, { allow_share_indexing: false }).success,
      ).toBe(true);
    });

    it("trims the name and rejects an empty one", () => {
      expect(safeParse(UpdateServerSchema, { name: " Renamed " })).toEqual({
        success: true,
        data: { name: "Renamed" },
      });
      expect(safeParse(UpdateServerSchema, { name: "" }).success).toBe(false);
    });

    it("strips undeclared keys", () => {
      expect(
        safeParse(UpdateServerSchema, { name: "a", owner_id: "someone" }),
      ).toEqual({ success: true, data: { name: "a" } });
    });
  });

  describe("shared field semantics", () => {
    it("accepts nil UUIDs but not version 0 UUIDs", () => {
      expect(
        safeParse(DeleteMessageSchema, {
          message_id: "00000000-0000-0000-0000-000000000000",
        }).success,
      ).toBe(true);
      expect(
        safeParse(DeleteMessageSchema, {
          message_id: "a1b2c3d4-e5f6-0a7b-8c9d-0e1f2a3b4c5d",
        }).success,
      ).toBe(false);
    });

    it("accepts null reply_to_id and rejects a null content", () => {
      expect(safeParse(SendMessageSchema, { reply_to_id: null }).success).toBe(
        true,
      );
      expect(safeParse(SendMessageSchema, { content: null }).success).toBe(
        false,
      );
    });

    it("limits nonce to 100 characters", () => {
      expect(
        safeParse(SendMessageSchema, { nonce: "n".repeat(100) }).success,
      ).toBe(true);
      expect(
        safeParse(SendMessageSchema, { nonce: "n".repeat(101) }).success,
      ).toBe(false);
    });

    it("accepts up to ten UUID attachment ids", () => {
      const ids = Array.from(
        { length: 10 },
        (_, i) =>
          `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c${i.toString().padStart(2, "0")}`,
      );

      expect(
        safeParse(SendMessageSchema, { attachment_ids: ids }).success,
      ).toBe(true);
      expect(
        safeParse(SendMessageSchema, { attachment_ids: [...ids, ids[0]] })
          .success,
      ).toBe(false);
      expect(
        safeParse(SendMessageSchema, { attachment_ids: ["not-a-uuid"] })
          .success,
      ).toBe(false);
    });

    it("rejects non-finite and non-numeric roles", () => {
      expect(safeParse(UpdateRoleSchema, { role: Number.NaN }).success).toBe(
        false,
      );
      expect(
        safeParse(UpdateRoleSchema, { role: Number.POSITIVE_INFINITY }).success,
      ).toBe(false);
      expect(safeParse(UpdateRoleSchema, { role: "1" }).success).toBe(false);
    });

    it("bounds reaction target ids", () => {
      const message_id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

      expect(
        safeParse(RemoveReactionSchema, {
          message_id,
          emoji: "x",
          target_user_id: "",
        }).success,
      ).toBe(false);
      expect(
        safeParse(RemoveReactionSchema, {
          message_id,
          emoji: "x",
          target_user_id: "u".repeat(129),
        }).success,
      ).toBe(false);
    });
  });
});
