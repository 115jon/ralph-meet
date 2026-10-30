// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui/avatar";
import { avatarShape, isAvatarDecorated } from "@/components/ui/avatar-shape";

const DECORATED = {
  version: 1,
  collectibles: {
    avatarDecoration: {
      skuId: "deco-1",
      name: "Ring",
      asset: "ring",
      imageUrl: "https://cdn.discordapp.com/avatar-decoration-presets/ring.png",
    },
  },
};

describe("Avatar image fallback", () => {
  it("falls back to the initial when the image fails", () => {
    const { container } = render(<Avatar name="Jon" src="/a.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Jon" }).textContent).toBe("J");
  });

  it("tries a new src after the previous one broke", () => {
    const { container, rerender } = render(<Avatar name="Jon" src="/a.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();

    rerender(<Avatar name="Jon" src="/b.png" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/b.png");
  });

  it("keeps the fallback while the broken src stays the same", () => {
    const { container, rerender } = render(<Avatar name="Jon" src="/a.png" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Avatar name="Jon" src="/a.png" size={40} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("avatarShape", () => {
  it("is the clipped square key when undecorated", () => {
    expect(avatarShape(null)).toBe("rounded-avatar overflow-hidden");
    expect(avatarShape({ collectibles: {} })).toBe(
      "rounded-avatar overflow-hidden",
    );
    expect(avatarShape(false, { clip: false })).toBe("rounded-avatar");
  });

  it("is round and unclipped under a decoration, so the ring art shows", () => {
    expect(isAvatarDecorated(DECORATED)).toBe(true);
    expect(avatarShape(DECORATED)).toBe("rounded-full overflow-visible");
    expect(avatarShape(DECORATED, { clip: false })).toBe(
      "rounded-full overflow-visible",
    );
    expect(avatarShape(true)).toBe("rounded-full overflow-visible");
  });

  it("stays square when there is no picture to decorate", () => {
    for (const avatarUrl of [null, undefined, ""] as (string | null)[]) {
      expect(avatarShape(avatarUrl && DECORATED)).toBe(
        "rounded-avatar overflow-hidden",
      );
    }
  });
});
