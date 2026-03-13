import { initialState, type ChatState } from "@/lib/chat-reducer";
import type { Message } from "@/lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat-store";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    author_id: "user-1",
    content: "hello",
    is_pinned: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stateWith(overrides: Partial<ChatState> = {}): ChatState {
  return { ...initialState, ...overrides };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("chatStore logic equivalence", () => {
  beforeEach(() => {
    // Reset Zustand store to initial state before each test
    // Keep actions and gateway intact, just override the state shape
    useChatStore.setState(initialState);
  });

  // ── APPEND_MESSAGE ──────────────────────────────────────────────────────

  describe("APPEND_MESSAGE", () => {
    it("appends a message to the active channel", () => {
      useChatStore.setState(stateWith({ activeChannelId: "ch-1" }));
      const msg = makeMessage();
      useChatStore.getState().dispatch({ type: "APPEND_MESSAGE", message: msg });

      const next = useChatStore.getState();
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0].id).toBe("msg-1");
    });

    it("ignores messages for a different channel", () => {
      useChatStore.setState(stateWith({ activeChannelId: "ch-other" }));
      const msg = makeMessage({ channel_id: "ch-1" });
      useChatStore.getState().dispatch({ type: "APPEND_MESSAGE", message: msg });

      const next = useChatStore.getState();
      expect(next.messages).toHaveLength(0);
    });

    it("deduplicates by ID (late echo)", () => {
      const msg = makeMessage();
      useChatStore.setState(stateWith({ activeChannelId: "ch-1", messages: [msg] }));
      useChatStore.getState().dispatch({ type: "APPEND_MESSAGE", message: msg });

      const next = useChatStore.getState();
      expect(next.messages).toHaveLength(1);
    });

    it("replaces optimistic message by nonce", () => {
      const pending = makeMessage({ id: "pending-abc", nonce: "abc", pending: true });
      useChatStore.setState(stateWith({ activeChannelId: "ch-1", messages: [pending] }));

      const confirmed = makeMessage({ id: "real-id", nonce: "abc", pending: false });
      useChatStore.getState().dispatch({ type: "APPEND_MESSAGE", message: confirmed });

      const next = useChatStore.getState();
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0].id).toBe("real-id");
      expect(next.messages[0].pending).toBe(false);
    });
  });

  // ── DELETE_MESSAGE ──────────────────────────────────────────────────────

  describe("DELETE_MESSAGE", () => {
    it("removes from both messages and pinnedMessages", () => {
      const msg = makeMessage({ is_pinned: true });
      useChatStore.setState(stateWith({ messages: [msg], pinnedMessages: [msg] }));

      useChatStore.getState().dispatch({ type: "DELETE_MESSAGE", id: "msg-1" });

      const next = useChatStore.getState();
      expect(next.messages).toHaveLength(0);
      expect(next.pinnedMessages).toHaveLength(0);
    });
  });

  // ── REMOVE_SERVER ──────────────────────────────────────────────────────

  describe("REMOVE_SERVER", () => {
    it("clears server-scoped state when removing the active server", () => {
      useChatStore.setState(stateWith({
        activeServerId: "srv-1",
        activeChannelId: "ch-1",
        servers: [{ id: "srv-1", name: "Test", owner_id: "u1", created_at: "" }],
        channels: [{ id: "ch-1", name: "general", channel_type: "text", position: 0, created_at: "" }],
        messages: [makeMessage()],
        members: [{ user: { id: "u1", username: "alice" } }],
      }));
      useChatStore.getState().dispatch({ type: "REMOVE_SERVER", serverId: "srv-1" });

      const next = useChatStore.getState();
      expect(next.servers).toHaveLength(0);
      expect(next.activeServerId).toBe("@me");
      expect(next.activeChannelId).toBeNull();
      expect(next.channels).toHaveLength(0);
      expect(next.messages).toHaveLength(0);
      expect(next.members).toHaveLength(0);
    });

    it("preserves state when removing a non-active server", () => {
      useChatStore.setState(stateWith({
        activeServerId: "srv-2",
        servers: [
          { id: "srv-1", name: "Removed", owner_id: "u1", created_at: "" },
          { id: "srv-2", name: "Active", owner_id: "u1", created_at: "" },
        ],
        messages: [makeMessage()],
      }));
      useChatStore.getState().dispatch({ type: "REMOVE_SERVER", serverId: "srv-1" });

      const next = useChatStore.getState();
      expect(next.servers).toHaveLength(1);
      expect(next.activeServerId).toBe("srv-2");
      expect(next.messages).toHaveLength(1); // preserved
    });
  });

  // ── ADD_REACTION / REMOVE_REACTION ────────────────────────────────────

  describe("reactions", () => {
    it("ADD_REACTION creates a new reaction entry", () => {
      const msg = makeMessage({ reactions: [] });
      useChatStore.setState(stateWith({ messages: [msg] }));

      useChatStore.getState().dispatch({ type: "ADD_REACTION", messageId: "msg-1", emoji: "👍", userId: "user-1" });

      const next = useChatStore.getState();
      const reactions = next.messages[0].reactions!;
      expect(reactions).toHaveLength(1);
      expect(reactions[0].emoji).toBe("👍");
      expect(reactions[0].count).toBe(1);
      expect(reactions[0].users).toEqual(["user-1"]);
    });

    it("ADD_REACTION increments existing reaction count", () => {
      const msg = makeMessage({
        reactions: [{ emoji: "👍", count: 1, me: false, users: ["user-1"] }],
      });
      useChatStore.setState(stateWith({ messages: [msg] }));
      useChatStore.getState().dispatch({ type: "ADD_REACTION", messageId: "msg-1", emoji: "👍", userId: "user-2" });

      const next = useChatStore.getState();
      const reactions = next.messages[0].reactions!;
      expect(reactions[0].count).toBe(2);
      expect(reactions[0].users).toEqual(["user-1", "user-2"]);
    });

    it("REMOVE_REACTION decrements count and removes at zero", () => {
      const msg = makeMessage({
        reactions: [{ emoji: "👍", count: 1, me: false, users: ["user-1"] }],
      });
      useChatStore.setState(stateWith({ messages: [msg] }));
      useChatStore.getState().dispatch({ type: "REMOVE_REACTION", messageId: "msg-1", emoji: "👍", userId: "user-1" });

      const next = useChatStore.getState();
      const reactions = next.messages[0].reactions!;
      expect(reactions).toHaveLength(0);
    });
  });

  // ── PIN_MESSAGE ───────────────────────────────────────────────────────

  describe("PIN_MESSAGE", () => {
    it("adds a message to pinnedMessages when pinned", () => {
      const msg = makeMessage();
      useChatStore.setState(stateWith({ messages: [msg] }));
      useChatStore.getState().dispatch({ type: "PIN_MESSAGE", messageId: "msg-1", pinned: true });

      const next = useChatStore.getState();
      expect(next.messages[0].is_pinned).toBe(true);
      expect(next.pinnedMessages).toHaveLength(1);
      expect(next.pinnedMessages[0].id).toBe("msg-1");
    });

    it("removes a message from pinnedMessages when unpinned", () => {
      const msg = makeMessage({ is_pinned: true });
      useChatStore.setState(stateWith({ messages: [msg], pinnedMessages: [msg] }));
      useChatStore.getState().dispatch({ type: "PIN_MESSAGE", messageId: "msg-1", pinned: false });

      const next = useChatStore.getState();
      expect(next.messages[0].is_pinned).toBe(false);
      expect(next.pinnedMessages).toHaveLength(0);
    });
  });

  // ── Typing indicators ────────────────────────────────────────────────

  describe("typing", () => {
    it("SET_TYPING adds a user to the channel's typing set", () => {
      useChatStore.setState(stateWith({}));
      useChatStore.getState().dispatch({ type: "SET_TYPING", channelId: "ch-1", userId: "user-1" });
      expect(useChatStore.getState().typingUsers["ch-1"]?.has("user-1")).toBe(true);
    });

    it("CLEAR_TYPING removes a user from the channel's typing set", () => {
      const typing = new Set(["user-1"]);
      useChatStore.setState(stateWith({ typingUsers: { "ch-1": typing } }));
      useChatStore.getState().dispatch({ type: "CLEAR_TYPING", channelId: "ch-1", userId: "user-1" });
      expect(useChatStore.getState().typingUsers["ch-1"]?.has("user-1")).toBe(false);
    });
  });

  // ── Members ───────────────────────────────────────────────────────────

  describe("members", () => {
    it("ADD_MEMBER ignores duplicates", () => {
      const member = { user: { id: "u1", username: "alice" } };
      useChatStore.setState(stateWith({ members: [member] }));
      useChatStore.getState().dispatch({ type: "ADD_MEMBER", member });
      expect(useChatStore.getState().members).toHaveLength(1);
    });

    it("REMOVE_MEMBER filters by userId", () => {
      useChatStore.setState(stateWith({
        members: [
          { user: { id: "u1", username: "alice" } },
          { user: { id: "u2", username: "bob" } },
        ],
      }));
      useChatStore.getState().dispatch({ type: "REMOVE_MEMBER", userId: "u1" });

      const next = useChatStore.getState();
      expect(next.members).toHaveLength(1);
      expect(next.members[0].user.id).toBe("u2");
    });
  });

  // ── Voice channel states ──────────────────────────────────────────────

  describe("voice channel states", () => {
    it("UPDATE_VOICE_CHANNEL_STATE adds members for a channel", () => {
      useChatStore.setState(stateWith({}));
      const members = [{ clerk_user_id: "u1", name: "alice", self_mute: false, self_deaf: false, self_video: false, self_stream: false }];
      useChatStore.getState().dispatch({ type: "UPDATE_VOICE_CHANNEL_STATE", channelId: "vc-1", members, startedAt: null });
      expect(useChatStore.getState().voiceChannelStates["vc-1"]).toEqual(members);
    });

    it("UPDATE_VOICE_CHANNEL_STATE removes channel entry when members is empty", () => {
      useChatStore.setState(stateWith({
        voiceChannelStates: {
          "vc-1": [{ clerk_user_id: "u1", name: "alice", self_mute: false, self_deaf: false, self_video: false, self_stream: false }],
        },
      }));
      useChatStore.getState().dispatch({ type: "UPDATE_VOICE_CHANNEL_STATE", channelId: "vc-1", members: [], startedAt: null });
      expect(useChatStore.getState().voiceChannelStates["vc-1"]).toBeUndefined();
    });
  });

  // ── Navigation ────────────────────────────────────────────────────────

  describe("navigation identity checks", () => {
    it("SET_ACTIVE_CHANNEL clears messages and pins on change", () => {
      useChatStore.setState(stateWith({
        activeChannelId: "ch-1",
        messages: [makeMessage()],
        pinnedMessages: [makeMessage({ is_pinned: true })],
        pinsLoadedFor: "ch-1",
      }));
      useChatStore.getState().dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: "ch-2" });

      const next = useChatStore.getState();
      expect(next.activeChannelId).toBe("ch-2");
      expect(next.messages).toHaveLength(0);
      expect(next.pinnedMessages).toHaveLength(0);
      expect(next.pinsLoadedFor).toBeNull();
    });
  });

  // ── DM channels ───────────────────────────────────────────────────────

  describe("DM channels", () => {
    it("ADD_DM_CHANNEL ignores duplicates", () => {
      const dm = { id: "dm-1", name: "DM", recipient: { id: "u2", username: "bob" } };
      useChatStore.setState(stateWith({ dmChannels: [dm] }));
      useChatStore.getState().dispatch({ type: "ADD_DM_CHANNEL", dmChannel: dm });
      expect(useChatStore.getState().dmChannels).toHaveLength(1);
    });

    it("ADD_DM_CHANNEL prepends new DM channel", () => {
      const existing = { id: "dm-1", name: "DM1", recipient: { id: "u2", username: "bob" } };
      useChatStore.setState(stateWith({ dmChannels: [existing] }));

      const newDm = { id: "dm-2", name: "DM2", recipient: { id: "u3", username: "carol" } };
      useChatStore.getState().dispatch({ type: "ADD_DM_CHANNEL", dmChannel: newDm });

      const next = useChatStore.getState();
      expect(next.dmChannels).toHaveLength(2);
      expect(next.dmChannels[0].id).toBe("dm-2");
    });
  });
});
