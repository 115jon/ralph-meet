import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialState,
  type VoiceChannelMemberDelta,
  type VoiceChannelMember,
} from "./chat-reducer";
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

  it("ignores an older embed revision", () => {
    const original = {
      ...message("same", "2026-07-16T00:00:01.000Z"),
      content_revision: 2,
    };
    const state = chatReducer(
      { ...initialState, activeChannelId: "channel-1" },
      { type: "APPEND_MESSAGE", message: original },
    );

    const next = chatReducer(state, {
      type: "UPDATE_MESSAGE",
      id: original.id,
      content_revision: 1,
      embeds: [{ url: "https://old.example" } as import("./types").EmbedInfo],
    });

    expect(next.messages[0]?.embeds).toEqual([]);
    expect(next.messages[0]?.content_revision).toBe(2);
  });

  it("ignores duplicate notification IDs before changing unread state", () => {
    const notification = {
      id: "notification-1",
      type: "mention" as const,
      channel_id: "channel-1",
      server_id: "server-1",
      message_id: "message-1",
      from_user: { id: "user-2", username: "user-2" },
      content: "hello",
      is_read: false,
      created_at: "2026-07-16T00:00:01.000Z",
    };
    const once = chatReducer(initialState, {
      type: "ADD_NOTIFICATION",
      notification,
    });
    const twice = chatReducer(once, {
      type: "ADD_NOTIFICATION",
      notification,
    });

    expect(twice.notifications).toEqual(once.notifications);
    expect(twice.unreadNotificationCount).toBe(once.unreadNotificationCount);
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

describe("chatReducer voice channel profiles", () => {
  const fullMember: VoiceChannelMember = {
    clerk_user_id: "user-1",
    name: "Alice",
    username: "alice",
    display_name: "Alice Display",
    avatar_url: "https://example.com/alice.png",
    avatar_display: "frame:alice",
    display_name_style: null,
    self_mute: false,
    self_deaf: false,
    self_video: false,
    self_stream: false,
  };

  it("preserves cached profile fields when a compact SET snapshot arrives", () => {
    const state = chatReducer(initialState, {
      type: "UPDATE_VOICE_CHANNEL_STATE",
      channelId: "voice-1",
      members: [fullMember],
      startedAt: null,
    });

    const compactMember: VoiceChannelMemberDelta = {
      clerk_user_id: fullMember.clerk_user_id,
      self_mute: true,
      self_deaf: false,
      self_video: false,
      self_stream: false,
    };
    const next = chatReducer(state, {
      type: "SET_VOICE_CHANNEL_STATES",
      states: { "voice-1": [compactMember] },
      startedAt: { "voice-1": 123 },
    });

    expect(next.voiceChannelStates["voice-1"]?.[0]).toEqual(
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Alice Display",
        username: "alice",
        display_name: "Alice Display",
        avatar_url: "https://example.com/alice.png",
        avatar_display: "frame:alice",
        self_mute: true,
      }),
    );
  });

  it("preserves cached profile fields when a compact member delta arrives", () => {
    const state = chatReducer(initialState, {
      type: "UPDATE_VOICE_CHANNEL_STATE",
      channelId: "voice-1",
      members: [fullMember],
      startedAt: null,
    });

    const compactMember: VoiceChannelMemberDelta = {
      clerk_user_id: fullMember.clerk_user_id,
      self_mute: true,
      self_deaf: false,
      self_video: false,
      self_stream: false,
    };
    const next = chatReducer(state, {
      type: "UPDATE_VOICE_CHANNEL_STATE",
      channelId: "voice-1",
      members: [compactMember],
      startedAt: null,
    });

    const member = next.voiceChannelStates["voice-1"]?.[0];
    expect(member).toEqual({
      clerk_user_id: "user-1",
      name: "Alice Display",
      username: "alice",
      display_name: "Alice Display",
      avatar_url: "https://example.com/alice.png",
      avatar_display: "frame:alice",
      self_mute: true,
      display_name_style: null,
      self_deaf: false,
      self_video: false,
      self_stream: false,
    });
  });

  it("applies explicit null profile updates to cached voice members", () => {
    const state = chatReducer(initialState, {
      type: "UPDATE_VOICE_CHANNEL_STATE",
      channelId: "voice-1",
      members: [fullMember],
      startedAt: null,
    });

    const next = chatReducer(state, {
      type: "UPDATE_MEMBER_PROFILE",
      userId: fullMember.clerk_user_id,
      username: "alice-updated",
      display_name: null,
      avatar_url: null,
      avatar_display: null,
    });

    expect(next.voiceChannelStates["voice-1"]?.[0]).toEqual(
      expect.objectContaining({
        name: "alice-updated",
        username: "alice-updated",
        display_name: null,
        avatar_url: null,
        avatar_display: null,
      }),
    );
  });

  it("uses an authoritative replacement profile over stale cached member data", () => {
    const next = chatReducer(
      {
        ...initialState,
        members: [
          {
            user: {
              id: fullMember.clerk_user_id,
              username: "stale-user",
              display_name: "Stale Display",
              avatar_url: "https://example.com/stale.png",
              avatar_display: "frame:stale",
              display_name_style: "stale-style",
            },
            roles: [],
          },
        ],
      },
      {
        type: "SET_VOICE_CHANNEL_STATES",
        states: {
          "voice-1": [
            {
              ...fullMember,
              name: "Fresh Name",
              username: "fresh-user",
              display_name: "Fresh Display",
              avatar_url: "https://example.com/fresh.png",
              avatar_display: "frame:fresh",
              display_name_style: "fresh-style",
            },
          ],
        },
        startedAt: {},
      },
    );

    expect(next.voiceChannelStates["voice-1"]?.[0]).toEqual(
      expect.objectContaining({
        name: "Fresh Display",
        username: "fresh-user",
        display_name: "Fresh Display",
        avatar_url: "https://example.com/fresh.png",
        avatar_display: "frame:fresh",
        display_name_style: "fresh-style",
      }),
    );
  });

  it("keeps authoritative null profile fields ahead of stale relationship data", () => {
    const next = chatReducer(
      {
        ...initialState,
        relationships: [
          {
            user: {
              id: fullMember.clerk_user_id,
              username: "stale-user",
              display_name: "Stale Display",
              avatar_url: "https://example.com/stale.png",
              avatar_display: "frame:stale",
              display_name_style: "stale-style",
            },
            type: 1,
            created_at: "2026-07-19T00:00:00Z",
          },
        ],
      },
      {
        type: "SET_VOICE_CHANNEL_STATES",
        states: {
          "voice-1": [
            {
              ...fullMember,
              name: "Fresh Name",
              username: "fresh-user",
              display_name: null,
              avatar_url: null,
              avatar_display: null,
              display_name_style: null,
            },
          ],
        },
        startedAt: {},
      },
    );

    expect(next.voiceChannelStates["voice-1"]?.[0]).toEqual(
      expect.objectContaining({
        name: "fresh-user",
        username: "fresh-user",
        display_name: null,
        avatar_url: null,
        avatar_display: null,
        display_name_style: null,
      }),
    );
  });
});
