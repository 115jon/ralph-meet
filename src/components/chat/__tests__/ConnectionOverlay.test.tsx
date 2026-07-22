// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionOverlay } from "../ConnectionOverlay";

const chatState = vi.hoisted(() => ({
  connected: false,
  reconnectAttempt: 0,
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (
    selector: (state: {
      connected: boolean;
      reconnectAttempt: number;
    }) => unknown,
  ) => selector(chatState),
}));

describe("ConnectionOverlay", () => {
  afterEach(() => {
    vi.useRealTimers();
    chatState.connected = false;
    chatState.reconnectAttempt = 0;
    document.documentElement.className = "";
  });

  it("shows first-load loading tips before reconnect copy", () => {
    render(<ConnectionOverlay />);

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(screen.getByText("Warming up the servers...")).toBeInTheDocument();
    expect(
      screen.queryByText("Reconnecting you to the conversation..."),
    ).not.toBeInTheDocument();
  });

  it("uses the theme-aware logo variant", () => {
    document.documentElement.className = "light";
    const { rerender } = render(<ConnectionOverlay />);

    expect(screen.getByTestId("connection-overlay-logo")).toHaveClass(
      "theme-aware-splash-logo",
    );
    expect(screen.getByTestId("connection-overlay-logo")).not.toHaveAttribute(
      "style",
    );

    document.documentElement.className = "dark";
    rerender(<ConnectionOverlay />);

    expect(screen.getByTestId("connection-overlay-logo")).not.toHaveAttribute(
      "style",
    );
  });

  it("keeps logo markup stable while the theme class is bootstrapped", () => {
    document.documentElement.className = "light";

    render(<ConnectionOverlay />);

    expect(screen.getByTestId("connection-overlay-logo")).not.toHaveAttribute(
      "style",
    );
  });

  it("reserves tip space while fading out", () => {
    vi.useFakeTimers();

    const { rerender } = render(<ConnectionOverlay />);
    chatState.connected = true;
    rerender(<ConnectionOverlay />);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByText("Warming up the servers...")).toHaveClass(
      "invisible",
      "opacity-0",
    );
  });
});
