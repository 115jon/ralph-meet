// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { groupMenuItems } from "@/components/chat/ContextMenu";
import { groupActionSheetItems } from "@/components/ui/action-sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { modalLayerCount } from "@/components/ui/dialog-stack";
import { ToastCard } from "@/components/ui/toast";

function Stacked() {
  const [inner, setInner] = useState(false);
  return (
    <Dialog open>
      <DialogContent aria-label="Outer">
        <DialogTitle>Outer</DialogTitle>
        <button type="button" onClick={() => setInner(true)}>
          Open inner
        </button>
        <Dialog open={inner} onOpenChange={setInner}>
          <DialogContent aria-label="Inner">
            <DialogTitle>Inner</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

describe("modal layer stack", () => {
  it("gives a dialog opened over another the stacked scrim and recedes the one behind", () => {
    render(<Stacked />);
    const outer = screen.getByRole("dialog", { name: "Outer" });
    expect(outer).not.toHaveAttribute("data-stacked");
    expect(outer).not.toHaveAttribute("data-behind");

    fireEvent.click(screen.getByRole("button", { name: "Open inner" }));
    const inner = screen.getByRole("dialog", { name: "Inner" });

    expect(modalLayerCount()).toBe(2);
    expect(inner).toHaveAttribute("data-stacked");
    expect(outer).toHaveAttribute("data-behind");
    const scrims = document.querySelectorAll('[data-slot="dialog-overlay"]');
    expect(scrims[scrims.length - 1]?.className).toContain("bg-scrim-stacked");
    expect(scrims[0]?.className).not.toContain("bg-scrim-stacked");
  });

  it("puts content dialogs at the top anchor and sizes them from the ladder", () => {
    render(
      <Dialog open>
        <DialogContent size="lg" placement="top" initialFocus="surface">
          <DialogTitle>Profile</DialogTitle>
          <button type="button">Message</button>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Profile" });
    expect(dialog).toHaveAttribute("data-placement", "top");
    expect(dialog.className).toContain("md:max-w-[560px]");
    expect(dialog.className).toContain("top-[max(48px,12vh)]");
    // Content dialogs focus the surface, not their first control.
    expect(dialog).toHaveFocus();
  });
});

describe("menu item model", () => {
  const noop = vi.fn();
  it("moves danger rows into their own last group", () => {
    const groups = groupMenuItems([
      { label: "Delete", variant: "danger", onClick: noop },
      { label: "Mark as read", onClick: noop, divider: true },
      { label: "Copy link", onClick: noop },
    ]);
    expect(groups.map((group) => group.map((item) => item.label))).toEqual([
      ["Mark as read"],
      ["Copy link"],
      ["Delete"],
    ]);
    expect(
      groupActionSheetItems([
        { label: "Delete", variant: "danger", onClick: noop },
        { label: "Reply", onClick: noop },
      ]).map((group) => group.map((item) => item.label)),
    ).toEqual([["Reply"], ["Delete"]]);
  });
});

describe("toast card", () => {
  it("renders an optional action that runs and dismisses", () => {
    const onClick = vi.fn();
    render(
      <ToastCard
        id="t"
        kind="error"
        message="Upload failed"
        action={{ label: "Retry", onClick }}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
