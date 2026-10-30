import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
  if (typeof document !== "undefined") {
    cleanup();
  }
});
