// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/types";
import MessageShareModal from "../MessageShareModal";

vi.mock("@/components/ui/responsive-dialog", async () => {
  const dialog = await import("@/components/ui/dialog");
  return {
    ResponsiveDialog: dialog.Dialog,
    ResponsiveDialogContent: dialog.DialogContent,
    ResponsiveDialogDescription: dialog.DialogDescription,
    ResponsiveDialogFooter: dialog.DialogFooter,
    ResponsiveDialogHeader: dialog.DialogHeader,
    ResponsiveDialogTitle: dialog.DialogTitle,
  };
});
vi.mock("../MessagePreviewCard", () => ({
  MessagePreviewCard: () => <div data-testid="preview" />,
}));

const message = {
  id: "m-1",
  content: "hello",
  attachments: [],
} as never as Message;

function renderModal() {
  return render(
    <MessageShareModal
      open
      message={message}
      onClose={() => {}}
      onCreateShare={async () => "https://example.test/s/1"}
    />,
  );
}

describe("MessageShareModal initial focus", () => {
  it("lands on the surface, not an expiry option, after a pointer open", async () => {
    fireEvent.pointerDown(document.body);
    renderModal();
    const dialog = await screen.findByRole("dialog", { name: "Share message" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(screen.getByRole("radio", { name: "7 days" })).not.toHaveFocus();
  });

  it("lands on the first expiry option after a keyboard open", async () => {
    fireEvent.keyDown(document.body, { key: "Enter" });
    renderModal();
    await screen.findByRole("dialog", { name: "Share message" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "7 days" })).toHaveFocus(),
    );
  });
});
