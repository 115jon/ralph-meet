// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: null }),
  useAuth: () => ({ signOut: vi.fn(() => Promise.resolve()) }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/platform", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform");
  return { ...actual, isDesktop: () => false };
});

vi.mock("../SettingsAccountTab", () => ({ default: () => null }));

import SettingsModal from "../SettingsModal";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function settingsSurface() {
  // Queried by selector: the sheet aria-hides everything behind it.
  return document
    .querySelector('[aria-label="Settings content"]')!
    .closest('[data-slot="dialog-surface"]') as HTMLElement;
}

describe("SettingsModal theme preview", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => setViewport(1280));
  afterEach(() => setViewport(originalWidth));

  async function openPreview() {
    const user = userEvent.setup();
    render(<SettingsModal open onClose={() => {}} initialTab="appearance" />);
    const previewButton = within(
      screen.getByRole("region", { name: "Settings content" }),
    ).getByRole("button", { name: "Preview" });
    await user.click(previewButton);
    const sheet = await screen.findByRole("dialog", { name: "Preview theme" });
    return { user, previewButton, sheet };
  }

  it("opens an undimmed right sheet and hides (keeps) the settings dialog", async () => {
    const { sheet } = await openPreview();

    expect(sheet).toHaveAttribute("data-slot", "sheet-content");
    expect(sheet.className).toContain("w-[360px]");
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
    // Settings stays mounted, just invisible, so nothing resets on return.
    expect(settingsSurface()).toHaveClass("invisible");
  });

  it("Escape returns to settings with focus on the Preview button", async () => {
    const { user, previewButton } = await openPreview();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Preview theme" }),
      ).not.toBeInTheDocument(),
    );
    expect(settingsSurface()).not.toHaveClass("invisible");
    await waitFor(() => expect(previewButton).toHaveFocus());
  });

  it("the back button and Back to settings return to settings", async () => {
    const { user } = await openPreview();

    act(() => {
      executeBackHandlers();
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Preview theme" }),
      ).not.toBeInTheDocument(),
    );
    expect(settingsSurface()).not.toHaveClass("invisible");

    await user.click(
      within(
        screen.getByRole("region", { name: "Settings content" }),
      ).getByRole("button", { name: "Preview" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Preview theme" });
    await user.click(
      within(sheet).getByRole("button", { name: "Back to settings" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Preview theme" }),
      ).not.toBeInTheDocument(),
    );
  });
});
