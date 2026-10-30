// @vitest-environment jsdom

/**
 * Desktop loads the emoji set in its own chunk (desktop/vite.config.ts maps
 * the bare "@emoji-mart/data" import to an empty payload). Reproduces that:
 * the static import is empty and the lazy set reads as empty until the test
 * releases it. The picker must show its loading state, never an empty grid,
 * offer a retry if the load comes back empty, and fill in once data lands.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lazySet = vi.hoisted(() => ({ released: false }));

vi.mock("@emoji-mart/data", () => ({
  default: { categories: [], emojis: {}, aliases: {} },
}));
vi.mock("@emoji-mart/data/sets/15/native.json", async () => {
  const real = (
    (await vi.importActual("@emoji-mart/data/sets/15/native.json")) as {
      default: Record<string, unknown>;
    }
  ).default;
  return {
    default: {
      get categories() {
        return lazySet.released ? real.categories : [];
      },
      get emojis() {
        return lazySet.released ? real.emojis : {};
      },
      get aliases() {
        return lazySet.released ? real.aliases : {};
      },
    },
  };
});
vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => Promise.resolve({ items: [] })),
  apiPost: vi.fn(),
}));

import { isEmojiDataReady, loadEmojiData } from "@/lib/emoji";
import EmojiPicker from "../EmojiPicker";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

describe("EmojiPicker with lazily loaded emoji data", () => {
  it("shows a static loading grid, a retry, then the emoji", async () => {
    await loadEmojiData();
    expect(isEmojiDataReady()).toBe(false);

    render(<EmojiPicker open onSelect={() => {}} onClose={() => {}} />);

    // First paint: placeholder cells in the grid geometry, static, no buttons.
    const loading = screen.getByRole("status", { name: "Loading emoji" });
    const cells = loading.querySelectorAll('[data-slot="skeleton"]');
    expect(cells.length).toBeGreaterThan(40);
    for (const cell of cells) {
      expect(cell.className).not.toMatch(/animate-/);
    }
    expect(loading.querySelector("button")).toBeNull();
    expect(screen.queryByLabelText(/^Insert :/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No emoji matched/)).not.toBeInTheDocument();

    // The picker's load comes back empty: say so and offer a retry.
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).toHaveTextContent("Emoji didn't load.");

    lazySet.released = true;
    await act(async () => {
      fireEvent.click(retry);
    });

    expect(
      await screen.findByRole("button", { name: "Insert :grinning:" }),
    ).toBeInTheDocument();
    expect(isEmojiDataReady()).toBe(true);
    expect(
      screen.queryByRole("status", { name: "Loading emoji" }),
    ).not.toBeInTheDocument();
    // The category rail fills in with Phosphor glyphs, nature and flags too.
    for (const label of ["Animals & Nature", "Food & Drink", "Flags"]) {
      const rail = screen.getByRole("button", { name: label });
      expect(rail.querySelector('svg[data-state="idle"]')).not.toBeNull();
      expect(rail.querySelector("img")).toBeNull();
    }
  });
});
