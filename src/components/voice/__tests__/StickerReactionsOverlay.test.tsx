// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StickerReactionsOverlay } from "@/components/voice/StickerReactionsOverlay";
import type { SFUClient } from "@/lib/sfu-client";

function fakeSfu() {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  const sfu = {
    on: (_name: string, fn: (event: Record<string, unknown>) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  } as unknown as SFUClient;
  return {
    sfu,
    emit: (event: Record<string, unknown>) => act(() => listener?.(event)),
  };
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const rain = {
  type: "reaction.sticker",
  url: "https://media.example/sticker.gif",
  contentType: "image/gif",
  displayMode: "rain",
};

describe("StickerReactionsOverlay", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rains travelling stickers by default", () => {
    mockReducedMotion(false);
    const { sfu, emit } = fakeSfu();
    const { container } = render(<StickerReactionsOverlay sfu={sfu} />);
    emit(rain);
    const stickers = container.querySelectorAll("img");
    expect(stickers.length).toBeGreaterThan(1);
    expect(stickers[0]).toHaveClass("animate-reaction-rain");
  });

  it("shows one sticker that fades in place under reduced motion", () => {
    mockReducedMotion(true);
    const { sfu, emit } = fakeSfu();
    const { container } = render(<StickerReactionsOverlay sfu={sfu} />);
    emit(rain);
    const stickers = container.querySelectorAll("img");
    expect(stickers).toHaveLength(1);
    expect(stickers[0].className).not.toMatch(/animate-reaction/);
  });
});
