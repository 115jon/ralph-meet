// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { collisionPaddingBelowChrome, readAppChromeTop } from "../app-chrome";

describe("app chrome offset", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--app-chrome-top");
  });

  it("is 0 on the web, where no title bar is drawn", () => {
    expect(readAppChromeTop()).toBe(0);
    expect(collisionPaddingBelowChrome()).toEqual({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
    });
  });

  it("reads the desktop title bar height from --app-chrome-top", () => {
    document.documentElement.style.setProperty("--app-chrome-top", "32px");
    expect(readAppChromeTop()).toBe(32);
    expect(collisionPaddingBelowChrome(10)).toEqual({
      top: 42,
      right: 10,
      bottom: 10,
      left: 10,
    });
  });
});
