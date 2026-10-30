// @vitest-environment jsdom

import { render, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { apiGet } from "@/lib/api-client";
import GifPickerModal from "../GifPickerModal";
import React from "react";

const mockedApiGet = vi.mocked(apiGet);

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
    expect(markup).toContain("Recent searches");
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
    // Expanded is a modal workbench: the standard scrim, then the surface
    // on the same layer (later in the DOM, so above it).
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    const surface = screen.getByRole("dialog", { name: "GIF picker" });
    expect(overlay).toHaveClass("z-50", "bg-scrim");
    expect(surface).toHaveClass("z-50", "rounded-[2px]", "shadow-float");
    expect(
      overlay!.compareDocumentPosition(surface) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("raises the whole picker to the stacked layer when opened from a dialog", () => {
    render(
      <GifPickerModal
        open
        initialExpanded
        stacked
        onClose={() => {}}
        onSelect={async () => {}}
        skipAuth
      />,
    );
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "z-60",
    );
    expect(screen.getByRole("dialog", { name: "GIF picker" })).toHaveClass(
      "z-60",
    );
  });

  it("switches media type with tabs and keeps the compact picker non-modal", async () => {
    const user = userEvent.setup();
    render(
      <GifPickerModal
        open
        onClose={() => {}}
        onSelect={async () => {}}
        skipAuth
      />,
    );
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    const tabs = screen.getByRole("tablist", { name: "Media type" });
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(4);
    const stickers = screen.getByRole("tab", { name: "Stickers" });
    await user.click(stickers);
    expect(stickers).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "GIFs" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("GifPickerModal category search suggestions", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiGet.mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes("mode=categories")) {
        return {
          categories: [
            {
              id: "cats",
              label: "Cats",
              query: "cats",
              imageUrl: "https://example.com/cats.jpg",
            },
          ],
        };
      }
      if (
        href.includes("mode=autocomplete") ||
        href.includes("mode=suggestions")
      ) {
        return { results: ["cats funny", "cats cute"] };
      }
      return {
        results: [
          {
            id: "gif-1",
            title: "cat gif",
            provider: "klipy",
            sourceUrl: "https://example.com/cat.gif",
            aspectRatio: 1,
            preview: {
              url: "https://example.com/preview.gif",
              width: 120,
              height: 120,
              sizeBytes: 1000,
              contentType: "image/gif",
            },
            send: {
              url: "https://example.com/send.gif",
              width: 240,
              height: 240,
              sizeBytes: 2000,
              contentType: "image/gif",
            },
          },
        ],
        next: null,
      };
    });
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
    const store: Record<string, string> = {};
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

  function renderPicker() {
    return render(
      <GifPickerModal
        open
        onClose={() => {}}
        onSelect={async () => {}}
        skipAuth
      />,
    );
  }

  it("fills search from a category without opening suggestions or keeping the input focused", async () => {
    const user = userEvent.setup();
    renderPicker();

    const category = await screen.findByRole("button", { name: "Cats" });
    await user.click(category);

    const input = screen.getByRole("textbox", { name: /Search KLIPY GIFs/i });
    expect(input).toHaveValue("cats");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        mockedApiGet.mock.calls.some(([url]) =>
          String(url).includes("mode=autocomplete"),
        ),
      ).toBe(true);
    });

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input).not.toHaveFocus();
  });

  it("closes suggestions and blurs search when clicking outside the input", async () => {
    const user = userEvent.setup();
    renderPicker();

    const input = await screen.findByRole("textbox", {
      name: /Search KLIPY GIFs/i,
    });
    await user.click(input);
    await user.type(input, "cats");

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: /cats funny/i }),
      ).toBeInTheDocument();
    });
    expect(input).toHaveFocus();

    const resultsPane =
      document.querySelector<HTMLElement>(".custom-scrollbar");
    expect(resultsPane).toBeTruthy();
    await user.click(resultsPane as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });
    expect(input).not.toHaveFocus();
  });
});
