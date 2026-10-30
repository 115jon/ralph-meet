// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { executeBackHandlers } from "@/hooks/useBackButton";
import { PinnedMessagesSidebar } from "../PinnedMessagesSidebar";

vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: () => ({
    displayName: "Linus",
    username: "linus",
    avatarUrl: null,
  }),
}));

const render = (ui: React.ReactElement) =>
  rtlRender(ui, { wrapper: TooltipProvider });

const message = {
  id: "m-1",
  channel_id: "ch-1",
  author_id: "u-1",
  content: "Ship it",
  is_pinned: true,
  created_at: "2026-10-22T14:00:00Z",
} as never;

function Host({
  mode,
  onClose,
  onJump = () => {},
  messages = [message],
  isLoading = false,
}: {
  mode: "sheet" | "drawer" | "dock";
  onClose: () => void;
  onJump?: (id: string) => void;
  messages?: never[];
  isLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Pins
      </button>
      <PinnedMessagesSidebar
        open={open}
        messages={messages}
        isLoading={isLoading}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        onJumpToMessage={onJump}
        onUnpin={() => {}}
        canUnpin
        forceMode={mode}
      />
    </>
  );
}

describe("PinnedMessagesSidebar", () => {
  it("as a sheet: Escape closes it and focus returns to the opener", async () => {
    const onClose = vi.fn();
    render(<Host mode="sheet" onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Pins" });
    opener.focus();
    fireEvent.click(opener);

    const panel = await screen.findByRole("dialog", {
      name: "Pinned messages",
    });
    expect(panel).toHaveTextContent("Ship it");

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("as a phone drawer: the back button closes it", async () => {
    const onClose = vi.fn();
    render(<Host mode="drawer" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Pins" }));
    await screen.findByRole("dialog", { name: "Pinned messages" });

    act(() => {
      executeBackHandlers();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("docked: Jump runs and the header closes it", async () => {
    const onClose = vi.fn();
    const onJump = vi.fn();
    render(<Host mode="dock" onClose={onClose} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "Pins" }));

    const region = screen.getByRole("complementary", {
      name: "Pinned messages",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Jump to message from Linus: Ship it",
      }),
    );
    expect(onJump).toHaveBeenCalledWith("m-1");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(region).not.toBeInTheDocument();
  });

  it("names every row's Jump and Unpin keys after its author and text", () => {
    const second = {
      ...(message as object),
      id: "m-2",
      content: "x".repeat(80),
    } as never;
    const attachmentOnly = {
      ...(message as object),
      id: "m-3",
      content: "",
      attachments: [{ id: "a", filename: "a.png", content_type: "text/plain" }],
    } as never;
    render(
      <PinnedMessagesSidebar
        open
        messages={[message, second, attachmentOnly]}
        isLoading={false}
        onClose={() => {}}
        onJumpToMessage={() => {}}
        onUnpin={() => {}}
        canUnpin
        forceMode="dock"
      />,
    );
    const jumps = screen.getAllByRole("button", { name: /^Jump to message/ });
    expect(jumps.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Jump to message from Linus: Ship it",
      `Jump to message from Linus: ${"x".repeat(60)}...`,
      "Jump to message from Linus: attachment",
    ]);
    const unpins = screen.getAllByRole("button", { name: /^Unpin message/ });
    expect(new Set(unpins.map((b) => b.getAttribute("aria-label"))).size).toBe(
      3,
    );
  });

  it("shows the empty and loading states", () => {
    const { rerender } = render(
      <PinnedMessagesSidebar
        open
        messages={[]}
        isLoading={false}
        onClose={() => {}}
        onJumpToMessage={() => {}}
        onUnpin={() => {}}
        canUnpin={false}
        forceMode="dock"
      />,
    );
    expect(screen.getByText("No pinned messages")).toBeInTheDocument();

    rerender(
      <PinnedMessagesSidebar
        open
        messages={[]}
        isLoading
        onClose={() => {}}
        onJumpToMessage={() => {}}
        onUnpin={() => {}}
        canUnpin={false}
        forceMode="dock"
      />,
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
