// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { collectibleKitDisplay } from "@/components/dev/collectible-kit";

// Real catalog frames: The Entity (rail + staples, both orders) and Star
// Chart (border + rail + staples).
const entity = collectibleKitDisplay("frame", "the-entity");
const starChart = collectibleKitDisplay("frame", "star-chart");
const full = collectibleKitDisplay("full", "the-entity");

function renderShell(display: unknown, variant?: "card" | "popover" | "sheet") {
  const { container } = render(
    <ProfileSurfaceShell display={display as never} variant={variant}>
      <p>Grace Hopper</p>
    </ProfileSurfaceShell>,
  );
  const outer = container.firstElementChild as HTMLElement;
  const card = outer.querySelector<HTMLElement>("[data-profile-card]")!;
  const back = outer.querySelector<HTMLElement>('[data-frame-order="back"]');
  const front = outer.querySelector<HTMLElement>('[data-frame-order="front"]');
  return { outer, card, back, front };
}

describe("ProfileSurfaceShell frame layering", () => {
  it("draws back art, then the card, then front art", () => {
    const { outer, card, back, front } = renderShell(entity);
    const children = Array.from(outer.children);
    expect(back).not.toBeNull();
    expect(front).not.toBeNull();
    expect(children.indexOf(back!)).toBeLessThan(children.indexOf(card));
    expect(children.indexOf(card)).toBeLessThan(children.indexOf(front!));
    // Explicit z so the back art can never paint over the card (it used to
    // be z-10 over a z-auto card).
    expect(back!.className).toContain("z-0");
    expect(card.className).toContain("z-10");
    expect(front!.className).toContain("z-20");
    expect(outer.className).toContain("isolate");
  });

  it("reserves the frame footprint around the card so the art stays in the box", () => {
    const { outer, card } = renderShell(entity);
    expect(card.style.marginTop).toMatch(/cqw$/);
    expect(card.style.marginBottom).toMatch(/cqw$/);
    expect(card.style.marginLeft).toBe(card.style.marginRight);
    expect(Number.parseFloat(card.style.marginTop)).toBeGreaterThan(
      Number.parseFloat(card.style.marginBottom),
    );
    expect(outer.className).toContain("[container-type:inline-size]");
    expect(
      outer.style.getPropertyValue("--rm-profile-frame-reserve-y"),
    ).toMatch(/cqw$/);
  });

  it("reserves the same footprint on every variant", () => {
    for (const variant of ["card", "popover", "sheet"] as const) {
      const { card } = renderShell(entity, variant);
      expect(card.style.marginTop).toMatch(/cqw$/);
    }
  });

  it("stretches rails and borders, keeps staples at their aspect", () => {
    const { outer } = renderShell(starChart);
    const layers = Array.from(
      outer.querySelectorAll<HTMLImageElement>("img[data-frame-layer]"),
    );
    const rail = layers.find((img) => img.dataset.frameLayer === "rail")!;
    const border = layers.find((img) => img.dataset.frameLayer === "border")!;
    const staples = layers.filter((img) => img.dataset.frameLayer === "staple");
    expect(rail.style.height).toBe("100%");
    expect(rail.style.objectFit).toBe("fill");
    expect(border.style.height).toMatch(/^calc\(100% - /);
    expect(staples.length).toBeGreaterThan(0);
    for (const staple of staples) {
      expect(staple.style.height).toBe("");
      expect(staple.style.width).toBe("100%");
    }
  });

  it("adds no inset and no frame art without a frame", () => {
    const { outer, card, back, front } = renderShell({ version: 1 });
    expect(back).toBeNull();
    expect(front).toBeNull();
    expect(card.style.marginTop).toBe("");
    expect(outer.style.getPropertyValue("--rm-profile-frame-reserve-y")).toBe(
      "0px",
    );
  });

  it("keeps content under the profile effect and above the theme overlay", () => {
    const { card } = renderShell(full);
    const content = Array.from(card.children).find((el) =>
      el.textContent?.includes("Grace Hopper"),
    ) as HTMLElement;
    expect(content.className).toContain("z-20");
    const stage = Array.from(card.children).find((el) =>
      el.className.includes("z-30"),
    );
    expect(stage).toBeDefined();
    expect(stage!.className).toContain("pointer-events-none");
  });
});
