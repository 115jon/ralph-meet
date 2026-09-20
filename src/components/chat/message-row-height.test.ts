import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/types";
import { estimateMessageRowHeight } from "./message-row-height";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    channel_id: "channel-1",
    author_id: "user-1",
    content: "hello",
    is_pinned: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("estimateMessageRowHeight", () => {
  it("keeps compact text rows short", () => {
    expect(estimateMessageRowHeight(message(), false, false)).toBe(28);
  });

  it("reserves space for images and embeds before they load", () => {
    const withMedia = message({
      attachments: [
        {
          id: "att-1",
          filename: "pic.png",
          file_key: "pic.png",
          content_type: "image/png",
          size_bytes: 12,
        },
      ],
      embeds: [
        {
          id: "embed-1",
          url: "https://example.com",
          type: "link",
          fields: [],
        },
      ],
    });

    expect(estimateMessageRowHeight(withMedia, true, false)).toBe(
      64 + 240 + 200,
    );
  });
});
