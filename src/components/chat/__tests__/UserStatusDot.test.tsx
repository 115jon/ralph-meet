// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserStatusDot } from "@/components/chat/UserStatusDot";

describe("UserStatusDot", () => {
  it("renders Invisible with a theme-aware center dot", () => {
    const { container } = render(<UserStatusDot status="offline" />);

    const dot = container.firstElementChild;
    const center = dot?.firstElementChild;

    expect(dot).toHaveClass(
      "bg-[var(--rm-status-offline)]",
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

    expect(container.firstElementChild).toHaveClass("bg-destructive");
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
});
