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
    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(onJump).toHaveBeenCalledWith("m-1");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(region).not.toBeInTheDocument();
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
