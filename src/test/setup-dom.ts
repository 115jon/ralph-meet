import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetUpstreamState } from "@/lib/upstream-guard";

// jsdom has no ResizeObserver. A no-op default keeps components that observe
// their size (sliders, floating surfaces) mounting; tests that need to drive
// resizes install their own stub.
if (
  typeof window !== "undefined" &&
  typeof globalThis.ResizeObserver === "undefined"
) {
  class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

afterEach(() => {
  // Breakers and memos are isolate state; one test's 429 must not block the next.
  resetUpstreamState();
  if (typeof document !== "undefined") {
    cleanup();
  }
});
