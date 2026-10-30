// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SplashScreen } from "../SplashScreen";

describe("SplashScreen", () => {
  afterEach(() => vi.useRealTimers());

  it("is the cold-load screen at its first step, with the real mark", () => {
    render(<SplashScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in");
    const mark = document.querySelector("[data-slot=logo-resolve]");
    expect(mark).toHaveAttribute("data-step", "0");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark?.querySelector("img.theme-aware-splash-logo")).toHaveAttribute(
      "src",
    );
  });

  it("offers Reload once it has been up for 10s", () => {
    vi.useFakeTimers();
    render(<SplashScreen />);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Taking longer than usual",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
