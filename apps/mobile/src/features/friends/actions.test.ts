import { beforeEach, describe, expect, it, vi } from "vitest";

// The write paths, against a mocked API: nothing here reaches the server.
const api = vi.hoisted(() => ({
  fetchRelationships: vi.fn(),
  postFriendRequest: vi.fn(),
  putAccept: vi.fn(),
  putBlock: vi.fn(),
  deleteRelationship: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("./api", () => api);
vi.mock("@/ui", () => ({ showToast: toast }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super(String(status));
    }
  },
}));

const { ApiError } = await import("@/lib/api");
const actions = await import("./actions");
const { useFriendsStore } = await import("./store");
const { RELATIONSHIP } = await import("./schema");

const kai = { id: "kai", username: "kai" };
const lee = { id: "lee", username: "lee", display_name: "Lee" };

function types() {
  return Object.fromEntries(
    useFriendsStore.getState().relationships.map((r) => [r.user.id, r.type]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useFriendsStore.setState({
    status: "ready",
    relationships: [
      { user: kai, type: RELATIONSHIP.incoming },
      { user: lee, type: RELATIONSHIP.friend },
    ],
  });
});

describe("sendFriendRequest", () => {
  it("adds the sent request and confirms with a toast", async () => {
    api.postFriendRequest.mockResolvedValue({
      user: { id: "jm", username: "jm50106001" },
      type: RELATIONSHIP.outgoing,
    });
    const outcome = await actions.sendFriendRequest("  jm50106001 ");
    expect(api.postFriendRequest).toHaveBeenCalledWith("jm50106001");
    expect(outcome).toEqual({ ok: true, accepted: false });
    expect(types().jm).toBe(RELATIONSHIP.outgoing);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Request sent to jm50106001" }),
    );
  });

  it("returns the refusal in the person's terms and changes nothing", async () => {
    api.postFriendRequest.mockRejectedValue(new ApiError(404, "/api/friends"));
    const outcome = await actions.sendFriendRequest("nobody");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toMatch(/No one has that username/);
    expect(Object.keys(types())).toEqual(["kai", "lee"]);
  });
});

describe("optimistic changes", () => {
  it("accepting shows the friend at once", async () => {
    api.putAccept.mockResolvedValue(undefined);
    const pending = actions.acceptFriend(kai);
    expect(types().kai).toBe(RELATIONSHIP.friend);
    await expect(pending).resolves.toBe(true);
    expect(api.putAccept).toHaveBeenCalledWith("kai");
  });

  it("a refused accept puts the request back and says so", async () => {
    api.putAccept.mockRejectedValue(new Error("500"));
    await expect(actions.acceptFriend(kai)).resolves.toBe(false);
    expect(types().kai).toBe(RELATIONSHIP.incoming);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ led: "danger" }),
    );
  });

  it("removing drops the row, and a refusal restores it", async () => {
    api.deleteRelationship.mockRejectedValue(new Error("500"));
    const pending = actions.removeRelationship(lee);
    expect(types().lee).toBeUndefined();
    await pending;
    expect(types().lee).toBe(RELATIONSHIP.friend);
  });

  it("blocking marks them blocked", async () => {
    api.putBlock.mockResolvedValue(undefined);
    await actions.blockUser(lee);
    expect(api.putBlock).toHaveBeenCalledWith("lee");
    expect(types().lee).toBe(RELATIONSHIP.blocked);
  });
});

describe("gateway events", () => {
  it("RELATIONSHIP_ADD replaces the person's row and puts it first", () => {
    actions.upsertRelationship({ user: lee, type: RELATIONSHIP.blocked });
    const rows = useFriendsStore.getState().relationships;
    expect(rows[0]).toMatchObject({ user: lee, type: RELATIONSHIP.blocked });
    expect(rows).toHaveLength(2);
  });

  it("RELATIONSHIP_REMOVE drops it", () => {
    actions.dropRelationship("kai");
    expect(Object.keys(types())).toEqual(["lee"]);
  });
});
