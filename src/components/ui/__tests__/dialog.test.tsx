// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
} from "../dialog";

function DialogHarness() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Edit profile</button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>Update your account profile.</DialogDescription>
        <DialogClose asChild>
          <button type="button">Save profile</button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function ControlledHarness() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent forceMount data-testid="controlled-content">
        <DialogTitle>Controlled dialog</DialogTitle>
        <DialogDescription>Controlled description.</DialogDescription>
        <button type="button" onClick={() => setOpen(false)}>
          Close controlled
        </button>
      </DialogContent>
    </Dialog>
  );
}

function UncontrolledHarness() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Uncontrolled dialog</DialogTitle>
        <DialogDescription>
          Dialog opened from its default state.
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function NoTriggerHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open without trigger
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Dialog without trigger</DialogTitle>
          <DialogDescription>Opened by external state.</DialogDescription>
          <button type="button" onClick={() => setOpen(false)}>
            Close without trigger
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NestedOpenHarness({
  onOuterChange,
  onInnerChange,
}: {
  onOuterChange: (open: boolean) => void;
  onInnerChange: (open: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOuterChange}>
      <DialogContent>
        <DialogTitle>Outer dialog</DialogTitle>
        <DialogDescription>Outer dialog content.</DialogDescription>
        <Dialog open onOpenChange={onInnerChange}>
          <DialogContent>
            <DialogTitle>Inner dialog</DialogTitle>
            <DialogDescription>Inner dialog content.</DialogDescription>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function PayloadOwnerHarness() {
  const [open, setOpen] = useState(true);
  const [serverId] = useState("server-1");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        forceMount
        data-testid="payload-content"
        data-payload={serverId}
      >
        <DialogTitle>Server settings</DialogTitle>
        <DialogDescription>Settings for {serverId}.</DialogDescription>
        <button type="button" onClick={() => setOpen(false)}>
          Close server settings
        </button>
      </DialogContent>
    </Dialog>
  );
}

function SurfaceHarness() {
  return (
    <Dialog open>
      <DialogPortal>
        <div data-testid="surface-wrapper">
          <DialogSurface data-testid="surface-content" showCloseButton={false}>
            <DialogTitle>Floating surface</DialogTitle>
            <DialogDescription>Surface description.</DialogDescription>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

describe("shadcn Dialog composition", () => {
  it("opens a nested dialog from its trigger and restores focus on close", async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Edit profile" });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps controlled content mounted with a closed data-state", () => {
    render(<ControlledHarness />);
    const content = screen.getByTestId("controlled-content");

    expect(content).toHaveAttribute("data-state", "open");
    fireEvent.click(screen.getByRole("button", { name: "Close controlled" }));

    expect(content).toHaveAttribute("data-state", "closed");
    expect(content).not.toBeVisible();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it("retains a payload-backed owner while its dialog closes", () => {
    render(<PayloadOwnerHarness />);
    const content = screen.getByTestId("payload-content");

    fireEvent.click(
      screen.getByRole("button", { name: "Close server settings" }),
    );

    expect(content).toHaveAttribute("data-state", "closed");
    expect(content).toHaveAttribute("data-payload", "server-1");
  });

  it("keeps custom surfaces local to an explicit dialog portal", () => {
    render(<SurfaceHarness />);

    const wrapper = screen.getByTestId("surface-wrapper");
    expect(wrapper).toContainElement(screen.getByTestId("surface-content"));
    expect(screen.getByTestId("surface-content")).not.toHaveClass("fixed");
  });

  it("keeps custom portal layers interactive outside the dialog surface", () => {
    render(
      <Dialog open>
        <DialogPortal>
          <button type="button">Close from the portal layer</button>
        </DialogPortal>
      </Dialog>,
    );

    const portalRoot = screen
      .getByRole("button", { name: "Close from the portal layer" })
      .closest('[data-slot="dialog-portal-root"]');
    expect(portalRoot).toHaveClass("pointer-events-auto");
  });

  it("restores focus for a dialog opened without a DialogTrigger", async () => {
    render(<NoTriggerHarness />);
    const opener = screen.getByRole("button", { name: "Open without trigger" });

    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(
      screen.getByRole("button", { name: "Close without trigger" }),
    );

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes the active dialog from the browser back button", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Back button dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.popState(window);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes an uncontrolled dialog from the browser back button", async () => {
    render(<UncontrolledHarness />);

    expect(
      screen.getByRole("dialog", { name: "Uncontrolled dialog" }),
    ).toBeVisible();

    fireEvent.popState(window);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Uncontrolled dialog" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not claim the browser back button for non-modal roots", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open modal={false} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Non-modal dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.popState(window);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("allows an explicitly opted-in non-modal root to handle browser back", () => {
    const onBackButton = vi.fn();
    render(
      <Dialog open modal={false} onBackButton={onBackButton}>
        <DialogContent>
          <DialogTitle>Floating picker</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.popState(window);

    expect(onBackButton).toHaveBeenCalledOnce();
  });

  it("closes only the topmost dialog when nested roots start open", () => {
    const onOuterChange = vi.fn();
    const onInnerChange = vi.fn();
    render(
      <NestedOpenHarness
        onOuterChange={onOuterChange}
        onInnerChange={onInnerChange}
      />,
    );

    fireEvent.popState(window);

    expect(onInnerChange).toHaveBeenCalledWith(false);
    expect(onOuterChange).not.toHaveBeenCalled();
  });
});
