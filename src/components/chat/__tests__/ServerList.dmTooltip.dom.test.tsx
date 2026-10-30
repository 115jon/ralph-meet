// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ServerList from "../ServerList";

function renderRail() {
  const onSelectDm = vi.fn();
  render(
    <ServerList
      servers={[]}
      activeServerId={null}
      onSelect={() => {}}
      unreadDms={[
        {
          channelId: "dm-1",
          recipient: {
            id: "u1",
            username: "alice",
            display_name: "Alice Doe",
            avatar_url: null,
          },
          unreadCount: 2,
        },
      ]}
      onSelectDm={onSelectDm}
    />,
  );
  return { onSelectDm };
}

describe("ServerList DM rail button", () => {
  it("is named by the display name and still selects the DM", () => {
    const { onSelectDm } = renderRail();
    const button = screen.getByRole("button", { name: "Alice Doe" });
    fireEvent.click(button);
    expect(onSelectDm).toHaveBeenCalledWith("dm-1");
  });

  it("shows the stock tooltip on keyboard focus", async () => {
    renderRail();
    const button = screen.getByRole("button", { name: "Alice Doe" });
    act(() => button.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Alice Doe");
    expect(
      document.querySelector('[data-slot="tooltip-content"]'),
    ).toHaveAttribute("data-side", "right");
  });

  it("shows the tooltip on hover", async () => {
    renderRail();
    const button = screen.getByRole("button", { name: "Alice Doe" });
    fireEvent.pointerMove(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Alice Doe");
  });
});
