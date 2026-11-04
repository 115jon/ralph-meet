// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialState } from "@/lib/chat-reducer";
import { useChatStore } from "@/stores/chat-store";

import { DMListPanel } from "../DMListPanel";

describe("DMListPanel", () => {
  beforeEach(() => {
    useChatStore.setState(initialState);
  });

  it("renders the profile trigger outside the row trigger", () => {
    renderPanel();

    const profileButton = screen.getByRole("button", {
      name: "View Ada's profile",
    });

    expect(profileButton.parentElement?.closest("button")).toBeNull();
  });

  it("exposes a dedicated row trigger for opening the dm", () => {
    const onSelectDm = vi.fn();

    renderPanel({ onSelectDm });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open DM with Ada",
      }),
    );

    expect(onSelectDm).toHaveBeenCalledWith("dm-1");
  });

  // /api/dms carries users.status, the status the person last chose, not
  // whether they are connected. Only the gateway's presence says that.
  it("shows a recipient who is not connected as offline", () => {
    renderPanel();

    expect(screen.getByRole("img", { name: "Offline" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Online" })).toBeNull();
  });

  it("shows a connected recipient with their live status", () => {
    useChatStore.setState({ onlineUsers: new Set(["user-1"]) });

    renderPanel({ status: "dnd" });

    expect(screen.getByRole("img", { name: "Do not disturb" })).toBeTruthy();
  });
});

function renderPanel({
  onSelectDm = vi.fn(),
  status = "online",
}: {
  onSelectDm?: (channelId: string) => void;
  status?: string;
} = {}) {
  const dispatch = vi.fn();

  return render(
    <DMListPanel
      dmChannels={[
        {
          id: "dm-1",
          name: "Ada",
          recipient: {
            id: "user-1",
            username: "ada",
            display_name: "Ada",
            status,
          },
        },
      ]}
      activeChannelId={null}
      onSelectDm={onSelectDm}
      isUnread={() => false}
      state={{ readStates: {}, lastMessageAt: {} }}
      handleDmContextMenu={vi.fn()}
      dispatch={dispatch}
    />,
  );
}
