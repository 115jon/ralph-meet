// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTypingIndicator } from "../ChatTypingIndicator";

const isAnimating = () =>
  screen.getByRole("presentation").classList.contains("animate-pulse");

describe("ChatTypingIndicator dots", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing while nobody is typing", () => {
    const { container } = render(<ChatTypingIndicator typingUsers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is ONE svg carrying the animation, not the circles", () => {
    render(<ChatTypingIndicator typingUsers={["Ada"]} />);
    const svg = screen.getByRole("presentation");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveClass("animate-pulse");
    for (const circle of svg.querySelectorAll("circle")) {
      expect(circle.getAttribute("class") ?? "").not.toContain("animate");
    }
  });

  it("stops animating 6s after the last typing event", () => {
    render(<ChatTypingIndicator typingUsers={["Ada"]} />);
    expect(isAnimating()).toBe(true);

    act(() => void vi.advanceTimersByTime(5999));
    expect(isAnimating()).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(isAnimating()).toBe(false);
    // The text stays: only the loop stops.
    expect(screen.getByRole("status")).toHaveTextContent("Ada is typing…");
  });

  it("restarts and re-arms the 6s window when a new typing event arrives", () => {
    const { rerender } = render(<ChatTypingIndicator typingUsers={["Ada"]} />);
    act(() => void vi.advanceTimersByTime(4000));

    // A new array from the store is a new typing event.
    rerender(<ChatTypingIndicator typingUsers={["Ada"]} />);
    act(() => void vi.advanceTimersByTime(4000));
    expect(isAnimating()).toBe(true);

    act(() => void vi.advanceTimersByTime(2000));
    expect(isAnimating()).toBe(false);

    rerender(<ChatTypingIndicator typingUsers={["Ada"]} />);
    expect(isAnimating()).toBe(true);
  });

  it("clears its timer when typing ends", () => {
    const { rerender } = render(<ChatTypingIndicator typingUsers={["Ada"]} />);
    rerender(<ChatTypingIndicator typingUsers={[]} />);
    expect(vi.getTimerCount()).toBe(0);
  });
});
