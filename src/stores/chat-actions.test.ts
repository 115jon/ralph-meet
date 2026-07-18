import { initialState, chatReducer, type ChatState } from "@/lib/chat-reducer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatActions } from "./chat-actions";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiDelete: vi.fn(),
  apiGet: mocks.apiGet,
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
    mocks.apiGet.mockReset();
    mocks.apiPut.mockReset();
    mocks.apiGet.mockResolvedValue([]);
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

  it("ignores an older message response after a newer request completes", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mocks.apiGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    let state: ChatState = {
      ...initialState,
      activeChannelId: "channel-1",
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    const first = actions.loadMessages("channel-1");
    const second = actions.loadMessages("channel-1");

    resolveSecond({
      messages: [{ id: "new", created_at: "2026-07-16T00:00:02.000Z" }],
      hasMoreBefore: false,
      hasMoreAfter: false,
    });
    await second;

    resolveFirst({
      messages: [{ id: "old", created_at: "2026-07-16T00:00:01.000Z" }],
      hasMoreBefore: false,
      hasMoreAfter: false,
    });
    await first;

    expect(state.messages.map((message) => message.id)).toEqual(["new"]);
  });

  it("defers non-critical bootstrap requests", async () => {
    const requestedUrls: string[] = [];
    mocks.apiGet.mockImplementation((url: string) => {
      requestedUrls.push(url);
      if (url === "/api/users/me") {
        return Promise.resolve({
          id: "user-1",
          username: "user",
          display_name: "User",
          media_content_filter: "standard",
          theme_sync_enabled: 0,
        });
      }
      if (url === "/api/read-states") {
        return Promise.resolve({ read_states: [], last_messages: [] });
      }
      if (url === "/api/notifications") {
        return Promise.resolve({ notifications: [], unread_count: 0 });
      }
      return Promise.resolve([]);
    });

    let state: ChatState = {
      ...initialState,
      user: { id: "user-1" } as ChatState["user"],
    };
    const actions = createChatActions(
      () => state,
      (action) => {
        state = chatReducer(state, action);
      },
    );

    await actions.bootstrapChat({
      expectedUserId: "user-1",
      deferNonCritical: true,
    });

    expect(requestedUrls).toEqual([
      "/api/users/me",
      "/api/servers",
      "/api/read-states",
    ]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(requestedUrls).toEqual(
      expect.arrayContaining([
        "/api/presence",
        "/api/dms",
        "/api/friends",
        "/api/notifications",
      ]),
    );
  });
});
