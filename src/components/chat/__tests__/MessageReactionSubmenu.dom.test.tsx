// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmojiRecentItem } from "@/lib/emoji";

import ContextMenu from "../ContextMenu";
import { MessageReactionSubmenu } from "../MessageReactionSubmenu";

const items = [
  { type: "unicode", id: "👍", label: "Thumbs up", insertText: "👍" },
  { type: "unicode", id: "🎉", label: "Party", insertText: "🎉" },
] as unknown as EmojiRecentItem[];

function renderMenu(handlers: {
  onReact: (item: EmojiRecentItem) => void;
  onViewMore: () => void;
}) {
  render(
    <ContextMenu
      x={10}
      y={10}
      onClose={() => {}}
      items={[
        {
          key: "add-reaction",
          label: "Add reaction",
          icon: <span>r</span>,
          onClick: () => undefined,
          closeOnClick: false,
          submenu: (
            <MessageReactionSubmenu
              items={items}
              customEmojiMap={{}}
              {...handlers}
            />
          ),
        },
      ]}
    />,
  );
}

async function openFlyout() {
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Add reaction" }), {
    key: "ArrowRight",
  });
  return screen.findByRole("menuitem", { name: /Thumbs up/ });
}

describe("MessageReactionSubmenu on the shared menu rows", () => {
  it("renders reactions and View more as menu items inside the flyout", async () => {
    renderMenu({ onReact: vi.fn(), onViewMore: vi.fn() });
    const thumbs = await openFlyout();
    expect(screen.getByRole("menuitem", { name: /Party/ })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "View more" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(thumbs).toHaveFocus());
  });

  it("reacts with the clicked emoji", async () => {
    const onReact = vi.fn();
    renderMenu({ onReact, onViewMore: vi.fn() });
    fireEvent.click(await openFlyout());
    expect(onReact).toHaveBeenCalledWith(items[0]);
  });

  it("opens the full picker from View more", async () => {
    const onViewMore = vi.fn();
    renderMenu({ onReact: vi.fn(), onViewMore });
    await openFlyout();
    fireEvent.click(screen.getByRole("menuitem", { name: "View more" }));
    expect(onViewMore).toHaveBeenCalledTimes(1);
  });
});
