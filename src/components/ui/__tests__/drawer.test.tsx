// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import { ActionSheet } from "../action-sheet";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "../drawer";
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

  it("keeps the drawer open when onEscapeKeyDown prevents it", () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <DrawerContent onEscapeKeyDown={(event) => event.preventDefault()}>
          <DrawerTitle>Picker</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes from an asChild DrawerClose", () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerTitle>Invite</DrawerTitle>
          <DrawerClose asChild>
            <button type="button">Cancel</button>
          </DrawerClose>
        </DrawerContent>
      </Drawer>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("back closes a nested action sheet before the drawer under it", () => {
    const drawerChange = vi.fn();
    const sheetChange = vi.fn();
    render(
      <Drawer open onOpenChange={drawerChange}>
        <DrawerContent>
          <DrawerTitle>Invite</DrawerTitle>
          <ActionSheet
            open
            onOpenChange={sheetChange}
            title="Invite actions"
            items={[{ label: "Copy link", onClick: () => {} }]}
          />
        </DrawerContent>
      </Drawer>,
    );

    act(() => {
      executeBackHandlers();
    });

    expect(sheetChange).toHaveBeenCalledWith(false);
    expect(drawerChange).not.toHaveBeenCalled();
  });

  it("works above a Radix dialog: keeps focus, Escape closes only the drawer", () => {
    const dialogChange = vi.fn();
    const drawerChange = vi.fn();
    render(
      <Dialog open onOpenChange={dialogChange}>
        <DialogContent>
          <DialogTitle>Set a status</DialogTitle>
          <button type="button">Pick emoji</button>
          <Drawer open onOpenChange={drawerChange}>
            <DrawerContent>
              <DrawerTitle>Emoji</DrawerTitle>
              <input aria-label="Search emoji" />
            </DrawerContent>
          </Drawer>
        </DialogContent>
      </Dialog>,
    );

    const input = screen.getByRole("textbox", { name: "Search emoji" });
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(drawerChange).toHaveBeenCalledWith(false);
    expect(dialogChange).not.toHaveBeenCalled();
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
