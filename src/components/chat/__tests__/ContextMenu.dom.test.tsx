// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ContextMenu from "../ContextMenu";

describe("ContextMenu", () => {
  it("provides menu semantics, initial focus, and keyboard navigation", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        items={[
          { label: "First", onClick: vi.fn() },
          { label: "Second", onClick: vi.fn() },
        ]}
      />,
    );

    const menu = screen.getByRole("menu");
    const first = screen.getByRole("menuitem", { name: "First" });
    const second = screen.getByRole("menuitem", { name: "Second" });

    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into a submenu and restores it to the parent item", async () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        items={[
          {
            key: "more",
            label: "More",
            onClick: vi.fn(),
            submenu: (
              <div>
                <button type="button" role="menuitem">
                  Sub action
                </button>
              </div>
            ),
          },
        ]}
      />,
    );

    const parent = screen.getByRole("menuitem", { name: "More" });
    expect(parent).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(parent, { key: "ArrowRight" });

    const submenuItem = await screen.findByRole("menuitem", {
      name: "Sub action",
    });
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    await waitFor(() => expect(submenuItem).toHaveFocus());

    fireEvent.keyDown(submenuItem, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menuitem", { name: "Sub action" }),
    ).not.toBeInTheDocument();
    expect(parent).toHaveFocus();
  });

  it("restores focus to the context-menu opener when the menu closes", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open menu
          </button>
          {open ? (
            <ContextMenu
              x={10}
              y={10}
              onClose={() => setOpen(false)}
              items={[{ label: "Action", onClick: () => {} }]}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open menu" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Action" }), {
      key: "Escape",
    });
    expect(opener).toHaveFocus();
  });
});
