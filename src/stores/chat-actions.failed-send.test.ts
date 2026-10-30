// @vitest-environment jsdom
import { initialState, chatReducer, type ChatState } from "@/lib/chat-reducer";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatActions, useFailedSend } from "./chat-actions";

const mocks = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: mocks.apiPost,
  apiPut: vi.fn(),
}));
vi.mock("@/lib/desktop-notifications", () => ({
  getUnreadChannelState: () => ({
    unreadDmChannelIds: [],
    unreadServerChannelIds: [],
  }),
}));
vi.mock("@/lib/desktop-native-sync", () => ({
  syncDesktopNotificationState: vi.fn(),
}));
vi.mock("./useMediaSafetySettingsStore", () => ({
  useMediaSafetySettingsStore: {
    getState: () => ({ hydrateSettings: vi.fn(), setCurrentUser: vi.fn() }),
  },
}));
vi.mock("./useSoundSettingsStore", () => ({
  useSoundSettingsStore: { getState: () => ({ hydrateFromBackend: vi.fn() }) },
}));

function setup() {
  let state: ChatState = {
    ...initialState,
    activeChannelId: "channel-1",
    user: { id: "user-1", username: "jon", display_name: "Jon" } as never,
  };
  const actions = createChatActions(
    () => state,
    (action) => {
      state = chatReducer(state, action);
    },
  );
  return { actions, getState: () => state };
}

describe("failed sends", () => {
  beforeEach(() => {
    mocks.apiPost.mockReset();
  });

  it("keeps the row as Not sent instead of deleting the text", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("offline"));
    const { actions, getState } = setup();

    await actions.sendMessage("channel-1", "hello there");

    const row = getState().messages.at(-1);
    expect(row?.content).toBe("hello there");
    expect(row?.pending).toBe(true);
    const { result } = renderHook(() => useFailedSend(row?.nonce));
    expect(result.current?.content).toBe("hello there");
    expect(result.current?.retrying).toBe(false);
  });

  it("retries with the same nonce and clears the failure on success", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("offline"));
    const { actions, getState } = setup();
    await actions.sendMessage("channel-1", "again");
    const nonce = getState().messages.at(-1)?.nonce;
    const { result, rerender } = renderHook(() => useFailedSend(nonce));

    mocks.apiPost.mockResolvedValueOnce({});
    await result.current!.retry();
    rerender();

    expect(mocks.apiPost).toHaveBeenLastCalledWith(
      "/api/channels/channel-1/messages",
      expect.objectContaining({ content: "again", nonce }),
    );
    expect(result.current).toBeUndefined();
  });

  it("discard removes the row and forgets the failure", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("offline"));
    const { actions, getState } = setup();
    await actions.sendMessage("channel-1", "drop me");
    const nonce = getState().messages.at(-1)?.nonce;
    const { result, rerender } = renderHook(() => useFailedSend(nonce));

    result.current!.discard();
    rerender();

    expect(getState().messages.some((m) => m.nonce === nonce)).toBe(false);
    expect(result.current).toBeUndefined();
  });
});
