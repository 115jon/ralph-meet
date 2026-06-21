import { beforeEach, describe, expect, it } from "vitest";

import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  createGeneratedEmoji,
  getGeneratedEmojiAssetById,
  listGeneratedEmojisByIds,
  listUserGeneratedEmojis,
  markGeneratedEmojiFailed,
  markGeneratedEmojiReady,
} from "../emoji.service";

const USER_ID = "user-1";
const EMOJI_ID = "emoji-1";
const CREATED_AT = "2026-06-20T12:00:00.000Z";

describe("emoji.service", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("stores a pending generated emoji request", async () => {
    await createGeneratedEmoji(db as any, {
      id: EMOJI_ID,
      userId: USER_ID,
      shortcode: "party_blob",
      prompt: "party blob with confetti",
      createdAt: CREATED_AT,
    });

    db.assertCalled(/INSERT INTO generated_emojis/);
  });

  it("maps listed user creations into client-friendly emoji items", async () => {
    db.mockQuery("FROM generated_emojis", {
      results: [{
        id: EMOJI_ID,
        user_id: USER_ID,
        shortcode: "party_blob",
        prompt: "party blob with confetti",
        file_key: "emoji-assets/user-1/emoji-1.png",
        content_type: "image/png",
        size_bytes: 2048,
        status: "ready",
        error_message: null,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }],
    });

    const items = await listUserGeneratedEmojis(db as any, USER_ID, 12);

    expect(items).toHaveLength(1);
    expect(items[0].token).toBe("<:party_blob:emoji-1>");
    expect(items[0].image_url).toBe("/api/emojis/assets/emoji-1");
    expect(items[0].status).toBe("ready");
  });

  it("returns emojis in the requested id order for lookups", async () => {
    db.mockQuery("WHERE id IN", {
      results: [
        {
          id: "emoji-b",
          user_id: USER_ID,
          shortcode: "b",
          prompt: "b",
          file_key: null,
          content_type: null,
          size_bytes: 0,
          status: "pending",
          error_message: null,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
        {
          id: "emoji-a",
          user_id: USER_ID,
          shortcode: "a",
          prompt: "a",
          file_key: null,
          content_type: null,
          size_bytes: 0,
          status: "pending",
          error_message: null,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
        },
      ],
    });

    const items = await listGeneratedEmojisByIds(db as any, ["emoji-a", "emoji-b"]);

    expect(items.map((item) => item.id)).toEqual(["emoji-a", "emoji-b"]);
  });

  it("loads a specific emoji asset record with its file key", async () => {
    db.mockQuery("WHERE id = ?", {
      id: EMOJI_ID,
      user_id: USER_ID,
      shortcode: "party_blob",
      prompt: "party blob with confetti",
      file_key: "emoji-assets/user-1/emoji-1.png",
      content_type: "image/png",
      size_bytes: 2048,
      status: "ready",
      error_message: null,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    });

    const item = await getGeneratedEmojiAssetById(db as any, EMOJI_ID);

    expect(item).not.toBeNull();
    expect(item?.fileKey).toBe("emoji-assets/user-1/emoji-1.png");
    expect(item?.token).toBe("<:party_blob:emoji-1>");
  });

  it("updates ready and failed status rows", async () => {
    await markGeneratedEmojiReady(db as any, {
      id: EMOJI_ID,
      fileKey: "emoji-assets/user-1/emoji-1.png",
      contentType: "image/png",
      sizeBytes: 2048,
      updatedAt: CREATED_AT,
    });
    await markGeneratedEmojiFailed(db as any, {
      id: EMOJI_ID,
      errorMessage: "bad prompt",
      updatedAt: CREATED_AT,
    });

    db.assertCalled(/UPDATE generated_emojis/);
  });
});
