// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDelayedUnmountValue } from "../useDelayUnmount";

describe("useDelayedUnmountValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains the last non-null value until the exit delay completes", async () => {
    type ChannelValue = { id: string; name: string };
    type HookProps = { value: ChannelValue | null };
    const initialValue: ChannelValue = { id: "channel-1", name: "general" };
    const initialProps: HookProps = { value: initialValue };

    const { result, rerender } = renderHook(
      ({ value }: HookProps) => useDelayedUnmountValue(value, 200),
      { initialProps },
    );

    await waitFor(() => {
      expect(result.current.shouldRender).toBe(true);
      expect(result.current.value).toEqual(initialValue);
    });

    vi.useFakeTimers();

    act(() => {
      rerender({ value: null });
    });

    expect(result.current.shouldRender).toBe(true);
    expect(result.current.value).toEqual(initialValue);

    act(() => {
      vi.advanceTimersByTime(199);
    });

    expect(result.current.shouldRender).toBe(true);
    expect(result.current.value).toEqual(initialValue);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.shouldRender).toBe(false);
    expect(result.current.value).toBeNull();
  });

  it("tracks live values while mounted and keeps the latest one during close", async () => {
    type ChannelValue = { id: string; name: string };
    type HookProps = {
      value: ChannelValue | null;
      isMounted: boolean;
    };

    const initialValue: ChannelValue = { id: "channel-1", name: "general" };
    const savedValue: ChannelValue = {
      id: "channel-1",
      name: "renamed-channel",
    };
    const initialProps: HookProps = { value: initialValue, isMounted: true };

    const { result, rerender } = renderHook(
      ({ value, isMounted }: HookProps) =>
        useDelayedUnmountValue(value, 200, isMounted),
      { initialProps },
    );

    await waitFor(() => {
      expect(result.current.shouldRender).toBe(true);
      expect(result.current.value).toEqual(initialValue);
    });

    rerender({ value: savedValue, isMounted: true });

    await waitFor(() => {
      expect(result.current.value).toEqual(savedValue);
    });

    vi.useFakeTimers();

    rerender({ value: null, isMounted: false });

    expect(result.current.shouldRender).toBe(true);
    expect(result.current.value).toEqual(savedValue);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.shouldRender).toBe(false);
    expect(result.current.value).toBeNull();
  });
});
