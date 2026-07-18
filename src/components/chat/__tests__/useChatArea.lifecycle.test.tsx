// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatArea } from "../useChatArea";

const mocks = vi.hoisted(() => {
  const state = {
    messages: [],
    messagesByChannelId: {},
    messagesLoadedByChannelId: {},
    messageHasMoreBeforeByChannelId: {},
    messageHasMoreAfterByChannelId: {},
    pinnedMessages: [],
    pinsLoadedByChannelId: {},
    loadingPins: false,
    user: { id: "user-1" },
    members: [],
    typingUsers: {},
    channels: [],
    dmChannels: [],
    notifications: [] as Array<{ id: string; is_read: boolean }>,
    activeServerId: "server-1",
    activeChannelId: "channel-1",
    onlineUsers: new Set<string>(),
    scrollPositions: {},
    jumpAnchors: {},
    readStates: {},
  };

  const loadMessages = vi.fn().mockResolvedValue({
    messages: [],
    hasMoreBefore: false,
    hasMoreAfter: false,
  });

  const actions = {
    loadMessages,
    loadMessagesAround: vi.fn(),
    loadMessagesAfter: vi.fn(),
    sendMessage: vi.fn(),
    sendTyping: vi.fn(),
    unpinMessage: vi.fn(),
    pinMessage: vi.fn(),
    loadPins: vi.fn(),
    refreshMessageEmbeds: vi.fn(),
    markChannelRead: vi.fn(),
    markNotificationsRead: vi.fn(),
    dispatch: vi.fn(),
  };

  const useChatStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );

  return { state, actions, loadMessages, useChatStore };
});

vi.mock("@/stores/chat-store", () => ({
  useChatStore: mocks.useChatStore,
  useChatActions: () => mocks.actions,
}));

vi.mock("@/lib/api-client", () => ({ apiPost: vi.fn() }));
vi.mock("@/lib/chat-scroll-debug", () => ({ debugChatScroll: vi.fn() }));
vi.mock("@/lib/display-name", () => ({ getDisplayName: vi.fn() }));
vi.mock("@/lib/gif-picker", () => ({ getGifAttachmentProvider: vi.fn() }));
vi.mock("@/lib/notification-helpers", () => ({
  getUnreadNotificationIdsForMessage: vi.fn(() => []),
}));
vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn(() => true),
  PERMISSIONS: {},
}));
vi.mock("@/lib/reconnect-sound-guard", () => ({
  areReconnectSoundsSuppressed: vi.fn(() => true),
  shouldPlayCurrentChannelMessageSound: vi.fn(() => false),
}));
vi.mock("@/lib/sounds", () => ({ playMessageReceived: vi.fn() }));
vi.mock("@/stores/useSoundSettingsStore", () => ({
  isSoundEnabled: vi.fn(() => false),
}));

describe("useChatArea lifecycle", () => {
  beforeEach(() => {
    mocks.loadMessages.mockClear();
    mocks.state.notifications = [];
  });

  it("does not reload channel history when notifications update", async () => {
    const hook = renderHook(() => useChatArea({ channelId: "channel-1" }));

    await waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalled();
    });
    const loadCountAfterInitialMount = mocks.loadMessages.mock.calls.length;

    act(() => {
      mocks.state.notifications = [{ id: "notification-1", is_read: false }];
      hook.rerender();
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.loadMessages).toHaveBeenCalledTimes(
      loadCountAfterInitialMount,
    );
  });
});
