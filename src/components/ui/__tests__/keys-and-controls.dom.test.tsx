// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { DitherRule, ruleMaskStyle } from "@/components/ui/dither";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A ResizeObserver stub that records what it watches and can fire. */
function stubResizeObserver() {
  const observers: { cb: () => void; targets: Element[] }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(cb: () => void) {
        observers.push({ cb, targets: this.targets });
      }
      observe(el: Element) {
        this.targets.push(el);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  return observers;
}

describe("Button notched key cap", () => {
  const cap = (el: HTMLElement) => el.querySelector("[data-dither]");

  it("keeps the cap when disabled, printed in ink-3", () => {
    render(
      <>
        <Button>Live</Button>
        <Button disabled>Dead</Button>
      </>,
    );
    const live = screen.getByRole("button", { name: "Live" });
    const dead = screen.getByRole("button", { name: "Dead" });
    expect(cap(live)).not.toBeNull();
    expect(cap(dead)).not.toBeNull();
    // Same padding either way, so the width holds.
    expect(live.className).toContain("pr-3");
    expect(dead.className).toContain("pr-3");
    expect((cap(live) as HTMLElement).style.backgroundColor).toBe(
      "var(--on-primary)",
    );
    expect((cap(dead) as HTMLElement).style.backgroundColor).toBe(
      "var(--ink-3)",
    );
  });

  it("gives an asChild primary the cap inside its own element", () => {
    render(
      <Button asChild size="lg">
        <a href="/sign-in">Sign in to join</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Sign in to join" });
    expect(link).toHaveAttribute("data-notch");
    expect(link.className).toContain("rm-notch");
    expect(link.lastElementChild).toHaveAttribute("data-dither");
    expect(link.textContent).toBe("Sign in to join");
  });

  it("leaves non-notched asChild keys alone", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/x">Open</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Open" });
    expect(cap(link)).toBeNull();
    expect(link).not.toHaveAttribute("data-notch");
  });
});

describe("DitherRule", () => {
  it("lays the mask out in square cell-px cells", () => {
    const style = ruleMaskStyle(301, 20, 3, "accent") as Record<string, string>;
    // ceil(301 / 3) = 101 cols, ceil(20 / 3) = 7 rows, 3px each.
    expect(style.maskSize).toBe("303px 21px");
    expect(style.maskRepeat).toBe("no-repeat");
  });

  it("measures its box after mount and re-cuts on resize", () => {
    const observers = stubResizeObserver();
    let width = 200;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => width,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(8);
    try {
      const { container } = render(<DitherRule cell={2} />);
      const rule = container.querySelector<HTMLElement>(
        "[data-slot=dither-rule]",
      )!;
      expect(rule.style.maskSize).toBe("200px 8px");
      width = 321;
      act(() => observers.forEach((o) => o.cb()));
      expect(rule.style.maskSize).toBe("322px 8px");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("Tabs indicator", () => {
  it("watches the list and every tab, so a sibling's change moves it", () => {
    const observers = stubResizeObserver();
    const lefts = { a: 0, b: 60 };
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.id.endsWith("tab-b") ? lefts.b : lefts.a;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(40);
    try {
      const { container } = render(
        <Tabs
          label="Sections"
          idBase="t"
          items={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          value="b"
          onValueChange={() => {}}
        />,
      );
      const list = screen.getByRole("tablist");
      const tabs = screen.getAllByRole("tab");
      const watched = observers.flatMap((o) => o.targets);
      expect(watched).toEqual(expect.arrayContaining([list, ...tabs]));

      const indicator = container.querySelector<HTMLElement>(
        "[role=tablist] > span[aria-hidden]",
      )!;
      expect(indicator.style.transform).toContain("translateX(60px)");
      // The first tab's badge grows: Beta shifts right without resizing.
      lefts.b = 84;
      act(() => observers.forEach((o) => o.cb()));
      expect(indicator.style.transform).toContain("translateX(84px)");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("Slider", () => {
  it("follows the keyboard when uncontrolled", () => {
    stubResizeObserver();
    const onValueChange = vi.fn();
    render(
      <Slider
        defaultValue={[40]}
        aria-label="Volume"
        getAriaValueText={(v) => `${v} percent`}
        onValueChange={onValueChange}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Volume" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith([41]);
    expect(thumb).toHaveAttribute("aria-valuenow", "41");
    expect(thumb).toHaveAttribute("aria-valuetext", "41 percent");
  });

  it("stays on the parent's value when controlled", () => {
    stubResizeObserver();
    render(
      <Slider
        value={[40]}
        aria-label="Volume"
        getAriaValueText={(v) => `${v} percent`}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Volume" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(thumb).toHaveAttribute("aria-valuenow", "40");
  });
});

describe("Switch geometry", () => {
  it("insets the md thumb 4px on both ends (56 = 4 + 20 + 32)", () => {
    const { container } = render(<Switch aria-label="x" />);
    const thumb = container.querySelector("[data-slot=switch-thumb]")!;
    expect(thumb.className).toContain("translate-x-1");
    expect(thumb.className).toContain("data-[state=checked]:translate-x-8");
  });
});
