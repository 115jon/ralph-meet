// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPost: vi.fn(() => new Promise(() => {})),
  apiPut: vi.fn(() => new Promise(() => {})),
  apiPatch: vi.fn(() => new Promise(() => {})),
  apiDelete: vi.fn(() => new Promise(() => {})),
}));

import { PERMISSIONS } from "@/lib/permissions";
import type { Relationship, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import MobileProfileSheet from "../MobileProfileSheet";

const me = { id: "u-me", username: "me", status: "online" } as User;
const grace = {
  id: "u-grace",
  username: "grace",
  display_name: "Grace",
  status: "online",
} as User;

function seed({
  relationshipType,
  permissions = 0,
}: {
  relationshipType?: number;
  permissions?: number;
} = {}) {
  const relationships: Relationship[] =
    relationshipType === undefined
      ? []
      : [{ user: grace, type: relationshipType, created_at: "" }];
  useChatStore.setState({
    user: me,
    relationships,
    onlineUsers: new Set([grace.id]),
    members: [
      {
        user: me,
        roles: [{ id: "r-1", name: "Mods", permissions, is_default: false }],
      },
    ],
  } as never);
}

function renderSheet(
  user: User = grace,
  extra: Partial<React.ComponentProps<typeof MobileProfileSheet>> = {},
) {
  return render(
    <MobileProfileSheet
      open
      user={user}
      onClose={vi.fn()}
      onOpenProfileEditor={vi.fn()}
      {...extra}
    />,
  );
}

const initialState = useChatStore.getState();

describe("MobileProfileSheet", () => {
  beforeEach(() => {
    useChatStore.setState(initialState, true);
  });
  afterEach(() => {
    cleanup();
  });

  it("offers Call for a friend (type 0)", () => {
    seed({ relationshipType: 0 });
    renderSheet();
    expect(screen.getByRole("button", { name: "Message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Call" })).toBeTruthy();
  });

  it("hides Call for a blocked user (type 1)", () => {
    seed({ relationshipType: 1 });
    renderSheet();
    expect(screen.getByRole("button", { name: "Message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
  });

  it("offers Call when there is no relationship", () => {
    seed();
    renderSheet();
    expect(screen.getByRole("button", { name: "Call" })).toBeTruthy();
  });

  it("shows one Edit profile button on your own sheet", () => {
    seed();
    renderSheet(me);
    expect(
      screen.getAllByRole("button", { name: /edit profile/i }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();
  });

  it("shows kick and ban rows only with the matching permissions", () => {
    seed({ permissions: PERMISSIONS.KICK_MEMBERS });
    renderSheet(grace, { onKick: vi.fn(), onBan: vi.fn() });
    expect(screen.getByRole("button", { name: "Kick" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ban" })).toBeNull();
    expect(screen.queryByText(/note \(only visible to you\)/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
  });
});
