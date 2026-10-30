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
    expect(dockState("rest")).toBe("bg-tint-1 text-ink-1");
    expect(dockState("open")).toBe("bg-tint-3 text-ink-1");
    expect(dockState("muted")).toBe("bg-muted-state-tint text-muted-state");
    // Live is the azure LED, never the accent (talk-tree-spec §1e).
    expect(dockState("live")).toContain("bg-live-tint");
    expect(dockState("live")).toContain("text-live-ink");
    for (const state of ["rest", "open", "muted", "live"] as const) {
      expect(dockState(state)).not.toMatch(
        /bg-primary|bg-danger-fill|bg-accent/,
      );
    }
  });

  it("drops only the resting tint in quiet rows", () => {
    expect(dockState("rest", { quiet: true })).toBe(
      "bg-transparent text-ink-2",
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
    expect(DOCK_LEAVE).toContain("bg-danger-fill");
    expect(DOCK_DESTRUCTIVE).toContain("bg-danger-tint");
    expect(DOCK_DESTRUCTIVE).not.toContain("bg-danger-fill");
    expect(CALL_ACCEPT).toContain("bg-talk");
    expect(CALL_ACCEPT).toContain("text-on-talk");
  });
});

describe("DockButton", () => {
  it("renders a 40px IconButton with the state's tint and an accessible name", () => {
    render(
      <TooltipProvider>
        <DockButton state="muted" icon="mic" aria-label="Unmute" aria-pressed />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Unmute" });
    expect(button.className).toContain("size-10");
    expect(button.className).toContain("bg-muted-state-tint");
    // No IconButton variant colour leaks in to fight the recipe.
    expect(button.className).not.toContain("aria-pressed:bg-tint-2");
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
