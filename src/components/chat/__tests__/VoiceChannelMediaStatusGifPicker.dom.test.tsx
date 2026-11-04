// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

import VoiceChannelMediaStatusModal from "../VoiceChannelMediaStatusModal";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: null }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() =>
    Promise.resolve({ items: [], results: [], favorites: [], categories: [] }),
  ),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatActions: () => ({ dispatch: vi.fn() }),
}));

const channel = {
  id: "channel-1",
  name: "General",
  voice_status: null,
} as never;

/**
 * The layer an element paints on from its Tailwind classes (jsdom has no
 * stylesheet): `z-60`, or `data-stacked:z-60` while it carries data-stacked,
 * else the modal layer 50.
 */
function layerOf(element: Element): number {
  const classes = element.className.toString().split(/\s+/);
  if (classes.includes("z-60")) return 60;
  if (
    classes.includes("data-stacked:z-60") &&
    element.hasAttribute("data-stacked")
  ) {
    return 60;
  }
  return 50;
}

describe("VoiceChannelMediaStatusModal GIF picker", () => {
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

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("puts the picker panel on its stacked scrim's layer, not under it", async () => {
    const user = userEvent.setup();
    render(
      <VoiceChannelMediaStatusModal open channel={channel} onClose={vi.fn()} />,
    );

    await user.click(await screen.findByRole("button", { name: /Choose GIF/ }));
    const picker = await screen.findByRole("dialog", { name: "GIF picker" });

    // Opened over the Channel vibe dialog, the picker's scrim takes the
    // stacked layer (z-60). A panel left on z-50 sits under that scrim in a
    // real browser, so every press lands on the scrim and dismisses it.
    const scrim = document.querySelector(
      '[data-slot="dialog-overlay"][data-stacked]',
    );
    expect(scrim).not.toBeNull();
    expect(layerOf(scrim!)).toBe(60);
    expect(picker).toHaveAttribute("data-stacked");
    expect(layerOf(picker)).toBeGreaterThanOrEqual(layerOf(scrim!));
  });

  it("keeps the picker open and interactive when it is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <VoiceChannelMediaStatusModal open channel={channel} onClose={onClose} />,
    );

    await user.click(await screen.findByRole("button", { name: /Choose GIF/ }));
    const picker = await screen.findByRole("dialog", { name: "GIF picker" });
    const search = await waitFor(() => {
      const input = picker.querySelector("input");
      if (!input) throw new Error("no search input yet");
      return input;
    });

    await user.click(search);
    await user.type(search, "cats");

    expect(screen.getByRole("dialog", { name: "GIF picker" })).toBeVisible();
    expect(search).toHaveValue("cats");
    expect(onClose).not.toHaveBeenCalled();
  });
});
