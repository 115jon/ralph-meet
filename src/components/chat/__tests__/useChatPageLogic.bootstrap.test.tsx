// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatPageLogic } from "../useChatPageLogic";

const mocks = vi.hoisted(() => {
  const state = {
    user: null,
    servers: [],
    activeServerId: null,
    activeChannelId: null,
    channels: [],
    dmChannels: [],
  };

  const actions = {
    bootstrapChat: vi.fn().mockResolvedValue(undefined),
    loadChannels: vi.fn(),
    loadMembers: vi.fn(),
    subscribeChannel: vi.fn(),
    unsubscribeChannel: vi.fn(),
    subscribeServer: vi.fn(),
    resetReadStateTracking: vi.fn(),
    setProfileUser: vi.fn(),
    dispatch: vi.fn(),
  };

  return { state, actions };
});

vi.mock("@/lib/desktop-auth", () => ({
  getDesktopToken: vi.fn(() => null),
}));

vi.mock("@/lib/platform", () => ({ isTauri: vi.fn(() => false) }));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: typeof mocks.state) => unknown) =>
    selector(mocks.state),
  useChatActions: () => mocks.actions,
}));

vi.mock("@/stores/useCallStore", () => ({
  useCallStore: {
    getState: vi.fn(() => ({ status: "idle", endCall: vi.fn() })),
  },
}));

vi.mock("@kova/react", () => ({
  useUser: vi.fn(() => ({ user: { id: "user-1" } })),
}));

describe("useChatPageLogic bootstrap", () => {
  beforeEach(() => {
    mocks.actions.bootstrapChat.mockClear();
    window.history.replaceState(null, "", "/chat");
  });

  it("starts bootstrap once under React StrictMode", async () => {
    function Wrapper({ children }: PropsWithChildren) {
      return <StrictMode>{children}</StrictMode>;
    }

    renderHook(() => useChatPageLogic(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(mocks.actions.bootstrapChat).toHaveBeenCalledOnce();
    });
  });
});
