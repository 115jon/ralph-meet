import { beforeEach, describe, expect, it, vi } from "vitest";

// Opening a DM from a profile, a friend row or the picker, against a
// mocked API and pager: nothing here reaches the server.
const api = vi.hoisted(() => ({
  fetchDms: vi.fn(),
  fetchLatestMessage: vi.fn(),
  postDm: vi.fn(),
}));
const openConversation = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock("./api", () => api);
vi.mock("@/features/conversation/store", () => ({ openConversation }));
vi.mock("@/ui", () => ({ showToast: toast }));
vi.mock("@/features/servers/store", () => ({
  isUnread: () => false,
  useServersStore: { getState: () => ({}) },
}));

const { openDmWith } = await import("./actions");
const { useDmsStore } = await import("./store");

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDms.mockResolvedValue([]);
  useDmsStore.setState({
    status: "ready",
    dms: [
      {
        id: "dm-1",
        created_at: "2026-10-01T00:00:00Z",
        recipient: { id: "jm", username: "jm50106001" },
      },
    ],
    previews: {},
  });
});

describe("openDmWith", () => {
  it("opens an existing DM without asking the server", async () => {
    await expect(openDmWith("jm")).resolves.toBe(true);
    expect(api.postDm).not.toHaveBeenCalled();
    expect(openConversation).toHaveBeenCalledWith({ kind: "dm", id: "dm-1" });
  });

  it("creates one with POST /api/dms, opens it and reloads the list", async () => {
    api.postDm.mockResolvedValue({ id: "dm-2" });
    await expect(openDmWith("kai")).resolves.toBe(true);
    expect(api.postDm).toHaveBeenCalledWith("kai");
    expect(openConversation).toHaveBeenCalledWith({ kind: "dm", id: "dm-2" });
    expect(api.fetchDms).toHaveBeenCalled();
  });

  it("says so when the server refuses, and opens nothing", async () => {
    api.postDm.mockRejectedValue(new Error("500"));
    await expect(openDmWith("kai")).resolves.toBe(false);
    expect(openConversation).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ led: "danger" }),
    );
  });
});
