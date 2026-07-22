// @vitest-environment jsdom

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: {
    "user-1": { username: "alex", displayName: "Alex" },
    "user-2": { username: "sam", displayName: "Sam" },
  } as Record<string, { username: string; displayName: string }>,
}));

vi.mock("@/components/ui/BaseModal", () => ({
  BaseModal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: (userId?: string | null) =>
    mocks.users[userId ?? ""] ?? {
      username: "unknown",
      displayName: "Unknown",
      avatarUrl: null,
      avatarDisplay: null,
    },
}));

import ReactionDetailsModal from "../ReactionDetailsModal";

function makeMessage(
  reactions: Array<{
    emoji: string;
    count: number;
    users: string[];
  }>,
) {
  return {
    id: "message-1",
    channel_id: "channel-1",
    author_id: "user-1",
    content: "Hello",
    is_pinned: false,
    created_at: "2026-07-22T00:00:00.000Z",
    reactions: reactions.map((reaction) => ({ ...reaction, me: false })),
  };
}

describe("ReactionDetailsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists users for the selected emoji and exposes manager removal controls", () => {
    const onRemoveReaction = vi.fn();

    render(
      <ReactionDetailsModal
        message={makeMessage([
          { emoji: "👍", count: 2, users: ["user-1", "user-2"] },
          { emoji: "❤️", count: 1, users: ["user-2"] },
        ])}
        initialEmoji="👍"
        canManageReactions
        customEmojiMap={{}}
        onRemoveReaction={onRemoveReaction}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Reactions" })).toBeVisible();
    expect(screen.getByText("Alex")).toBeVisible();
    expect(screen.getByText("Sam")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove reaction from Alex" }),
    );

    expect(onRemoveReaction).toHaveBeenCalledWith("👍", "user-1");
  });

  it("closes after the last reaction group disappears", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ReactionDetailsModal
        message={makeMessage([{ emoji: "👍", count: 1, users: ["user-1"] }])}
        initialEmoji="👍"
        canManageReactions={false}
        customEmojiMap={{}}
        onRemoveReaction={vi.fn()}
        onClose={onClose}
      />,
    );

    rerender(
      <ReactionDetailsModal
        message={makeMessage([])}
        initialEmoji="👍"
        canManageReactions={false}
        customEmojiMap={{}}
        onRemoveReaction={vi.fn()}
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("switches groups and falls back when the selected group disappears", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ReactionDetailsModal
        message={makeMessage([
          { emoji: "👍", count: 1, users: ["user-1"] },
          { emoji: "❤️", count: 1, users: ["user-2"] },
        ])}
        initialEmoji="👍"
        canManageReactions={false}
        customEmojiMap={{}}
        onRemoveReaction={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "❤️ 1" }));
    expect(screen.getByRole("button", { name: "❤️ 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerender(
      <ReactionDetailsModal
        message={makeMessage([{ emoji: "👍", count: 1, users: ["user-1"] }])}
        initialEmoji="❤️"
        canManageReactions={false}
        customEmojiMap={{}}
        onRemoveReaction={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("button", { name: "👍 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
