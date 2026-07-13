// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileNavigationSheet } from "../MobileNavigationSheet";

describe("MobileNavigationSheet", () => {
  it("keeps the server rail and current channels in one accessible sheet", () => {
    const onClose = vi.fn();

    render(
      <MobileNavigationSheet
        open
        onClose={onClose}
        serverList={<p>Server list</p>}
        current={<p>Channel list</p>}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Chat navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Server list")).toBeInTheDocument();
    expect(screen.getByText("Channel list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not schedule a browser history pop when it closes manually", () => {
    vi.useFakeTimers();
    const historyGo = vi
      .spyOn(window.history, "go")
      .mockImplementation(() => undefined);
    const onClose = vi.fn();
    const props = {
      onClose,
      serverList: <p>Server list</p>,
      current: <p>Channel list</p>,
    };
    const { rerender } = render(<MobileNavigationSheet open {...props} />);

    rerender(<MobileNavigationSheet open={false} {...props} />);
    vi.advanceTimersByTime(20);

    expect(historyGo).not.toHaveBeenCalled();
    historyGo.mockRestore();
    vi.useRealTimers();
  });
});
