import { describe, expect, it } from "vitest";
import { chatReducer, initialState } from "./chat-reducer";
import type { Message } from "./types";

const message = (id: string, created_at: string): Message =>
  ({
    id,
    channel_id: "channel-1",
    author_id: "user-1",
    content: id,
    created_at,
    author: {
      id: "user-1",
      username: "user",
      display_name: "User",
      avatar_url: null,
    },
    attachments: [],
    reactions: [],
    embeds: [],
    is_pinned: false,
  }) as Message;

describe("chatReducer message snapshots", () => {
  it("preserves live messages received during a REST history request", () => {
    const live = message("live", "2026-07-16T00:00:02.000Z");
    const state = chatReducer(
      { ...initialState, activeChannelId: "channel-1" },
      { type: "APPEND_MESSAGE", message: live },
    );

    const next = chatReducer(state, {
      type: "SET_MESSAGES",
      channelId: "channel-1",
      messages: [message("history", "2026-07-16T00:00:01.000Z")],
      hasMoreBefore: false,
      hasMoreAfter: false,
      preserveMessagesFrom: [],
    });

    expect(next.messages.map((item) => item.id)).toEqual(["history", "live"]);
  });

  it("preserves updates to messages that changed during the request", () => {
    const original = message("same", "2026-07-16T00:00:01.000Z");
    const state = chatReducer(
      { ...initialState, activeChannelId: "channel-1" },
      { type: "APPEND_MESSAGE", message: original },
    );
    const updated = { ...original, content: "edited" };
    const updatedState = chatReducer(state, {
      type: "UPDATE_MESSAGE",
      id: original.id,
      content: updated.content,
    });

    const next = chatReducer(updatedState, {
      type: "SET_MESSAGES",
      channelId: "channel-1",
      messages: [original],
      hasMoreBefore: false,
      hasMoreAfter: false,
      preserveMessagesFrom: [original],
    });

    expect(next.messages[0]?.content).toBe("edited");
  });

  it("marks cached channels stale without removing live messages", () => {
    const cached = message("cached", "2026-07-16T00:00:01.000Z");
    const state = {
      ...initialState,
      messagesByChannelId: { "channel-1": [cached], "channel-2": [] },
      messagesLoadedByChannelId: { "channel-1": true, "channel-2": true },
    };

    const next = chatReducer(state, { type: "MARK_MESSAGE_CACHES_STALE" });

    expect(next.messagesByChannelId["channel-1"]).toEqual([cached]);
    expect(next.messagesLoadedByChannelId).toEqual({
      "channel-1": false,
      "channel-2": false,
    });
  });
});

describe("chatReducer speaking sources", () => {
  it("aggregates speaking users without allowing one session to clear another", () => {
    const first = chatReducer(initialState, {
      type: "SET_SPEAKING_USERS",
      sourceId: "voice-session-a",
      speakingUsers: { alice: true },
    });
    const both = chatReducer(first, {
      type: "SET_SPEAKING_USERS",
      sourceId: "voice-session-b",
      speakingUsers: { bob: true },
    });

    const cleared = chatReducer(both, {
      type: "CLEAR_SPEAKING_USERS",
      sourceId: "voice-session-a",
    });

    expect(cleared.speakingUsers).toEqual({ bob: true });
  });
});
