import {
  getDesktopNotificationBadgeState,
  toDesktopNotificationSyncPayload,
} from "@/lib/desktop-notifications";
import { invoke } from "@tauri-apps/api/core";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createChannel,
  Importance,
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
  Visibility,
  type NotificationActionEvent,
  type NotificationOptions,
} from "@tauri-apps/plugin-notification";
import { isTauri } from "@/lib/platform";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { clog } from "@/lib/console-logger";
import type { Notification as AppNotification } from "@/lib/types";

const desktopNotificationsLog = clog("DesktopNotifications");
const BADGE_ICON_SIZE = 64;
const BADGE_RED = [239, 68, 68, 255] as const;
const WHITE = [255, 255, 255, 255] as const;
export const MOBILE_ACTION_TYPE_ID = "messages";
let notificationPluginInitialized = false;
let notificationActionUnlisten: (() => void) | null = null;

interface NativeSyncInput {
  notifications: AppNotification[];
  unreadDmChannelIds: Iterable<string>;
  unreadServerChannelIds: Iterable<string>;
}

function isDesktopTauriRuntime() {
  return isTauri() && typeof window !== "undefined";
}

async function setTaskbarNotificationAttention(active: boolean) {
  if (!isDesktopTauriRuntime()) return;
  await invoke("set_taskbar_notification_attention", { active }).catch(() => {
    /* taskbar attention unavailable */
  });
}

async function ensureNotificationPluginReady() {
  if (!isDesktopTauriRuntime() || notificationPluginInitialized) return;

  try {
    await createChannel({
      id: "messages",
      name: "Messages",
      description: "Message and mention notifications",
      importance: Importance.High,
      visibility: Visibility.Private,
      vibration: true,
    });
  } catch {
    // Channel creation is best-effort and can fail if it already exists.
  }

  try {
    await registerActionTypes([
      {
        id: MOBILE_ACTION_TYPE_ID,
        actions: [
          {
            id: "reply",
            title: "Reply",
            input: true,
            inputButtonTitle: "Send",
            inputPlaceholder: "Type your reply...",
            foreground: true,
          },
          {
            id: "mark-read",
            title: "Mark as Read",
            foreground: false,
          },
        ],
      },
    ]);
  } catch {
    // Unsupported on desktop; safe to ignore.
  }

  try {
    notificationActionUnlisten = await onAction((event: NotificationActionEvent) => {
      desktopNotificationsLog.info("Notification action received", event);
      const messageId = event.notification?.extra?.messageId;
      const channelId = event.notification?.extra?.channelId;
      if (event.actionId === "mark-read" && channelId) {
        window.dispatchEvent(new CustomEvent("notification-mark-read", {
          detail: { channelId, messageId },
        }));
      }
      if (event.actionId === "reply" && channelId && event.inputValue?.trim()) {
        window.dispatchEvent(new CustomEvent("notification-reply", {
          detail: {
            channelId,
            messageId,
            content: event.inputValue.trim(),
          },
        }));
      }
    });
  } catch {
    // Desktop may not support action callbacks.
  }

  notificationPluginInitialized = true;
}

async function ensureNotificationPermission() {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  return granted;
}

function createBlankRgba(size: number) {
  return new Uint8Array(size * size * 4);
}

function fillCircle(rgba: Uint8Array, width: number, cx: number, cy: number, radius: number, color: readonly number[]) {
  const radiusSq = radius * radius;
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) + (dy * dy) > radiusSq) continue;
      const idx = ((y * width) + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
}

function fillRect(rgba: Uint8Array, width: number, x: number, y: number, rectW: number, rectH: number, color: readonly number[]) {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(width, x + rectW);
  const endY = Math.min(width, y + rectH);
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const idx = ((py * width) + px) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
}

