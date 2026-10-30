// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { Led } from "@/components/ui/led";
import { Slider } from "@/components/ui/slider";
import { formatElapsed, Num, NumClock } from "@/components/ui/num";
import { DitherGlyph } from "@/components/ui/dither-glyph";
import { TreeBranch, TreeLeaf } from "@/components/ui/tree";
import { cn } from "@/lib/utils";

describe("Led", () => {
  it("is lit unless off", () => {
    const { container } = render(
      <>
        <Led state="talk" />
        <Led state="off" />
      </>,
    );
    const [talk, off] = container.querySelectorAll(".rm-led");
    expect(talk).toHaveAttribute("data-lit");
    expect(talk).toHaveAttribute("data-state", "talk");
    expect(off).not.toHaveAttribute("data-lit");
    expect(talk).toHaveAttribute("aria-hidden", "true");
  });

  it("follows [data-speaking] through CSS instead of re-rendering", () => {
    const { container } = render(
      <Led state="talk" follow="speaking" size={8} />,
    );
    const led = container.querySelector(".rm-led")!;
    expect(led).toHaveAttribute("data-follow", "speaking");
    expect(led).not.toHaveAttribute("data-lit");
    expect(led).toHaveAttribute("data-size", "8");
  });
});

describe("TreeBranch / TreeLeaf", () => {
  it("draws three guide segments per leaf and marks the lit path end", () => {
    const { container } = render(
      <TreeBranch header={<div>Lounge</div>}>
        <TreeLeaf>Ada</TreeLeaf>
        <TreeLeaf self>You</TreeLeaf>
        <TreeLeaf current>Grace</TreeLeaf>
      </TreeBranch>,
    );
    const leaves = container.querySelectorAll(".rm-tree-item");
    expect(leaves).toHaveLength(3);
    for (const leaf of leaves) {
      const segs = [...leaf.querySelectorAll(":scope > .rm-tree-guide")].map(
        (s) => s.getAttribute("data-seg"),
      );
      expect(segs).toEqual(["up", "down", "tick"]);
    }
    expect(leaves[1]).toHaveAttribute("data-self");
    expect(leaves[1]).toHaveAttribute("data-path-end");
    expect(leaves[2]).toHaveAttribute("aria-current", "true");
    expect(leaves[2]).toHaveAttribute("data-path-end");
    expect(leaves[0]).not.toHaveAttribute("data-path-end");
  });

  it("passes the speaking attribute through to the leaf", () => {
    const { container } = render(
      <TreeBranch animateEnter={false}>
        <TreeLeaf data-speaking="">Ada</TreeLeaf>
      </TreeBranch>,
    );
    expect(container.querySelector(".rm-tree-item")).toHaveAttribute(
      "data-speaking",
    );
    // Entrance is gated: never on the initial render.
    expect(
      container.querySelector("[data-slot=tree-branch]"),
    ).not.toHaveAttribute("data-animate-enter");
  });
});

describe("Num", () => {
  it("formats elapsed call time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(247_000)).toBe("4:07");
    expect(formatElapsed((2 * 3600 + 14 * 60 + 9) * 1000)).toBe("2:14:09");
  });

  it("uses the mono steps", () => {
    render(
      <>
        <Num>21:47</Num>
        <Num size="sm">28 ms</Num>
        <NumClock since={0} now={61_000} />
      </>,
    );
    expect(screen.getByText("21:47")).toHaveClass("text-num-xs");
    expect(screen.getByText("28 ms")).toHaveClass("text-num-sm");
    expect(screen.getByText("1:01").closest("[data-slot=num]")).toHaveClass(
      "text-num-sm",
    );
  });

  it("is a font size to tailwind-merge, so colours don't drop it", () => {
    expect(cn("text-num-xs", "text-ink-3")).toBe("text-num-xs text-ink-3");
    expect(cn("text-ui-row", "text-ink-2")).toBe("text-ui-row text-ink-2");
    expect(cn("text-ui-sm", "text-num-sm")).toBe("text-num-sm");
  });
});

