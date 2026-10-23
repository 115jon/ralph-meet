// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { DeleteMessageDialog } from "../DeleteMessageDialog";
import { DeleteSoundDialog } from "../DeleteSoundDialog";
import { RemoveEmbedsDialog } from "../RemoveEmbedsDialog";

type DialogRenderer = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) => ReactNode;

function Harness({
  renderDialog,
  onOpenChange,
}: {
  renderDialog: DialogRenderer;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {renderDialog({
        open,
        onOpenChange: (next) => {
          setOpen(next);
          onOpenChange(next);
        },
        onConfirm: () => {},
      })}
    </>
  );
}

const cases: Array<{
  name: string;
  title: string;
  confirmLabel: string;
  render: (onConfirm: () => void) => DialogRenderer;
}> = [
  {
    name: "DeleteMessageDialog",
    title: "Delete Message",
    confirmLabel: "Delete",
    render: (onConfirm) => (props) => (
      <DeleteMessageDialog
        {...props}
        onConfirm={onConfirm}
        preview={<p>Message preview body</p>}
      />
    ),
  },
  {
    name: "RemoveEmbedsDialog",
    title: "Are you sure?",
    confirmLabel: "Remove All Embeds",
    render: (onConfirm) => (props) => (
      <RemoveEmbedsDialog {...props} onConfirm={onConfirm} />
    ),
  },
  {
    name: "DeleteSoundDialog",
    title: "Delete Sound",
    confirmLabel: "Delete",
    render: (onConfirm) => (props) => (
      <DeleteSoundDialog {...props} soundName="Airhorn" onConfirm={onConfirm} />
    ),
  },
];

afterEach(() => {
  cleanup();
});

describe.each(cases)("$name", ({ title, confirmLabel, render: make }) => {
  function setup() {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Harness renderDialog={make(onConfirm)} onOpenChange={onOpenChange} />,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    return { onOpenChange, onConfirm, opener };
  }

  it("renders a labelled confirm dialog with a danger action", async () => {
    setup();
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog.className).toContain("md:max-w-sm");
    const confirm = screen.getByRole("button", { name: confirmLabel });
    expect(confirm).toHaveAttribute("data-variant", "danger");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
  });

  it("calls onConfirm from the confirm button", async () => {
    const { onConfirm } = setup();
    await screen.findByRole("dialog", { name: title });
    fireEvent.click(screen.getByRole("button", { name: confirmLabel }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const { onOpenChange, opener } = setup();
    const dialog = await screen.findByRole("dialog", { name: title });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: title })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes on Cancel and on the back button", async () => {
    const { onOpenChange, opener } = setup();
    await screen.findByRole("dialog", { name: title });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: title });
    act(() => {
      executeBackHandlers();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe("DeleteMessageDialog preview", () => {
  it("renders the preview inert and hidden from assistive tech", async () => {
    render(
      <DeleteMessageDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        preview={<button type="button">Inner action</button>}
      />,
    );
    await screen.findByRole("dialog", { name: "Delete Message" });
    expect(screen.queryByRole("button", { name: "Inner action" })).toBeNull();
    const inner = screen.getByText("Inner action");
    expect(inner.closest("[inert]")).not.toBeNull();
  });
});

describe("DeleteSoundDialog pending state", () => {
  it("shows a busy Delete button while an async confirm runs", async () => {
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <DeleteSoundDialog
        open
        onOpenChange={() => {}}
        soundName="Airhorn"
        soundEmoji={null}
        onConfirm={onConfirm}
      />,
    );
    const confirm = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(confirm).not.toHaveAttribute("aria-busy"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByText("Airhorn")).toBeInTheDocument();
  });
});
