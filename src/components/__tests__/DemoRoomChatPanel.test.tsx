import { describe, expect, it } from "vitest";

import { parseDemoChatMessage } from "../DemoRoomChatPanel";

describe("parseDemoChatMessage", () => {
  it("keeps valid messages when timestamps are missing or malformed", () => {
    const message = parseDemoChatMessage({
      id: "message-1",
      participant_id: "participant-1",
      author_name: "Alice",
      content: "Hello",
      created_at: "not-a-date",
      expires_at: null,
    });

    expect(message).toMatchObject({
      id: "message-1",
      content: "Hello",
      created_at: null,
      expires_at: null,
    });
  });

  it("normalizes ISO and numeric timestamps", () => {
    const message = parseDemoChatMessage({
      id: "message-2",
      participant_id: "participant-1",
      author_name: "Alice",
      content: "Hello",
      created_at: "2024-03-05T14:06:07.000Z",
      expires_at: 1_709_642_767_000,
    });

    expect(message?.created_at).toBe(Date.parse("2024-03-05T14:06:07.000Z"));
    expect(message?.expires_at).toBe(1_709_642_767_000);
  });
});
