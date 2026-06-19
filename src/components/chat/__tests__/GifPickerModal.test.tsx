import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach, vi } from "vitest";
import GifPickerModal from "../GifPickerModal";
import React from "react";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
}));

describe("GifPickerModal recent queries rendering", () => {
  beforeEach(() => {
    const store: Record<string, string> = {
      "chat:gifs:recent:gifs": JSON.stringify(["cute cats", "funny dog"]),
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it("renders base structure without errors", () => {
    const markup = renderToStaticMarkup(
      <GifPickerModal onClose={() => {}} onSelect={async () => {}} skipAuth />
    );

    expect(markup).toContain("Favorites");
    expect(markup).not.toContain("Recent Searches");
  });
});
