import { initialState, chatReducer, type ChatState } from "@/lib/chat-reducer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatActions } from "./chat-actions";

const mocks = vi.hoisted(() => ({
  apiPut: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: mocks.apiPut,
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
    getState: () => ({
      hydrateSettings: vi.fn(),
      setCurrentUser: vi.fn(),
    }),
  },
}));

vi.mock("./useSoundSettingsStore", () => ({
  useSoundSettingsStore: {
    getState: () => ({
      hydrateFromBackend: vi.fn(),
    }),
  },
}));

describe("chat actions read-state writes", () => {
  beforeEach(() => {
    mocks.apiPut.mockReset();
    mocks.apiPut.mockResolvedValue({});
  });

  it("does not write the same channel read state repeatedly", () => {
    let state: ChatState = {
      ...initialState,
      lastMessageAt: { "channel-1": "2026-07-16T00:00:00.000Z" },
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    actions.markChannelRead("channel-1");
    actions.markChannelRead("channel-1");

    expect(mocks.apiPut).toHaveBeenCalledTimes(1);
  });

  it("writes again when a newer message arrives", async () => {
    let state: ChatState = {
      ...initialState,
      lastMessageAt: { "channel-1": "2026-07-16T00:00:00.000Z" },
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    actions.markChannelRead("channel-1");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    state = {
      ...state,
      lastMessageAt: { "channel-1": "2026-12-31T00:00:00.000Z" },
    };
    actions.markChannelRead("channel-1");

    expect(mocks.apiPut).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after a failed write", async () => {
    mocks.apiPut.mockRejectedValueOnce(new Error("offline"));
    let state: ChatState = {
      ...initialState,
      lastMessageAt: { "channel-1": "2026-07-16T00:00:00.000Z" },
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    actions.markChannelRead("channel-1");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    actions.markChannelRead("channel-1");

    expect(mocks.apiPut).toHaveBeenCalledTimes(2);
  });

  it("coalesces a newer message while a write is pending", async () => {
    let resolvePut!: () => void;
    mocks.apiPut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePut = resolve;
        }),
    );
    let state: ChatState = {
      ...initialState,
      lastMessageAt: { "channel-1": "2026-07-16T00:00:00.000Z" },
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    actions.markChannelRead("channel-1");
    state = {
      ...state,
      lastMessageAt: { "channel-1": "2026-12-31T00:00:00.000Z" },
    };
    actions.markChannelRead("channel-1");
    expect(mocks.apiPut).toHaveBeenCalledTimes(1);

    resolvePut();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mocks.apiPut).toHaveBeenCalledTimes(2);
  });
});