function drawGlyph(rgba: Uint8Array, width: number, char: string, x: number, y: number) {
  switch (char) {
    case "0":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 2, 2, 6, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 6, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "1":
      fillRect(rgba, width, x + 2, y, 2, 10, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "2":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x, y + 8, 6, 2, WHITE);
      break;
    case "3":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "4":
      fillRect(rgba, width, x, y, 2, 6, WHITE);
      fillRect(rgba, width, x + 4, y, 2, 10, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      break;
    case "5":
      fillRect(rgba, width, x, y, 6, 2, WHITE);
      fillRect(rgba, width, x, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "6":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 2, 2, 6, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "7":
      fillRect(rgba, width, x, y, 6, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 8, WHITE);
      break;
    case "8":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "9":
      fillRect(rgba, width, x + 1, y, 4, 2, WHITE);
      fillRect(rgba, width, x, y + 2, 2, 2, WHITE);
      fillRect(rgba, width, x + 4, y + 2, 2, 6, WHITE);
      fillRect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
      fillRect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
      break;
    case "+":
      fillRect(rgba, width, x + 2, y + 1, 2, 8, WHITE);
      fillRect(rgba, width, x, y + 4, 6, 2, WHITE);
      break;
  }
}

function drawBadgeLabel(rgba: Uint8Array, width: number, label: string, centerX: number, centerY: number) {
  const glyphWidth = 6;
  const glyphHeight = 10;
  const spacing = 2;
  const totalWidth = (label.length * glyphWidth) + ((Math.max(0, label.length - 1)) * spacing);
  let cursorX = centerX - Math.floor(totalWidth / 2);
  const topY = centerY - Math.floor(glyphHeight / 2);
  for (const char of label) {
    drawGlyph(rgba, width, char, cursorX, topY);
    cursorX += glyphWidth + spacing;
  }
}

async function createBadgeImage(options: { count: number; showDot: boolean }) {
  const rgba = createBlankRgba(BADGE_ICON_SIZE);
  const centerX = options.showDot || options.count < 10 ? BADGE_ICON_SIZE - 18 : BADGE_ICON_SIZE - 20;
  const centerY = 18;
  const radius = options.showDot ? 10 : (options.count < 10 ? 16 : 18);
  fillCircle(rgba, BADGE_ICON_SIZE, centerX, centerY, radius, BADGE_RED);
  if (!options.showDot && options.count > 0) {
    drawBadgeLabel(rgba, BADGE_ICON_SIZE, options.count > 99 ? "99+" : String(options.count), centerX, centerY);
  }
  return Image.new(rgba, BADGE_ICON_SIZE, BADGE_ICON_SIZE);
}

async function createTrayIconWithBadge(options: { count: number; showDot: boolean }) {
  const baseIcon = await defaultWindowIcon();
  if (!baseIcon) return createBadgeImage(options);

  const size = await baseIcon.size();
  const rgba = await baseIcon.rgba();
  const width = size.width;
  const height = size.height;
  const badgeRadius = Math.max(8, Math.floor(Math.min(width, height) * (options.showDot || options.count > 99 ? 0.28 : 0.30)));
  const centerX = width - badgeRadius - 2;
  const centerY = badgeRadius + 2;
  fillCircle(rgba, width, centerX, centerY, badgeRadius, BADGE_RED);
  if (!options.showDot && options.count > 0) {
    drawBadgeLabel(rgba, width, options.count > 99 ? "99+" : String(options.count), centerX, centerY);
  }
  return Image.new(rgba, width, height);
}

export async function applyDesktopBadgeState(input: { count: number; showDot: boolean; tooltip: string }) {
  if (!isDesktopTauriRuntime()) return;
  const tray = await TrayIcon.getById("main");
  const window = getCurrentWindow();
  const tooltip = input.tooltip || "Ralph Meet";
  if (tray) {
    await tray.setTooltip(tooltip);
  }

  // Keep Windows taskbar flashing separate from unread-state badging.
  await window.setOverlayIcon().catch(() => {
    /* taskbar overlay unavailable */
  });

  if (input.count === 0 && !input.showDot) {
    const defaultIcon = await defaultWindowIcon();
    if (tray && defaultIcon) {
      await tray.setIcon(defaultIcon);
    }
    await setTaskbarNotificationAttention(false);
    return;
  }

  const trayIcon = await createTrayIconWithBadge({ count: input.count, showDot: input.showDot });
  if (tray) {
    await tray.setIcon(trayIcon);
  }
}

export async function syncDesktopNotificationState(input: NativeSyncInput) {
  if (!isDesktopTauriRuntime()) {
    return;
  }

  await ensureNotificationPluginReady();

  if (!useDesktopSettingsStore.getState().desktopNotifications) {
    desktopNotificationsLog.info("Clearing native desktop notification state");
    await applyDesktopBadgeState({ count: 0, showDot: false, tooltip: "Ralph Meet" }).catch(() => {
      /* desktop badge clear unavailable */
    });
    return;
  }

  const badge = getDesktopNotificationBadgeState({
    notifications: input.notifications,
    unreadDmChannelIds: input.unreadDmChannelIds,
    unreadServerChannelIds: input.unreadServerChannelIds,
  });

  const payload = toDesktopNotificationSyncPayload(badge);
  desktopNotificationsLog.info("Syncing native desktop notification state", payload);
  await applyDesktopBadgeState(payload).catch(() => {
    /* desktop notification sync unavailable */
  });
}

export async function showNativeDesktopToast(input: NotificationOptions) {
  if (!isDesktopTauriRuntime()) {
    return;
  }

  await ensureNotificationPluginReady();
  const permissionGranted = await ensureNotificationPermission();
  if (permissionGranted) {
    desktopNotificationsLog.info("Showing native desktop toast", input);
    sendNotification(input);
  }

  await setTaskbarNotificationAttention(true);
}

export function teardownDesktopNotificationSync() {
  notificationActionUnlisten?.();
  notificationActionUnlisten = null;
  notificationPluginInitialized = false;
}
