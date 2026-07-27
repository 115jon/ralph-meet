// @vitest-environment jsdom

import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import GifPickerModal from "../GifPickerModal";
import React from "react";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: null }),
}));

describe("GifPickerModal recent queries rendering", () => {
  afterEach(() => {
    cleanup();
  });

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
    const store: Record<string, string> = {
      "chat:gifs:recent:gifs": JSON.stringify(["cute cats", "funny dog"]),
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  });

  it("renders base structure without errors", () => {
    render(
      <GifPickerModal
        open
        onClose={() => {}}
        onSelect={async () => {}}
        skipAuth
      />,
    );
    const markup = document.body.innerHTML;

    expect(markup).toContain("Favorites");
    expect(markup).toContain("Trending");
    expect(markup).toContain("Memes");
    expect(markup).toContain("Recent Searches");
  });

  it("keeps the expanded picker above its full-viewport backdrop", () => {
    render(
      <GifPickerModal
        open
        initialExpanded
        onClose={() => {}}
        onSelect={async () => {}}
        skipAuth
      />,
    );
    const markup = document.body.innerHTML;

    expect(markup).toContain(
      'class="fixed inset-0 transition-opacity duration-150 z-90"',
    );
    expect(markup).toContain(
      "absolute z-10 flex min-h-0 flex-col overflow-hidden rounded-[26px]",
    );
  });
});
