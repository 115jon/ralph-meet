// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackButton } from "../useBackButton";

describe("useBackButton", () => {
  let historyGo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    historyGo = vi.spyOn(window.history, "go").mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  });

  afterEach(() => {
    historyGo.mockRestore();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("cleans up each instance's history entry independently", () => {
    const first = renderHook(() => useBackButton(() => true));
    const second = renderHook(() => useBackButton(() => true));

    act(() => first.unmount());
    act(() => vi.advanceTimersByTime(5));
    act(() => second.unmount());
    act(() => vi.advanceTimersByTime(10));

    expect(historyGo).toHaveBeenNthCalledWith(1, -1);
    expect(historyGo).toHaveBeenNthCalledWith(2, -1);
  });

  it("does not let a rapid inactive-to-active toggle remove its active entry", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useBackButton(() => true, active),
      { initialProps: { active: true } },
    );

    act(() => rerender({ active: false }));
    act(() => vi.advanceTimersByTime(5));
    act(() => rerender({ active: true }));
    act(() => vi.advanceTimersByTime(10));

    expect(pushState).toHaveBeenCalledOnce();
    expect(historyGo).not.toHaveBeenCalled();

    act(() => unmount());
    act(() => vi.advanceTimersByTime(10));

    expect(historyGo).toHaveBeenCalledWith(-1);
  });

  it("keeps back handlers LIFO and suppresses programmatic cleanup popstate", () => {
    const firstHandler = vi.fn(() => true);
    const secondHandler = vi.fn(() => true);
    const first = renderHook(() => useBackButton(firstHandler));
    const second = renderHook(() => useBackButton(secondHandler));

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(secondHandler).toHaveBeenCalledOnce();
    expect(firstHandler).not.toHaveBeenCalled();

    act(() => second.unmount());
    act(() => first.unmount());
    act(() => vi.advanceTimersByTime(10));

    expect(historyGo).toHaveBeenCalledWith(-1);
    expect(firstHandler).not.toHaveBeenCalled();
  });
});
