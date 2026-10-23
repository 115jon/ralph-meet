// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CALL_ACCEPT,
  DOCK_DESTRUCTIVE,
  DOCK_LEAVE,
  dockIconState,
  dockState,
} from "@/components/ui/dock";
import { DockButton } from "@/components/ui/dock-button";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("dockState recipe", () => {
  it("paints each state with a tint, never a solid fill", () => {
    expect(dockState("rest")).toBe("bg-rm-tint-1 text-rm-text");
    expect(dockState("open")).toBe("bg-rm-tint-3 text-rm-text");
    expect(dockState("muted")).toBe("bg-rm-danger-tint text-rm-danger-ink");
    expect(dockState("live")).toContain("bg-rm-accent-tint");
    expect(dockState("live")).toContain("text-rm-accent-ink");
    for (const state of ["rest", "open", "muted", "live"] as const) {
      expect(dockState(state)).not.toMatch(
        /bg-primary|bg-rm-danger(?!-)|bg-rm-accent-solid/,
      );
    }
  });

  it("drops only the resting tint in quiet rows", () => {
    expect(dockState("rest", { quiet: true })).toBe(
      "bg-transparent text-rm-text-secondary",
    );
    expect(dockState("muted", { quiet: true })).toBe(dockState("muted"));
    expect(dockState("live", { quiet: true })).toBe(dockState("live"));
  });

  it("maps state to glyph weight: off when muted, Fill when open or live", () => {
    expect(dockIconState("rest")).toBe("idle");
    expect(dockIconState("muted")).toBe("off");
    expect(dockIconState("open")).toBe("active");
    expect(dockIconState("live")).toBe("active");
  });

  it("keeps Leave the only solid, and the destructive and accept tokens apart", () => {
    expect(DOCK_LEAVE).toContain("bg-rm-danger ");
    expect(DOCK_DESTRUCTIVE).toContain("bg-rm-danger-tint");
    expect(DOCK_DESTRUCTIVE).not.toContain("bg-rm-danger ");
    expect(CALL_ACCEPT).toContain("bg-rm-success");
    expect(CALL_ACCEPT).toContain("text-rm-on-success");
  });
});

describe("DockButton", () => {
  it("renders a 48px IconButton with the state's tint and an accessible name", () => {
    render(
      <TooltipProvider>
        <DockButton state="muted" icon="mic" aria-label="Unmute" aria-pressed />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Unmute" });
    expect(button.className).toContain("size-12");
    expect(button.className).toContain("bg-rm-danger-tint");
    // No IconButton variant colour leaks in to fight the recipe.
    expect(button.className).not.toContain("aria-pressed:bg-rm-tint-2");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("takes a smaller size for dense rows", () => {
    render(
      <TooltipProvider>
        <DockButton
          state="rest"
          quiet
          size="sm"
          icon="deafen"
          aria-label="Deafen"
        />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Deafen" });
    expect(button.className).toContain("size-8");
    expect(button.className).toContain("bg-transparent");
  });
});
