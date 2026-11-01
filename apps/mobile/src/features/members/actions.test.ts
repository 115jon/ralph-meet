import { beforeEach, describe, expect, it, vi } from "vitest";

// Member list loading, gateway updates and moderation against a mocked
// API: nothing here reaches the server.
const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiJson: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => api);
vi.mock("@/ui", () => ({ showToast: toast }));

const actions = await import("./actions");
const { resetMembersStore, useMembersStore } = await import("./store");

const jon = { user: { id: "jon", username: "jon" }, roles: [] };
const kai = { user: { id: "kai", username: "kai" }, roles: [] };

function ids(serverId: string) {
  return useMembersStore.getState().members[serverId]?.map((m) => m.user.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMembersStore();
});

describe("loadMembers", () => {
  it("fetches once, then serves the cache until forced", async () => {
    api.apiJson.mockResolvedValue([jon, kai]);
    await actions.loadMembers("s1");
    await actions.loadMembers("s1");
    expect(api.apiJson).toHaveBeenCalledTimes(1);
    expect(api.apiJson.mock.calls[0]?.[0]).toBe("/api/servers/s1/members");
    expect(ids("s1")).toEqual(["jon", "kai"]);
    expect(useMembersStore.getState().authors.s1?.[1]?.username).toBe("kai");
    await actions.loadMembers("s1", { force: true });
    expect(api.apiJson).toHaveBeenCalledTimes(2);
  });

  it("shares one request between callers", async () => {
    api.apiJson.mockResolvedValue([jon]);
    await Promise.all([actions.loadMembers("s1"), actions.loadMembers("s1")]);
    expect(api.apiJson).toHaveBeenCalledTimes(1);
  });
});

describe("gateway events", () => {
  beforeEach(async () => {
    api.apiJson.mockResolvedValue([jon]);
    await actions.loadMembers("s1");
  });

  it("adds, re-roles and removes members of a loaded list", () => {
    actions.addMember("s1", kai.user, []);
    expect(ids("s1")).toEqual(["jon", "kai"]);
    actions.setMemberRoles("s1", "kai", [
      { id: "r", name: "Mod", position: 3 },
    ]);
    const roles = useMembersStore.getState().members.s1?.[1]?.roles;
    expect(roles?.[0]?.name).toBe("Mod");
    actions.removeMember("s1", "kai");
    expect(ids("s1")).toEqual(["jon"]);
  });

  it("ignores servers whose list never loaded", () => {
    actions.addMember("s2", kai.user, []);
    expect(ids("s2")).toBeUndefined();
  });

  it("renames a person in every list", () => {
    actions.patchMemberProfile({ user_id: "jon", display_name: "Jonathan" });
    expect(useMembersStore.getState().authors.s1?.[0]?.display_name).toBe(
      "Jonathan",
    );
  });
});

describe("moderation", () => {
  beforeEach(async () => {
    api.apiJson.mockResolvedValue([jon, kai]);
    await actions.loadMembers("s1");
  });

  it("kicks with DELETE and drops the row", async () => {
    api.apiFetch.mockResolvedValue({ ok: true });
    await actions.kickMember("s1", "kai", "kai");
    expect(api.apiFetch).toHaveBeenCalledWith("/api/servers/s1/members/kai", {
      method: "DELETE",
    });
    expect(ids("s1")).toEqual(["jon"]);
  });

  it("bans with POST /bans and keeps the row when refused", async () => {
    api.apiFetch.mockResolvedValue({ ok: false, status: 403 });
    await actions.banMember("s1", "kai", "kai");
    const [path, init] = api.apiFetch.mock.calls[0] ?? [];
    expect(path).toBe("/api/servers/s1/bans");
    expect(init).toMatchObject({ method: "POST", body: '{"user_id":"kai"}' });
    expect(ids("s1")).toEqual(["jon", "kai"]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ led: "danger" }),
    );
  });
});
