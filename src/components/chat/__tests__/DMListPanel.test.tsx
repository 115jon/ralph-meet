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
});

function renderPanel({
  onSelectDm = vi.fn(),
}: {
  onSelectDm?: (channelId: string) => void;
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
            status: "online",
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
