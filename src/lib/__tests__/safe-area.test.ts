// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  getSafeAreaCssVariables,
  setupSafeArea,
  type SafeAreaInsets,
} from "../safe-area";

describe("safe-area CSS variables", () => {
  it("maps native insets to the variables consumed by SafeAreaView", () => {
    expect(
      getSafeAreaCssVariables({ top: 12, bottom: 34, left: 5, right: 6 }),
    ).toEqual({
      "--safe-area-top": "12px",
      "--safe-area-bottom": "34px",
      "--safe-area-bottom-computed": "48px",
      "--safe-area-left": "5px",
      "--safe-area-right": "6px",
    });
  });

  it("waits for edge-to-edge before reading insets and refreshes on viewport changes", async () => {
    const calls: string[] = [];
    let resolveEnable: (() => void) | undefined;
    let resolveInsets: ((insets: SafeAreaInsets) => void) | undefined;
    const invoke = async <T>(command: string): Promise<T> => {
      calls.push(command);
      if (command === "plugin:edge-to-edge|enable") {
        return new Promise<T>((resolve) => {
          resolveEnable = () => resolve(undefined as T);
        });
      }
      return new Promise<T>((resolve) => {
        resolveInsets = (insets) => resolve(insets as T);
      });
    };
    const flush = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

    const cleanup = setupSafeArea(invoke, document, window);
    expect(calls).toEqual(["plugin:edge-to-edge|enable"]);

    resolveEnable?.();
    await flush();
    expect(calls).toEqual([
      "plugin:edge-to-edge|enable",
      "plugin:edge-to-edge|get_safe_area_insets",
    ]);
    resolveInsets?.({ top: 1, bottom: 2, left: 3, right: 4 });
    await flush();
    expect(
      document.documentElement.style.getPropertyValue("--safe-area-top"),
    ).toBe("1px");

    window.dispatchEvent(new Event("orientationchange"));
    await flush();
    expect(calls).toHaveLength(3);
    resolveInsets?.({ top: 5, bottom: 6, left: 7, right: 8 });
    await flush();
    expect(
      document.documentElement.style.getPropertyValue("--safe-area-top"),
    ).toBe("5px");

    cleanup();
    window.dispatchEvent(new Event("orientationchange"));
    await flush();
    expect(calls).toHaveLength(3);
  });
});
