// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickerSurface } from "../PickerSurface";

function setViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Harness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Toggle
      </button>
      <button type="button">Elsewhere</button>
      <PickerSurface
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        ariaLabel="Test picker"
      >
        <input aria-label="Inside" />
      </PickerSurface>
    </>
  );
}

describe("PickerSurface (desktop)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applies the shared panel recipe and owns the z-index", () => {
    setViewport(false);
    const { rerender } = render(
      <PickerSurface
        open
        onOpenChange={() => {}}
        ariaLabel="Recipe"
        className="w-80"
      >
        <span>body</span>
      </PickerSurface>,
    );
    const panel = screen.getByRole("dialog", { name: "Recipe" });
    expect(panel).toHaveClass(
      "rounded-lg",
      "shadow-lg",
      "z-50",
      "max-h-[min(600px,calc(100dvh-24px))]",
      "w-80",
    );
    // Non-modal by default: no scrim.
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();

    rerender(
      <PickerSurface open onOpenChange={() => {}} ariaLabel="Recipe" stacked>
        <span>body</span>
      </PickerSurface>,
    );
    expect(screen.getByRole("dialog", { name: "Recipe" })).toHaveClass("z-60");
  });

  it("closes on an outside press without a click-catcher", async () => {
    setViewport(false);
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole("button", { name: "Toggle" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Test picker" })).toBeTruthy();
    // Radix registers its outside-press listener on the next tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores a press on the control that opened it", async () => {
    setViewport(false);
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole("button", { name: "Toggle" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Test picker" })).toBeTruthy();
    // Radix registers its outside-press listener on the next tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.pointerDown(toggle);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
