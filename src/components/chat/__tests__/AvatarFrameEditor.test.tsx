// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarFrameEditor } from "../AvatarFrameEditor";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("AvatarFrameEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders as a top-placed medium dialog with a scrim", () => {
    render(
      <AvatarFrameEditor
        image={{ src: "blob:test-avatar" }}
        displayName="Ada"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Frame your avatar" });
    expect(dialog).toHaveAttribute("data-size", "md");
    expect(dialog).toHaveAttribute("data-placement", "top");
    expect(dialog).not.toHaveClass("z-60");
    expect(
      document.body.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain("bg-scrim");
  });
});
