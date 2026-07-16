// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getApiBaseUrl,
  getAuthAssetUrl,
  getPublicApiUrl,
  getWsBaseUrl,
  isTauri,
  isDesktop,
  isMobile,
} from "../platform";

afterEach(() => {
  vi.unstubAllGlobals();
  if (typeof window !== "undefined") delete window.__TAURI_INTERNALS__;
});

describe("platform asset urls", () => {
  it("proxies Google user-content avatar urls through proxy-media", () => {
    expect(
      getAuthAssetUrl(
        "https://lh3.googleusercontent.com/a/example-avatar=s96-c",
      ),
    ).toBe(
      "/api/proxy-media?url=https%3A%2F%2Flh3.googleusercontent.com%2Fa%2Fexample-avatar%3Ds96-c",
    );
  });

  it("leaves other external asset urls unchanged", () => {
    expect(getAuthAssetUrl("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
  });

  it("uses the public API origin for the mobile Tauri runtime", () => {
    vi.stubGlobal("__IS_MOBILE__", true);
    Object.defineProperty(globalThis, "__IS_MOBILE__", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(isMobile()).toBe(true);
    expect(isTauri()).toBe(true);
    expect(getApiBaseUrl()).toBe(getPublicApiUrl());
    expect(getWsBaseUrl()).toBe(
      getPublicApiUrl()
        .replace(/^https:/, "wss:")
        .replace(/^http:/, "ws:"),
    );
  });

  it("keeps desktop-only native APIs behind the desktop build flag", () => {
    vi.stubGlobal("__IS_DESKTOP__", true);
    Object.defineProperty(globalThis, "__IS_DESKTOP__", {
      configurable: true,
      value: true,
    });
    expect(isDesktop()).toBe(true);
    expect(isMobile()).toBe(false);
  });
});
