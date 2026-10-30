// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../confirm-dialog";

function Harness({
  onConfirm,
  irreversible = true,
}: {
  onConfirm: () => void | Promise<unknown>;
  irreversible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        forceMode="dialog"
        title="Delete channel"
        description="#general and all of its messages will be deleted."
        confirmLabel="Delete channel"
        irreversible={irreversible}
        errorAction="delete this channel"
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("uses the solid danger button for irreversible actions and closes on success", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog", {
      name: "Delete channel",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Delete channel",
    });
    expect(confirm).toHaveAttribute("data-variant", "danger");

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("closed"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("uses the red tint for reversible actions", async () => {
    render(<Harness onConfirm={vi.fn()} irreversible={false} />);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Delete channel" }),
    ).toHaveAttribute("data-variant", "destructive");
  });

  it("keeps the dialog open with person-facing copy when the request fails", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("D1_ERROR: boom"), { status: 500 }),
      );
    render(<Harness onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete channel" }),
    );

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to delete this channel. Try again in a moment.",
    );
    expect(alert).not.toHaveTextContent("D1_ERROR");
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("Cancel closes without confirming", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("closed"),
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe("Cancel focus ring", () => {
    it("lands on Cancel but hides the ring until a key press on a pointer open", async () => {
      fireEvent.pointerDown(document.body);
      render(<Harness onConfirm={vi.fn()} />);
      const dialog = await screen.findByRole("dialog");
      const cancel = within(dialog).getByRole("button", { name: "Cancel" });
      await waitFor(() => expect(cancel).toHaveFocus());
      expect(dialog).toHaveAttribute("data-pointer-focus");

      // Tab (or any key) hands the ring back, so keyboard users never lose it.
      fireEvent.keyDown(cancel, { key: "Tab" });
      await waitFor(() =>
        expect(dialog).not.toHaveAttribute("data-pointer-focus"),
      );
    });

    it("keeps modifier-only presses from revealing the ring", async () => {
      fireEvent.pointerDown(document.body);
      render(<Harness onConfirm={vi.fn()} />);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveAttribute("data-pointer-focus"));
      fireEvent.keyDown(document.body, { key: "Shift" });
      expect(dialog).toHaveAttribute("data-pointer-focus");
    });

    it("shows the ring at once when the dialog was opened from the keyboard", async () => {
      fireEvent.keyDown(document.body, { key: "Enter" });
      render(<Harness onConfirm={vi.fn()} />);
      const dialog = await screen.findByRole("dialog");
      const cancel = within(dialog).getByRole("button", { name: "Cancel" });
      await waitFor(() => expect(cancel).toHaveFocus());
      expect(dialog).not.toHaveAttribute("data-pointer-focus");
    });
  });
});
