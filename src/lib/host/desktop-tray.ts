// ── Desktop tray badge ──────────────────────────────────────────────────────
// Draws the unread badge onto the tray icon. Only what changed crosses IPC:
// the tooltip when its text changes, the icon when the badge label changes,
// the taskbar overlay once per page. Every `Image` made here is closed after
// use (each one holds a Rust resource). The `TrayIcon` handle is looked up
// once and kept: closing it would remove the tray icon from the app
// (tauri `Resource for TrayIcon::close`). Tauri modules are imported on use
// (see tauri-gateway.ts).

import type { TrayIcon } from "@tauri-apps/api/tray";
import { isTauri } from "@/lib/runtime";
import {
  isTaskbarAttentionActive,
  setTaskbarAttention,
} from "./desktop-toasts";
import type { BadgeState } from "./types";

const TRAY_ID = "main";
const DEFAULT_TOOLTIP = "Ralph Meet";
const BADGE_ICON_SIZE = 64;
const BADGE_RED = [239, 68, 68, 255] as const;
const WHITE = [255, 255, 255, 255] as const;

interface BaseIcon {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** What the tray shows now, as far as this page applied it. */
let appliedTooltip: string | null = null;
/** "default", "dot" or the badge label ("1".."99", "99+"). */
let appliedIcon: string | null = null;
let overlayCleared = false;
let tray: Promise<TrayIcon | null> | null = null;
let baseIcon: Promise<BaseIcon | null> | null = null;
let pendingState: BadgeState | null = null;
let drain: Promise<void> | null = null;

function iconKey(state: BadgeState): string {
  if (state.showDot) return "dot";
  if (state.count <= 0) return "default";
  return state.count > 99 ? "99+" : String(state.count);
}

function getTray(): Promise<TrayIcon | null> {
  tray ??= import("@tauri-apps/api/tray")
    .then(({ TrayIcon }) => TrayIcon.getById(TRAY_ID))
    .then(
      (found) => {
        if (!found) tray = null; // not created yet: ask again next time
        return found;
      },
      (error: unknown) => {
        tray = null;
        throw error;
      },
    );
  return tray;
}

/** The app icon's pixels, read once; its Image is closed right after. */
function getBaseIcon(): Promise<BaseIcon | null> {
  baseIcon ??= (async () => {
    const { defaultWindowIcon } = await import("@tauri-apps/api/app");
    const image = await defaultWindowIcon();
    if (!image) return null;
    try {
      const [size, rgba] = await Promise.all([image.size(), image.rgba()]);
      return { rgba, width: size.width, height: size.height };
    } finally {
      await image.close().catch(() => undefined);
    }
  })().catch((error: unknown) => {
    baseIcon = null;
    throw error;
  });
  return baseIcon;
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function fillCircle(
  rgba: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  color: readonly number[],
) {
  const radiusSq = radius * radius;
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSq) continue;
      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
}

function fillRect(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  rectW: number,
  rectH: number,
  color: readonly number[],
) {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(width, x + rectW);
  const endY = Math.min(width, y + rectH);
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const idx = (py * width + px) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
}

/** 6x10 glyphs as [x, y, w, h] rectangles. */
const GLYPHS: Record<
  string,
  ReadonlyArray<readonly [number, number, number, number]>
> = {
  "0": [
    [1, 0, 4, 2],
    [0, 2, 2, 6],
    [4, 2, 2, 6],
    [1, 8, 4, 2],
  ],
  "1": [
    [2, 0, 2, 10],
    [1, 8, 4, 2],
  ],
  "2": [
    [1, 0, 4, 2],
    [4, 2, 2, 2],
    [1, 4, 4, 2],
    [0, 6, 2, 2],
    [0, 8, 6, 2],
  ],
  "3": [
    [1, 0, 4, 2],
    [4, 2, 2, 2],
    [1, 4, 4, 2],
    [4, 6, 2, 2],
    [1, 8, 4, 2],
  ],
  "4": [
    [0, 0, 2, 6],
    [4, 0, 2, 10],
    [1, 4, 4, 2],
  ],
  "5": [
    [0, 0, 6, 2],
    [0, 2, 2, 2],
    [1, 4, 4, 2],
    [4, 6, 2, 2],
    [1, 8, 4, 2],
  ],
  "6": [
    [1, 0, 4, 2],
    [0, 2, 2, 6],
    [1, 4, 4, 2],
    [4, 6, 2, 2],
    [1, 8, 4, 2],
  ],
  "7": [
    [0, 0, 6, 2],
    [4, 2, 2, 8],
  ],
  "8": [
    [1, 0, 4, 2],
    [0, 2, 2, 2],
    [4, 2, 2, 2],
    [1, 4, 4, 2],
    [0, 6, 2, 2],
    [4, 6, 2, 2],
    [1, 8, 4, 2],
  ],
  "9": [
    [1, 0, 4, 2],
    [0, 2, 2, 2],
    [4, 2, 2, 6],
    [1, 4, 4, 2],
    [1, 8, 4, 2],
  ],
  "+": [
    [2, 1, 2, 8],
    [0, 4, 6, 2],
  ],
};

function drawBadgeLabel(
  rgba: Uint8Array,
  width: number,
  label: string,
  centerX: number,
  centerY: number,
) {
  const glyphWidth = 6;
  const glyphHeight = 10;
  const spacing = 2;
  const totalWidth =
    label.length * glyphWidth + Math.max(0, label.length - 1) * spacing;
  let cursorX = centerX - Math.floor(totalWidth / 2);
  const topY = centerY - Math.floor(glyphHeight / 2);
  for (const char of label) {
    for (const [x, y, w, h] of GLYPHS[char] ?? []) {
      fillRect(rgba, width, cursorX + x, topY + y, w, h, WHITE);
    }
    cursorX += glyphWidth + spacing;
  }
}

/** The badge on a blank square, for an app without a window icon. */
function drawBadgeOnly(state: BadgeState): BaseIcon {
  const rgba = new Uint8Array(BADGE_ICON_SIZE * BADGE_ICON_SIZE * 4);
  const centerX =
    state.showDot || state.count < 10
      ? BADGE_ICON_SIZE - 18
      : BADGE_ICON_SIZE - 20;
  const centerY = 18;
  const radius = state.showDot ? 10 : state.count < 10 ? 16 : 18;
  fillCircle(rgba, BADGE_ICON_SIZE, centerX, centerY, radius, BADGE_RED);
  if (!state.showDot && state.count > 0) {
    drawBadgeLabel(rgba, BADGE_ICON_SIZE, iconKey(state), centerX, centerY);
  }
  return { rgba, width: BADGE_ICON_SIZE, height: BADGE_ICON_SIZE };
}

/** The app icon with the badge in its top-right corner. */
export function drawBadgedIcon(
  base: BaseIcon | null,
  state: BadgeState,
): BaseIcon {
  if (!base) return drawBadgeOnly(state);
  const { width, height } = base;
  const rgba = new Uint8Array(base.rgba);
  const badgeRadius = Math.max(
    8,
    Math.floor(
      Math.min(width, height) *
        (state.showDot || state.count > 99 ? 0.28 : 0.3),
    ),
  );
  const centerX = width - badgeRadius - 2;
  const centerY = badgeRadius + 2;
  fillCircle(rgba, width, centerX, centerY, badgeRadius, BADGE_RED);
  if (!state.showDot && state.count > 0) {
    drawBadgeLabel(rgba, width, iconKey(state), centerX, centerY);
  }
  return { rgba, width, height };
}

// ── Applying ────────────────────────────────────────────────────────────────

async function setTrayIcon(trayIcon: TrayIcon, pixels: BaseIcon) {
  const { Image } = await import("@tauri-apps/api/image");
  const image = await Image.new(pixels.rgba, pixels.width, pixels.height);
  try {
    await trayIcon.setIcon(image);
  } finally {
    await image.close().catch(() => undefined);
  }
}

async function applyBadgeNow(state: BadgeState) {
  if (!isTauri()) return;

  const key = iconKey(state);
  const tooltip = state.tooltip || DEFAULT_TOOLTIP;
  const clearing = key === "default";

  // A fresh process already shows the default icon and no taskbar
  // attention. Do not cross the CEF tray IPC at startup just to clear state
  // that cannot exist yet; this runs while the main window is hidden and can
  // otherwise block the updater renderer.
  if (clearing && appliedIcon === null && !isTaskbarAttentionActive()) return;

  const iconChanged = key !== appliedIcon;
  const tooltipChanged = tooltip !== appliedTooltip;
  const stopAttention = clearing && isTaskbarAttentionActive();
  if (!iconChanged && !tooltipChanged && !stopAttention) return;

  const trayIcon = await getTray();
  if (trayIcon && tooltipChanged) {
    await trayIcon.setTooltip(tooltip);
    appliedTooltip = tooltip;
  }

  if (!overlayCleared) {
    // Keep Windows taskbar flashing separate from unread-state badging.
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()
      .setOverlayIcon()
      .catch(() => {
        /* taskbar overlay unavailable */
      });
    overlayCleared = true;
  }

  if (iconChanged) {
    const base = await getBaseIcon();
    if (trayIcon) {
      if (clearing) {
        if (base) await setTrayIcon(trayIcon, base);
      } else {
        await setTrayIcon(trayIcon, drawBadgedIcon(base, state));
      }
    }
    appliedIcon = key;
  }

  if (clearing) await setTaskbarAttention(false);
}

/**
 * Show this badge. Calls made while one is being applied collapse into the
 * latest state; unchanged states cost no IPC.
 */
export function applyTrayBadge(state: BadgeState): Promise<void> {
  pendingState = state;
  if (drain) return drain;

  const run = (async () => {
    let firstError: unknown = null;
    while (pendingState) {
      const next = pendingState;
      pendingState = null;
      try {
        await applyBadgeNow(next);
      } catch (error: unknown) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  })();
  drain = run.finally(() => {
    drain = null;
  });
  return drain;
}

/** Test-only: forget what was applied and the cached handles. */
export function resetTrayBadgeForTests() {
  appliedTooltip = null;
  appliedIcon = null;
  overlayCleared = false;
  tray = null;
  baseIcon = null;
  pendingState = null;
  drain = null;
}
