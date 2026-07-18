// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: null }),
  useKovaAuth: () => ({ clearSessionToken: vi.fn() }),
}));

vi.mock("@/lib/platform", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform");
  return { ...actual, isDesktop: () => false };
});

import SettingsModal from "../SettingsModal";

describe("SettingsModal mobile panel isolation", () => {
  it("marks the hidden mobile panel inert and aria-hidden", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    render(<SettingsModal onClose={() => {}} initialTab="account" />);

    const sidebar = screen.getByRole("navigation", {
      name: "Settings navigation",
    });
    const content = document.querySelector<HTMLElement>(
      '[aria-label="Settings content"]',
    );
    expect(content).not.toBeNull();
    const contentPanel = content as HTMLElement;
    expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
    expect(contentPanel).toHaveAttribute("aria-hidden", "true");
    expect(contentPanel).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveAttribute("inert");
    expect(contentPanel).not.toHaveAttribute("aria-hidden", "true");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    fireEvent(window, new Event("resize"));
    expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
    expect(contentPanel).not.toHaveAttribute("aria-hidden", "true");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
  });
});
