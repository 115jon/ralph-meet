// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { MenuItem, SubMenuItem } from "./ContextMenuItems";

function getSubmenu(): HTMLElement {
  const submenu = screen.getAllByRole("menu")[1];
  if (!submenu) throw new Error("Expected a rendered submenu");
  return submenu;
}

function TestSubmenu({ disabledOnly = false }: { disabledOnly?: boolean }) {
  const [active, setActive] = useState(false);

  return (
    <div role="menu">
      <SubMenuItem
        label="More options"
        active={active}
        onMouseEnter={() => setActive(true)}
        onArrowLeft={() => setActive(false)}
        submenu={
          disabledOnly ? (
            <MenuItem label="Unavailable" disabled />
          ) : (
            <MenuItem label="Available action" />
          )
        }
      />
    </div>
  );
}

describe("ContextMenuItems submenu keyboard behavior", () => {
  it("closes from ArrowLeft at the shared submenu level and restores trigger focus", async () => {
    render(<TestSubmenu />);

    const trigger = screen.getByRole("menuitem", { name: "More options" });
    fireEvent.keyDown(trigger, { key: "ArrowRight" });

    await screen.findByRole("menuitem", { name: "Available action" });
    const submenu = getSubmenu();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Available action" }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(submenu, { key: "ArrowLeft" });

    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(trigger).toHaveFocus();
  });

  it("focuses the submenu container and closes disabled-only submenus with ArrowLeft", async () => {
    render(<TestSubmenu disabledOnly />);

    const trigger = screen.getByRole("menuitem", { name: "More options" });
    fireEvent.keyDown(trigger, { key: "ArrowRight" });

    await screen.findByRole("menuitem", { name: "Unavailable" });
    const submenu = getSubmenu();
    await waitFor(() => expect(submenu).toHaveFocus());

    fireEvent.keyDown(submenu, { key: "ArrowLeft" });

    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(trigger).toHaveFocus();
  });
});
