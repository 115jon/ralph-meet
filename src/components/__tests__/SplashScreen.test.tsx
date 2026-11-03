// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColdLoadScreen } from "../chat/ColdLoad";
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
    // Loading: the mark barks.
    expect(mark?.querySelector("[data-slot=yap-bark]")).toHaveAttribute(
      "data-barking",
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

  it("stops barking on a failure and once the app is ready", () => {
    const bark = () => document.querySelector("[data-slot=yap-bark]");
    const { rerender } = render(<ColdLoadScreen step={1} error="slow" />);
    expect(bark()).toHaveAttribute("data-barking");
    rerender(<ColdLoadScreen step={1} error="offline" />);
    expect(bark()).not.toHaveAttribute("data-barking");
    rerender(<ColdLoadScreen step={0} error="auth" />);
    expect(bark()).not.toHaveAttribute("data-barking");
    rerender(<ColdLoadScreen step={3} />);
    expect(bark()).not.toHaveAttribute("data-barking");
  });
});
