// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import { Drawer, DrawerContent, DrawerTitle } from "../drawer";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "../responsive-dialog";

function ControlledDrawer({
  onOpenChange,
}: {
  onOpenChange: (o: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
    >
      <DrawerContent>
        <DrawerTitle>Reply options</DrawerTitle>
        <button type="button">Reply</button>
      </DrawerContent>
    </Drawer>
  );
}

describe("Drawer", () => {
  it("labels itself and closes on the hardware/browser back button", () => {
    const onOpenChange = vi.fn();
    render(<ControlledDrawer onOpenChange={onOpenChange} />);

    expect(
      screen.getByRole("dialog", { name: "Reply options" }),
    ).toBeInTheDocument();

    act(() => {
      executeBackHandlers();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(<ControlledDrawer onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("only the topmost surface answers back when a dialog opens over it", () => {
    const drawerChange = vi.fn();
    const dialogChange = vi.fn();
    render(
      <>
        <Drawer open onOpenChange={drawerChange}>
          <DrawerContent>
            <DrawerTitle>Under</DrawerTitle>
          </DrawerContent>
        </Drawer>
        <Dialog open onOpenChange={dialogChange}>
          <DialogContent>
            <DialogTitle>Over</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    );

    act(() => {
      executeBackHandlers();
    });

    expect(dialogChange).toHaveBeenCalledWith(false);
    expect(drawerChange).not.toHaveBeenCalled();
  });

  it("gives an untitled drawer an accessible name", () => {
    render(
      <Drawer open>
        <DrawerContent aria-label="Message actions">
          <p>Body</p>
        </DrawerContent>
      </Drawer>,
    );
    expect(
      screen.getByRole("dialog", { name: "Message actions" }),
    ).toBeInTheDocument();
  });
});

describe("ResponsiveDialog", () => {
  it("renders a drawer when forced to the phone form", () => {
    render(
      <ResponsiveDialog open forceMode="drawer">
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Invite</ResponsiveDialogTitle>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Invite" })).toHaveAttribute(
      "data-slot",
      "drawer-content",
    );
  });

  it("renders a centered dialog on desktop", () => {
    render(
      <ResponsiveDialog open forceMode="dialog">
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Invite</ResponsiveDialogTitle>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Invite" })).toHaveAttribute(
      "data-slot",
      "dialog-content",
    );
  });
});
