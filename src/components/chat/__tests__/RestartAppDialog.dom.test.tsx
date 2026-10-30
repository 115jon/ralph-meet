// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { RestartAppDialog } from "@/components/chat/settings/RestartAppDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { executeBackHandlers } from "@/hooks/useBackButton";

function SettingsWithRestart({
  onSettingsOpenChange,
  onConfirm,
}: {
  onSettingsOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <Dialog open onOpenChange={onSettingsOpenChange}>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <button type="button" onClick={() => setConfirmOpen(true)}>
          Hardware acceleration
        </button>
        <RestartAppDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={onConfirm}
          title="Turn off hardware acceleration?"
        />
      </DialogContent>
    </Dialog>
  );
}

describe("RestartAppDialog", () => {
  it("stacks above Settings, and Escape closes only the confirm and returns focus", async () => {
    const onSettingsOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SettingsWithRestart
        onSettingsOpenChange={onSettingsOpenChange}
        onConfirm={onConfirm}
      />,
    );

    const opener = screen.getByRole("button", {
      name: "Hardware acceleration",
    });
    opener.focus();
    fireEvent.click(opener);

    const confirm = await screen.findByRole("dialog", {
      name: "Turn off hardware acceleration?",
    });
    const settings = screen.getByRole("dialog", {
      name: "Settings",
      hidden: true,
    });
    expect(settings.className).toContain("z-50");
    expect(confirm.className).toContain("z-60");
    expect(confirm.className).not.toContain("z-50");
    expect(confirm.className).toContain("md:max-w-[400px]");

    fireEvent.keyDown(confirm, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Turn off hardware acceleration?",
        }),
      ).toBeNull(),
    );
    expect(onSettingsOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("back closes only the confirm", async () => {
    const onSettingsOpenChange = vi.fn();
    render(
      <SettingsWithRestart
        onSettingsOpenChange={onSettingsOpenChange}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Hardware acceleration" }),
    );
    await screen.findByRole("dialog", {
      name: "Turn off hardware acceleration?",
    });

    act(() => {
      executeBackHandlers();
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Turn off hardware acceleration?",
        }),
      ).toBeNull(),
    );
    expect(onSettingsOpenChange).not.toHaveBeenCalled();
  });

  it("Restart now confirms; Cancel is disabled while restarting", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <RestartAppDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        title="Turn on hardware acceleration?"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(
      <RestartAppDialog
        open
        restarting
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        title="Turn on hardware acceleration?"
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
