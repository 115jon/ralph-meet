import { describe, expect, it } from "vitest";
import {
  AddReactionSchema,
  CreateServerSchema,
  DeleteMessageSchema,
  EditMessageSchema,
  PinMessageSchema,
  SendMessageSchema,
  UpdateRoleSchema
} from "./validations";

describe("Zod Validation Schemas", () => {
  // ── CreateServerSchema ───────────────────────────────────────────
  describe("CreateServerSchema", () => {
    it("accepts valid server name", () => {
      const result = CreateServerSchema.safeParse({ name: "My Server" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Server");
      }
    });

    it("trims whitespace on name", () => {
      const result = CreateServerSchema.safeParse({ name: "  My Server  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Server");
      }
    });

    it("rejects empty name", () => {
      const result = CreateServerSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("rejects name over 100 chars", () => {
      const result = CreateServerSchema.safeParse({ name: "x".repeat(101) });
      expect(result.success).toBe(false);
    });

    it("accepts optional icon_url", () => {
      const result = CreateServerSchema.safeParse({
        name: "Server",
        icon_url: "https://example.com/icon.png",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid icon_url", () => {
      const result = CreateServerSchema.safeParse({
        name: "Server",
        icon_url: "not-a-url",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── SendMessageSchema ────────────────────────────────────────────
  describe("SendMessageSchema", () => {
    it("accepts message with content", () => {
      const result = SendMessageSchema.safeParse({ content: "Hello" });
      expect(result.success).toBe(true);
    });

    it("defaults content to empty string", () => {
      const result = SendMessageSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("");
      }
    });

    it("rejects content over 4000 chars", () => {
      const result = SendMessageSchema.safeParse({ content: "x".repeat(4001) });
      expect(result.success).toBe(false);
    });

    it("validates reply_to_id as UUID", () => {
      const result = SendMessageSchema.safeParse({
        content: "reply",
        reply_to_id: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("limits attachment_ids to 10", () => {
      const ids = Array.from({ length: 11 }, (_, i) =>
        `${i.toString().padStart(8, "0")}-0000-0000-0000-000000000000`
      );
      const result = SendMessageSchema.safeParse({
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
      const result = EditMessageSchema.safeParse({
        message_id: validId,
        content: "edited",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty content", () => {
      const result = EditMessageSchema.safeParse({
        message_id: validId,
        content: "",
      });
      expect(result.success).toBe(false);
    });
  });

  // ── DeleteMessageSchema ──────────────────────────────────────────
  describe("DeleteMessageSchema", () => {
    it("accepts valid UUID", () => {
      const result = DeleteMessageSchema.safeParse({
        message_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID", () => {
      const result = DeleteMessageSchema.safeParse({ message_id: "abc" });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateRoleSchema ─────────────────────────────────────────────
  describe("UpdateRoleSchema", () => {
    it("accepts valid role 0-2", () => {
      expect(UpdateRoleSchema.safeParse({ role: 0 }).success).toBe(true);
      expect(UpdateRoleSchema.safeParse({ role: 1 }).success).toBe(true);
      expect(UpdateRoleSchema.safeParse({ role: 2 }).success).toBe(true);
    });

    it("rejects role > 2", () => {
      expect(UpdateRoleSchema.safeParse({ role: 3 }).success).toBe(false);
    });

    it("rejects non-integer role", () => {
      expect(UpdateRoleSchema.safeParse({ role: 1.5 }).success).toBe(false);
    });

    it("rejects negative role", () => {
      expect(UpdateRoleSchema.safeParse({ role: -1 }).success).toBe(false);
    });
  });

  // ── AddReactionSchema ────────────────────────────────────────────
  describe("AddReactionSchema", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("accepts valid reaction", () => {
      const result = AddReactionSchema.safeParse({
        message_id: validId,
        emoji: "👍",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty emoji", () => {
      const result = AddReactionSchema.safeParse({
        message_id: validId,
        emoji: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects emoji over 32 chars", () => {
      const result = AddReactionSchema.safeParse({
        message_id: validId,
        emoji: "x".repeat(33),
      });
      expect(result.success).toBe(false);
    });
  });

  // ── PinMessageSchema ─────────────────────────────────────────────
  describe("PinMessageSchema", () => {
    const validId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("accepts valid pin", () => {
      const result = PinMessageSchema.safeParse({
        message_id: validId,
        pinned: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-boolean pinned", () => {
      const result = PinMessageSchema.safeParse({
        message_id: validId,
        pinned: "yes",
      });
      expect(result.success).toBe(false);
    });
  });
});
