// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useShiftPressed } from "./useShiftPressed";

describe("useShiftPressed", () => {
  it("shares one window listener across subscribers", () => {
    const first = renderHook(() => useShiftPressed());
    const second = renderHook(() => useShiftPressed());

    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
    });

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { shiftKey: false }));
    });

    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);

    first.unmount();
    second.unmount();
  });
});