describe("DitherGlyph", () => {
  it("is decorative, still and marks pending without motion", () => {
    const { container, rerender } = render(<DitherGlyph motif="screen" />);
    const glyph = container.querySelector('[data-slot="dither-glyph"]')!;
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveAttribute("data-motif", "screen");
    expect(glyph).not.toHaveAttribute("data-pending");
    expect(glyph.className).toContain("rm-dither");
    // 28 x 21 cells at 3px (md).
    expect((glyph as HTMLElement).style.width).toBe("84px");
    expect((glyph as HTMLElement).style.height).toBe("63px");
    rerender(<DitherGlyph motif="screen" pending />);
    expect(
      container.querySelector('[data-slot="dither-glyph"]'),
    ).toHaveAttribute("data-pending");
    expect(container.querySelector("svg, canvas")).toBeNull();
  });

  it("prints the mark through the logo silhouette", () => {
    const { container } = render(<DitherGlyph motif="mark" size="sm" />);
    const glyph = container.querySelector<HTMLElement>(
      '[data-slot="dither-glyph"]',
    )!;
    expect(glyph.style.width).toBe("64px");
    expect(glyph.dataset.motif).toBe("mark");
  });
});

describe("EmptyState", () => {
  it("renders the glyph, title, description and one action", () => {
    const { container } = render(
      <EmptyState
        title="No one's here yet"
        description="Start a call."
        action={<button type="button">Join</button>}
      />,
    );
    expect(
      container.querySelector('[data-slot="dither-glyph"][data-motif="empty"]'),
    ).toBeTruthy();
    expect(screen.getByText("No one's here yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });
});

describe("Avatar", () => {
  it("falls back to an initial and draws the speaking ring on demand", () => {
    const { container } = render(
      <Avatar name="ada lovelace" size={40} presence="online" speaking />,
    );
    const avatar = container.querySelector("[data-slot=avatar]")!;
    expect(screen.getByRole("img", { name: "ada lovelace" }).textContent).toBe(
      "A",
    );
    expect(avatar).toHaveClass("rm-speak");
    expect(avatar).toHaveAttribute("data-speaking");
    // Square-cut presence: a 14px notch holding an 8px talk LED.
    const presence = container.querySelector("[data-presence=online]")!;
    expect(presence).toHaveClass("size-3.5");
    expect(presence.querySelector("[data-slot=led]")).toHaveAttribute(
      "data-state",
      "talk",
    );
    expect(avatar).toHaveClass("rounded-avatar");
  });

  it("has 64 and 96 for call tiles, with a modest initial", () => {
    const { container } = render(
      <>
        <Avatar name="Ada" size={64} />
        <Avatar name="Grace" size={96} />
      </>,
    );
    const [small, large] = container.querySelectorAll("[data-slot=avatar]");
    expect(small).toHaveClass("size-16", "text-ui-lg");
    expect(large).toHaveClass("size-24", "text-ui-xl");
  });

  it("has no ring when no speaker is tracked", () => {
    const { container } = render(<Avatar name="Grace" size={24} />);
    expect(container.querySelector("[data-slot=avatar]")).not.toHaveClass(
      "rm-speak",
    );
  });
});

describe("Slider", () => {
  it("names its thumb, the focusable slider", () => {
    // Radix measures the thumb; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      render(
        <Slider
          defaultValue={[40]}
          aria-label="Input volume"
          getAriaValueText={(v) => `${v} percent`}
        />,
      );
      const thumb = screen.getByRole("slider", { name: "Input volume" });
      expect(thumb).toHaveAttribute("aria-valuetext", "40 percent");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("CountBadge", () => {
  it("caps the count and hides at zero", () => {
    const { container, rerender } = render(<CountBadge count={120} />);
    expect(container.textContent).toBe("99+");
    rerender(<CountBadge count={0} />);
    expect(container.textContent).toBe("");
  });
});

describe("IconButton tone", () => {
  it("paints off and live with their LED tints and the Fill glyph", () => {
    render(
      <>
        <IconButton
          icon="mic"
          tone="off"
          aria-pressed
          aria-label="Unmute"
          size={32}
        />
        <IconButton
          icon="camera"
          tone="live"
          aria-pressed
          aria-label="Camera"
          size={40}
        />
      </>,
    );
    const off = screen.getByRole("button", { name: "Unmute" });
    expect(off).toHaveClass(
      "bg-muted-state-tint",
      "text-muted-state",
      "size-8",
    );
    expect(off.className).not.toContain("aria-pressed:bg-tint-2");
    const live = screen.getByRole("button", { name: "Camera" });
    expect(live).toHaveClass("bg-live-tint", "text-live-ink", "size-10");
    expect(live).toHaveAttribute("data-tone", "live");
  });
});
