// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectionOverlay } from "../ConnectionOverlay";

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (
    selector: (state: {
      connected: boolean;
      reconnectAttempt: number;
    }) => unknown,
  ) =>
    selector({
      connected: false,
      reconnectAttempt: 0,
    }),
}));

describe("ConnectionOverlay", () => {
  it("shows first-load loading tips before reconnect copy", () => {
    render(<ConnectionOverlay />);

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(screen.getByText("Warming up the servers...")).toBeInTheDocument();
    expect(
      screen.queryByText("Reconnecting you to the conversation..."),
    ).not.toBeInTheDocument();
  });
});
