import { describe, expect, it } from "vitest";

import {
  getScreenShareSupport,
  qualityPresetLabel,
  type ScreenShareEnvironment,
} from "@/lib/screen-share-support";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const env = (
  over: Partial<ScreenShareEnvironment>,
): ScreenShareEnvironment => ({
  tauri: false,
  tauriMobile: false,
  hasDisplayMedia: false,
  userAgent: DESKTOP,
  ...over,
});

describe("getScreenShareSupport", () => {
  it("uses the native picker in the desktop app", () => {
    expect(getScreenShareSupport(env({ tauri: true }))).toEqual({
      supported: true,
      picker: "desktop-app",
    });
  });

  it("says the phone app can't share (no capture API in the webview)", () => {
    expect(
      getScreenShareSupport(env({ tauri: true, tauriMobile: true })),
    ).toEqual({ supported: false, reason: "mobile-app" });
  });

  it("uses the browser picker wherever getDisplayMedia exists", () => {
    expect(getScreenShareSupport(env({ hasDisplayMedia: true }))).toEqual({
      supported: true,
      picker: "browser",
    });
    // A phone browser that ships getDisplayMedia later just works.
    expect(
      getScreenShareSupport(env({ hasDisplayMedia: true, userAgent: ANDROID })),
    ).toMatchObject({ supported: true });
  });

  it("explains phone browsers without getDisplayMedia", () => {
    for (const userAgent of [IPHONE, ANDROID]) {
      expect(getScreenShareSupport(env({ userAgent }))).toEqual({
        supported: false,
        reason: "mobile-browser",
      });
    }
  });

  it("falls back to a generic browser reason on desktop", () => {
    expect(getScreenShareSupport(env({}))).toEqual({
      supported: false,
      reason: "browser",
    });
  });
});

describe("qualityPresetLabel", () => {
  it("formats known presets and passes unknown ids through", () => {
    expect(qualityPresetLabel("1080p60")).toBe("1080p · 60 FPS");
    expect(qualityPresetLabel("8k120")).toBe("8k120");
  });
});
