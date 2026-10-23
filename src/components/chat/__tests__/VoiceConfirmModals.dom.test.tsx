// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartCallModal } from "@/components/chat/StartCallModal";
import { VoiceSwitchModal } from "@/components/chat/VoiceSwitchModal";
import {
  START_CALL_CONFIRM_KEY,
  VOICE_SWITCH_CONFIRM_KEY,
} from "@/components/chat/voice-confirmation-preferences";

const cases = [
  {
    name: "StartCallModal",
    key: START_CALL_CONFIRM_KEY,
    title: "Ready to start a call?",
    confirm: "Start Call",
    render: (onConfirm: () => void, onCancel: () => void) => (
      <StartCallModal
        open
        targetName="Ralph"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    ),
  },
  {
    name: "VoiceSwitchModal",
    key: VOICE_SWITCH_CONFIRM_KEY,
    title: "You sure?",
    confirm: "Confirm",
    render: (onConfirm: () => void, onCancel: () => void) => (
      <VoiceSwitchModal
        open
        targetName="General"
        currentType="voice"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    ),
  },
];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe.each(cases)("$name", (c) => {
  it("persists Don't ask again on confirm", () => {
    const onConfirm = vi.fn();
    render(c.render(onConfirm, vi.fn()));

    const dialog = screen.getByRole("dialog", { name: c.title });
    expect(dialog.className).toContain("md:max-w-sm");

    const checkbox = screen.getByRole("checkbox", { name: "Don't ask again" });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: c.confirm }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(c.key)).toBe("true");
  });

  it("does not persist when the box is left unchecked", () => {
    const onConfirm = vi.fn();
    render(c.render(onConfirm, vi.fn()));
    fireEvent.click(screen.getByRole("button", { name: c.confirm }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(c.key)).toBeNull();
  });

  it("Escape and the stock close button call onCancel", async () => {
    const onCancel = vi.fn();
    const { unmount } = render(c.render(vi.fn(), onCancel));

    fireEvent.keyDown(screen.getByRole("dialog", { name: c.title }), {
      key: "Escape",
    });
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    unmount();

    render(c.render(vi.fn(), onCancel));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
  });
});
