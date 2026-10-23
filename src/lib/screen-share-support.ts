/**
 * Where screen sharing can actually run, and the quality presets every share
 * picker offers.
 *
 *   Tauri desktop       native picker (windows, screens, capture devices)
 *   desktop browsers    getDisplayMedia (the browser draws its own picker)
 *   Tauri iOS/Android   no capture API in the webview, nothing to pick
 *   phone browsers      iOS/iPadOS Safari and Android browsers do not ship
 *                       getDisplayMedia, so there is no picker either
 *
 * Feature detection decides, so a phone browser that adds getDisplayMedia
 * later gets the browser picker without a code change.
 */

import { isMobile, isTauri } from "@/lib/platform";

export type ScreenShareSupport =
  | { supported: true; picker: "desktop-app" | "browser" }
  | {
      supported: false;
      reason: "mobile-app" | "mobile-browser" | "browser";
    };

export interface ScreenShareEnvironment {
  tauri: boolean;
  tauriMobile: boolean;
  hasDisplayMedia: boolean;
  userAgent: string;
}

function readEnvironment(): ScreenShareEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    tauri: isTauri(),
    tauriMobile: isMobile(),
    hasDisplayMedia: typeof nav?.mediaDevices?.getDisplayMedia === "function",
    userAgent: nav?.userAgent ?? "",
  };
}

const PHONE_OR_TABLET_UA = /android|iphone|ipad|ipod|mobile/i;

export function getScreenShareSupport(
  env: ScreenShareEnvironment = readEnvironment(),
): ScreenShareSupport {
  if (env.tauri) {
    return env.tauriMobile
      ? { supported: false, reason: "mobile-app" }
      : { supported: true, picker: "desktop-app" };
  }
  if (env.hasDisplayMedia) return { supported: true, picker: "browser" };
  return {
    supported: false,
    reason: PHONE_OR_TABLET_UA.test(env.userAgent)
      ? "mobile-browser"
      : "browser",
  };
}

export interface ScreenShareQualityPreset {
  id: string;
  label: string;
  fps: number;
  desc: string;
}

export const SCREEN_SHARE_QUALITY_PRESETS: readonly ScreenShareQualityPreset[] =
  [
    { id: "720p30", label: "720p", fps: 30, desc: "Light on bandwidth" },
    { id: "720p60", label: "720p", fps: 60, desc: "Smooth motion" },
    { id: "1080p30", label: "1080p", fps: 30, desc: "Sharp text and apps" },
    { id: "1080p60", label: "1080p", fps: 60, desc: "Sharp and smooth" },
    { id: "1440p30", label: "1440p", fps: 30, desc: "Extra detail" },
    { id: "1440p60", label: "1440p", fps: 60, desc: "Extra detail, smooth" },
    { id: "4k30", label: "4K", fps: 30, desc: "Most detail" },
    { id: "4k60", label: "4K", fps: 60, desc: "Most detail, smooth" },
  ];

export function qualityPresetLabel(id: string) {
  const preset = SCREEN_SHARE_QUALITY_PRESETS.find((q) => q.id === id);
  return preset ? `${preset.label} · ${preset.fps} FPS` : id;
}
