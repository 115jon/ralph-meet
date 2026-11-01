import { describe, expect, it } from "vitest";

import { addFriendError, friendBranches } from "./filters";
import { newDmSections } from "./new-dm";
import { RELATIONSHIP, type Relationship } from "./schema";

function rel(
  username: string,
  type: number,
  display_name?: string,
): Relationship {
  return { user: { id: username, username, display_name }, type };
}

const relationships = [
  rel("xminent", RELATIONSHIP.friend),
  rel("goat", RELATIONSHIP.friend, "goat of goats"),
  rel("jm", RELATIONSHIP.friend),
  rel("kai", RELATIONSHIP.incoming),
  rel("lee", RELATIONSHIP.outgoing),
  rel("troll", RELATIONSHIP.blocked),
];

const online = new Set(["goat", "jm", "kai"]);
const isOnline = (id: string) => online.has(id);

describe("friendBranches", () => {
  it("Online lists friends who are connected, by name", () => {
    const [branch] = friendBranches(relationships, "online", "", isOnline);
    expect(branch?.rows.map((r) => r.user.id)).toEqual(["goat", "jm"]);
  });

  it("All lists every friend", () => {
    const [branch] = friendBranches(relationships, "all", "", isOnline);
    expect(branch?.rows.map((r) => r.user.id)).toEqual([
      "goat",
      "jm",
      "xminent",
    ]);
  });

  it("Pending splits Incoming from Sent", () => {
    const branches = friendBranches(relationships, "pending", "", isOnline);
    expect(
      branches.map((b) => [b.label, b.rows.map((r) => r.user.id)]),
    ).toEqual([
      ["Incoming", ["kai"]],
      ["Sent", ["lee"]],
    ]);
  });

  it("Blocked lists blocks only", () => {
    const [branch] = friendBranches(relationships, "blocked", "", isOnline);
    expect(branch?.rows.map((r) => r.user.id)).toEqual(["troll"]);
  });

  it("searches display names and usernames", () => {
    const [branch] = friendBranches(relationships, "all", " GOATS ", isOnline);
    expect(branch?.rows.map((r) => r.user.id)).toEqual(["goat"]);
  });
});

describe("addFriendError", () => {
  it("names each refusal in the person's terms", () => {
    expect(addFriendError(404)).toMatch(/No one has that username/);
    expect(addFriendError(400)).toMatch(/yourself/);
    expect(addFriendError(409)).toMatch(/already friends/);
    expect(addFriendError(null)).toMatch(/connection/);
  });
});

describe("newDmSections", () => {
  const serverPeople = [
    { id: "xavier", username: "xavier" },
    { id: "goat", username: "goat" },
    { id: "me", username: "me" },
    { id: "troll", username: "troll" },
    { id: "zed", username: "zed" },
  ];
  const recent = [
    { id: "jm", username: "jm" },
    { id: "zed", username: "zed" },
  ];

  it("shows each person once (friend, then recent, then server), never you or someone blocked", () => {
    const sections = newDmSections({
      relationships,
      serverPeople,
      recent,
      myId: "me",
      query: "",
    });
    expect(sections.map((s) => [s.key, s.people.map((p) => p.id)])).toEqual([
      ["friends", ["goat", "jm", "xminent"]],
      ["servers", ["xavier"]],
      ["recent", ["zed"]],
    ]);
  });

  it("filters every list by the search and drops empty ones", () => {
    const sections = newDmSections({
      relationships,
      serverPeople,
      recent,
      myId: "me",
      query: "x",
    });
    expect(sections.map((s) => [s.key, s.people.map((p) => p.id)])).toEqual([
      ["friends", ["xminent"]],
      ["servers", ["xavier"]],
    ]);
  });
});
