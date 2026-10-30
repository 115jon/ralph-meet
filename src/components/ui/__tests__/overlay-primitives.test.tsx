// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { Popover, PopoverContent } from "../popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../sheet";
import { SidePanel, type SidePanelMode } from "../side-panel";

function Opener({
  children,
}: {
  children: (open: boolean, setOpen: (o: boolean) => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {children(open, setOpen)}
    </>
  );
}

describe("Sheet", () => {
  it("closes on Escape and on back, and returns focus to the opener", async () => {
    const onOpenChange = vi.fn();
    render(
      <Opener>
        {(open, setOpen) => (
          <Sheet
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              onOpenChange(next);
            }}
          >
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Pinned messages</SheetTitle>
              </SheetHeader>
              <button type="button">Inside</button>
            </SheetContent>
          </Sheet>
        )}
      </Opener>,
    );

    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    expect(sheet.className).toContain("w-[360px]");

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));

    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Pinned messages" });
    act(() => {
      executeBackHandlers();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

function Panel({
  mode,
  onOpenChange,
}: {
  mode: SidePanelMode;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      title="Thread"
      forceMode={mode}
    >
      <p>Body</p>
    </SidePanel>
  );
}

describe("SidePanel", () => {
  it.each<SidePanelMode>(["dock", "sheet", "drawer"])(
    "%s: names itself after the title and closes from its header",
    async (mode) => {
      const onOpenChange = vi.fn();
      render(<Panel mode={mode} onOpenChange={onOpenChange} />);

      const region =
        mode === "dock"
          ? screen.getByRole("complementary", { name: "Thread" })
          : await screen.findByRole("dialog", { name: "Thread" });
      expect(region).toHaveTextContent("Body");

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it.each<SidePanelMode>(["dock", "sheet", "drawer"])(
    "%s: the back button closes it",
    async (mode) => {
      const onOpenChange = vi.fn();
      render(<Panel mode={mode} onOpenChange={onOpenChange} />);
      if (mode !== "dock") await screen.findByRole("dialog");

      act(() => {
        executeBackHandlers();
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it("sheet: Escape closes it", async () => {
    const onOpenChange = vi.fn();
    render(<Panel mode="sheet" onOpenChange={onOpenChange} />);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

function AnchoredPopover({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  return (
    <>
      <button type="button" ref={anchorRef} onClick={() => change(!open)}>
        Account
      </button>
      <Popover open={open} onOpenChange={change}>
        <PopoverContent anchor={anchorRef} aria-label="Account menu">
          <button type="button">Set status</button>
        </PopoverContent>
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("portals a labelled panel and closes on Escape and back", async () => {
    const onOpenChange = vi.fn();
    render(<AnchoredPopover onOpenChange={onOpenChange} />);
    const anchor = screen.getByRole("button", { name: "Account" });

    fireEvent.click(anchor);
    const panel = await screen.findByRole("dialog", { name: "Account menu" });
    expect(panel.closest("[data-rm-floating-layer]")).not.toBeNull();

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(anchor);
    await screen.findByRole("dialog", { name: "Account menu" });
    act(() => {
      executeBackHandlers();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("a press on the anchor toggles it closed instead of reopening", async () => {
    const onOpenChange = vi.fn();
    render(<AnchoredPopover onOpenChange={onOpenChange} />);
    const anchor = screen.getByRole("button", { name: "Account" });

    fireEvent.click(anchor);
    await screen.findByRole("dialog", { name: "Account menu" });
    fireEvent.pointerDown(anchor);
    fireEvent.mouseDown(anchor);
    fireEvent.click(anchor);

    expect(onOpenChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it("Escape inside a popover over a dialog closes only the popover", async () => {
    const dialogChange = vi.fn();
    const popoverChange = vi.fn();
    function Stack() {
      const [popover, setPopover] = useState(true);
      return (
        <Dialog open onOpenChange={dialogChange}>
          <DialogContent>
            <DialogTitle>Viewer</DialogTitle>
            <Popover
              open={popover}
              onOpenChange={(next) => {
                setPopover(next);
                popoverChange(next);
              }}
            >
              <PopoverContent aria-label="More" stacked>
                <button type="button">Copy link</button>
              </PopoverContent>
            </Popover>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Stack />);
    const panel = await screen.findByRole("dialog", { name: "More" });

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(popoverChange).toHaveBeenCalledWith(false);
    expect(dialogChange).not.toHaveBeenCalled();
  });
});

describe("DropdownMenu", () => {
  it("opens from its trigger, runs an item, and returns focus", async () => {
    const onCopy = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" />}>
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onCopy}>Copy link</DropdownMenuItem>
          <DropdownMenuItem variant="danger">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    const item = await screen.findByRole("menuitem", { name: "Copy link" });
    expect(item.className).toContain("min-h-9");

    fireEvent.click(item);
    expect(onCopy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("closes on the back button", async () => {
    const onOpenChange = vi.fn();
    render(
      <DropdownMenu defaultOpen onOpenChange={onOpenChange}>
        <DropdownMenuTrigger render={<button type="button" />}>
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy link</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await screen.findByRole("menu");
    act(() => {
      executeBackHandlers();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
