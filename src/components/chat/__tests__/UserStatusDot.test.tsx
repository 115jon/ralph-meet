// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  normalizeUserStatus,
  UserStatusDot,
} from "@/components/chat/UserStatusDot";

describe("UserStatusDot", () => {
  it("cuts the Invisible hole with a mask, not a painted centre", () => {
    const { container } = render(<UserStatusDot status="offline" />);

    const dot = container.firstElementChild as HTMLElement;

    expect(dot).toHaveClass(
      "bg-rm-status-offline",
      "aspect-square",
      "rounded-full",
    );
    // No child shape in a surface colour that could mismatch the background.
    expect(dot.childElementCount).toBe(0);
    expect(dot.style.maskImage).toContain("data:image/svg+xml");
  });

  it("cuts the Do not disturb bar with a different mask", () => {
    const dnd = render(<UserStatusDot status="dnd" />).container
      .firstElementChild as HTMLElement;
    const offline = render(<UserStatusDot status="offline" />).container
      .firstElementChild as HTMLElement;

    expect(dnd).toHaveClass("bg-rm-status-dnd");
    expect(dnd.childElementCount).toBe(0);
    expect(dnd.style.maskImage).toContain("data:image/svg+xml");
    expect(dnd.style.maskImage).not.toBe(offline.style.maskImage);
  });

  it("leaves online and idle unmasked", () => {
    const online = render(<UserStatusDot status="online" />).container
      .firstElementChild as HTMLElement;
    expect(online.style.maskImage).toBe("");
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
        <UserStatusDot status="dnd" label="Do not disturb" />
      </>,
    );

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(getByRole("img", { name: "Do not disturb" })).toHaveClass(
      "bg-rm-status-dnd",
    );
  });

  it("draws the ring in the surface colour it is given", () => {
    const { container, getByRole } = render(
      <UserStatusDot
        status="offline"
        ring="bg-rm-sidebar"
        label="Offline"
        className="size-3"
      />,
    );
    const ring = container.firstElementChild;
    expect(ring).toHaveClass("bg-rm-sidebar", "p-0.5", "size-3");
    expect(ring?.firstElementChild).toHaveClass(
      "bg-rm-status-offline",
      "size-full",
    );
    // The ring carries the name so the dot is announced once.
    expect(getByRole("img", { name: "Offline" })).toBe(ring);
  });

  it("normalizes unknown statuses to offline", () => {
    expect(normalizeUserStatus("invisible")).toBe("offline");
    expect(normalizeUserStatus(undefined)).toBe("offline");
    expect(normalizeUserStatus("idle")).toBe("idle");
  });
});
