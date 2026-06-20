import { initialState, type ChatState } from "@/lib/chat-reducer";
import type { Category, Channel, Message } from "@/lib/types";
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

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "ch-1",
    server_id: "srv-1",
    name: "general",
    channel_type: "text",
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    server_id: "srv-1",
    name: "Text Channels",
    rank: 0,
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

    it("ADD_MEMBER caches inactive server members without replacing the active view", () => {
      const activeMember = { user: { id: "active-user", username: "active" } };
      const inactiveMember = { user: { id: "inactive-user", username: "inactive" }, roles: [] };

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        members: [activeMember],
        membersByServerId: { "srv-active": [activeMember] },
      }));

      useChatStore.getState().dispatch({ type: "ADD_MEMBER", serverId: "srv-inactive", member: inactiveMember });

      const next = useChatStore.getState();
      expect(next.members).toEqual([activeMember]);
      expect(next.membersByServerId["srv-inactive"]).toEqual([inactiveMember]);
    });

    it("REMOVE_MEMBER removes inactive server members without replacing the active view", () => {
      const activeMember = { user: { id: "active-user", username: "active" } };
      const inactiveMember = { user: { id: "inactive-user", username: "inactive" } };

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        members: [activeMember],
        membersByServerId: {
          "srv-active": [activeMember],
          "srv-inactive": [inactiveMember],
        },
      }));

      useChatStore.getState().dispatch({ type: "REMOVE_MEMBER", serverId: "srv-inactive", userId: "inactive-user" });

      const next = useChatStore.getState();
      expect(next.members).toEqual([activeMember]);
      expect(next.membersByServerId["srv-inactive"]).toEqual([]);
    });

    it("UPDATE_MEMBER_ROLES updates inactive server member roles without replacing the active view", () => {
      const activeMember = { user: { id: "active-user", username: "active" }, roles: [] };
      const inactiveMember = { user: { id: "inactive-user", username: "inactive" }, roles: [] };
      const roles = [{
        id: "role-1",
        server_id: "srv-inactive",
        name: "Mod",
        permissions: 0,
        position: 1,
        color: null,
        is_default: false,
        created_at: "2026-01-01T00:00:00Z",
      }];

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        members: [activeMember],
        membersByServerId: {
          "srv-active": [activeMember],
          "srv-inactive": [inactiveMember],
        },
      }));

      useChatStore.getState().dispatch({ type: "UPDATE_MEMBER_ROLES", serverId: "srv-inactive", userId: "inactive-user", roles });

      const next = useChatStore.getState();
      expect(next.members).toEqual([activeMember]);
      expect(next.membersByServerId["srv-inactive"][0].roles).toEqual(roles);
    });

    it("UPDATE_MEMBER_PROFILE updates cached inactive server members", () => {
      const inactiveMember = {
        user: {
          id: "inactive-user",
          username: "old-username",
          display_name: "Old Display",
          avatar_url: "/old-avatar.png",
          banner_url: "/old-banner.png",
          banner_content_type: "image/png",
          nameplate_url: "/old-nameplate.webm",
          nameplate_content_type: "video/webm",
        },
      };

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        membersByServerId: {
          "srv-inactive": [inactiveMember],
        },
      }));

      useChatStore.getState().dispatch({
        type: "UPDATE_MEMBER_PROFILE",
        userId: "inactive-user",
        username: "new-username",
        display_name: "New Display",
        avatar_url: "/new-avatar.png",
        banner_url: "/new-banner.png",
        banner_content_type: "image/png",
        nameplate_url: "/new-nameplate.webm",
        nameplate_content_type: "video/webm",
      });

      const next = useChatStore.getState();
      expect(next.membersByServerId["srv-inactive"][0].user).toMatchObject({
        username: "new-username",
        display_name: "New Display",
        avatar_url: "/new-avatar.png",
        banner_url: "/new-banner.png",
        banner_content_type: "image/png",
        nameplate_url: "/new-nameplate.webm",
        nameplate_content_type: "video/webm",
      });
    });
  });

  // ── Voice channel states ──────────────────────────────────────────────

  describe("voice channel states", () => {
    it("UPDATE_VOICE_CHANNEL_STATE adds members for a channel", () => {
      useChatStore.setState(stateWith({}));
      const members = [{ clerk_user_id: "u1", name: "alice", self_mute: false, self_deaf: false, self_video: false, self_stream: false }];
      useChatStore.getState().dispatch({ type: "UPDATE_VOICE_CHANNEL_STATE", channelId: "vc-1", members, startedAt: null });
      expect(useChatStore.getState().voiceChannelStates["vc-1"]).toMatchObject(members);
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

    it("uses cached display names when applying gateway voice-state members", () => {
      useChatStore.setState(stateWith({
        members: [{ user: { id: "u1", username: "alice", display_name: "Alice Display" } }],
      }));

      useChatStore.getState().dispatch({
        type: "UPDATE_VOICE_CHANNEL_STATE",
        channelId: "vc-1",
        members: [{ clerk_user_id: "u1", name: "alice", self_mute: false, self_deaf: false, self_video: false, self_stream: false }],
        startedAt: null,
      });

      expect(useChatStore.getState().voiceChannelStates["vc-1"]?.[0]?.name).toBe("Alice Display");
    });

    it("updates the current user's voice member display name when SET_USER refreshes the profile", () => {
      useChatStore.setState(stateWith({
        user: { id: "u1", username: "alice" },
        voiceChannelStates: {
          "vc-1": [{ clerk_user_id: "u1", name: "alice", self_mute: false, self_deaf: false, self_video: false, self_stream: false }],
        },
      }));

      useChatStore.getState().dispatch({
        type: "SET_USER",
        user: { id: "u1", username: "alice", display_name: "Alice Display" },
      });

      expect(useChatStore.getState().voiceChannelStates["vc-1"]?.[0]?.name).toBe("Alice Display");
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

    it("hydrates channels, categories, and members from the server cache on switch", () => {
      const channel = makeChannel();
      const category = makeCategory();
      const member = { user: { id: "u1", username: "alice" } };

      useChatStore.setState(stateWith({
        activeServerId: "srv-2",
        channelsByServerId: { "srv-1": [channel] },
        categoriesByServerId: { "srv-1": [category] },
        membersByServerId: { "srv-1": [member] },
      }));

      useChatStore.getState().dispatch({ type: "SWITCH_SERVER", serverId: "srv-1", channelId: "ch-1" });

      const next = useChatStore.getState();
      expect(next.channels).toEqual([channel]);
      expect(next.categories).toEqual([category]);
      expect(next.members).toEqual([member]);
    });

    it("caches inactive server channel and member loads without replacing the active view", () => {
      const activeChannel = makeChannel({ id: "active-ch", server_id: "srv-active" });
      const inactiveChannel = makeChannel({ id: "inactive-ch", server_id: "srv-inactive" });
      const inactiveCategory = makeCategory({ id: "inactive-cat", server_id: "srv-inactive" });
      const activeMember = { user: { id: "active-user", username: "active" } };
      const inactiveMember = { user: { id: "inactive-user", username: "inactive" } };

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        channels: [activeChannel],
        members: [activeMember],
      }));

      useChatStore.getState().dispatch({
        type: "SET_CHANNELS_AND_CATEGORIES",
        serverId: "srv-inactive",
        channels: [inactiveChannel],
        categories: [inactiveCategory],
      });
      useChatStore.getState().dispatch({ type: "SET_MEMBERS", serverId: "srv-inactive", members: [inactiveMember] });

      const next = useChatStore.getState();
      expect(next.channels).toEqual([activeChannel]);
      expect(next.members).toEqual([activeMember]);
      expect(next.channelsByServerId["srv-inactive"]).toEqual([inactiveChannel]);
      expect(next.categoriesByServerId["srv-inactive"]).toEqual([inactiveCategory]);
      expect(next.membersByServerId["srv-inactive"]).toEqual([inactiveMember]);
    });

    it("upserts a gateway channel delta into the active server cache", () => {
      const oldChannel = makeChannel({ id: "ch-1", name: "old-name" });
      const updatedChannel = makeChannel({ id: "ch-1", name: "new-name" });

      useChatStore.setState(stateWith({
        activeServerId: "srv-1",
        channels: [oldChannel],
        channelsByServerId: { "srv-1": [oldChannel] },
      }));

      useChatStore.getState().dispatch({ type: "UPSERT_CHANNEL", channel: updatedChannel });

      const next = useChatStore.getState();
      expect(next.channels).toEqual([updatedChannel]);
      expect(next.channelsByServerId["srv-1"]).toEqual([updatedChannel]);
    });

    it("upserts an inactive server channel delta without replacing the active view", () => {
      const activeChannel = makeChannel({ id: "active-ch", server_id: "srv-active" });
      const inactiveChannel = makeChannel({ id: "inactive-ch", server_id: "srv-inactive" });

      useChatStore.setState(stateWith({
        activeServerId: "srv-active",
        channels: [activeChannel],
        channelsByServerId: { "srv-active": [activeChannel] },
      }));

      useChatStore.getState().dispatch({ type: "UPSERT_CHANNEL", channel: inactiveChannel });

      const next = useChatStore.getState();
      expect(next.channels).toEqual([activeChannel]);
      expect(next.channelsByServerId["srv-inactive"]).toEqual([inactiveChannel]);
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
