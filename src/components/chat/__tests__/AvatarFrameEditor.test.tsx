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

  it("renders as an interactive top-level modal layer", () => {
    render(
      <AvatarFrameEditor
        image={{ src: "blob:test-avatar" }}
        displayName="Ada"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const modalLayer = screen.getByRole("presentation");
    expect(modalLayer).toHaveClass("z-70", "pointer-events-auto");
  });
});
