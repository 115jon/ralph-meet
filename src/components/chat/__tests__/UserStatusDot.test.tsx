// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  normalizeUserStatus,
  UserStatusDot,
} from "@/components/chat/UserStatusDot";

describe("UserStatusDot", () => {
  it("renders Invisible with a theme-aware center dot", () => {
    const { container } = render(<UserStatusDot status="offline" />);

    const dot = container.firstElementChild;
    const center = dot?.firstElementChild;

    expect(dot).toHaveClass(
      "bg-rm-status-offline",
      "aspect-square",
      "rounded-full",
    );
    expect(center).toHaveClass(
      "bg-rm-bg-surface",
      "rounded-full",
      "left-1/2",
      "top-1/2",
      "-translate-x-1/2",
      "-translate-y-1/2",
    );
  });

  it("renders Do Not Disturb with a centered line", () => {
    const { container } = render(<UserStatusDot status="dnd" />);

    const line = container.firstElementChild?.firstElementChild;

    expect(container.firstElementChild).toHaveClass("bg-rm-status-dnd");
    expect(line).toHaveClass(
      "bg-rm-bg-surface",
      "rounded-full",
      "left-1/2",
      "top-1/2",
      "-translate-x-1/2",
      "-translate-y-1/2",
    );
    expect(line).toHaveClass("h-[18%]", "w-[55%]");
  });

  it("uses the status tokens, not accent, for online and idle", () => {
    const online = render(<UserStatusDot status="online" />).container
      .firstElementChild;
    const idle = render(<UserStatusDot status="idle" />).container
      .firstElementChild;

    expect(online).toHaveClass("bg-rm-status-online");
    expect(online).not.toHaveClass("bg-primary");
    expect(idle).toHaveClass("bg-rm-status-idle");
  });

  it("is decorative by default and announces a label when given one", () => {
    const { container, getByRole } = render(
      <>
        <UserStatusDot status="online" />
        <UserStatusDot status="dnd" label="Do Not Disturb" />
      </>,
    );

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(getByRole("img", { name: "Do Not Disturb" })).toHaveClass(
      "bg-rm-status-dnd",
    );
  });

  it("lets the cut-out match the surface behind the dot", () => {
    const { container } = render(
      <UserStatusDot status="offline" cutoutClassName="bg-rm-bg-elevated" />,
    );
    expect(container.firstElementChild?.firstElementChild).toHaveClass(
      "bg-rm-bg-elevated",
    );
  });

  it("normalizes unknown statuses to offline", () => {
    expect(normalizeUserStatus("invisible")).toBe("offline");
    expect(normalizeUserStatus(undefined)).toBe("offline");
    expect(normalizeUserStatus("idle")).toBe("idle");
  });
});
