// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiDelete: vi.fn(() => Promise.resolve({})),
}));

import MemberList from "../MemberList";

describe("MemberList mobile header", () => {
  it("wires the gear to channel settings and labels every control", () => {
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <MemberList
        members={[]}
        onlineUsers={new Set()}
        channelId="channel-a"
        onClose={onClose}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Channel settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Close member list" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Search this channel" }),
    ).toBeInTheDocument();
  });

  it("hides the gear when you can't manage the channel and has no dead bell", () => {
    render(
      <MemberList members={[]} onlineUsers={new Set()} channelId="channel-a" />,
    );

    expect(
      screen.queryByRole("button", { name: "Channel settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /notification/i }),
    ).not.toBeInTheDocument();
  });
});
