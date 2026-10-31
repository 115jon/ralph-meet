// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterLoadIdle, whenIdle } from "@/lib/idle";

describe("whenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to a short timer where requestIdleCallback is missing", () => {
    const run = vi.fn();
    whenIdle(run, 1500);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it runs", () => {
    const run = vi.fn();
    const cancel = whenIdle(run, 1500);
    cancel();
    vi.advanceTimersByTime(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses requestIdleCallback with the timeout when the browser has it", () => {
    const request = vi.fn(() => 7);
    const cancelIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const run = vi.fn();
    const cancel = whenIdle(run, 900);
    expect(request).toHaveBeenCalledWith(run, { timeout: 900 });
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);
  });
});

describe("afterLoadIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for the load event when the page is still loading", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const run = vi.fn();
    afterLoadIdle(run);
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts at once when the page has already loaded", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    const run = vi.fn();
    afterLoadIdle(run);
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing once cancelled", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const run = vi.fn();
    const cancel = afterLoadIdle(run);
    cancel();
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
