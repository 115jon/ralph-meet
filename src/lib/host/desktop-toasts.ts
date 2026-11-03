// ── Desktop toasts and taskbar attention ────────────────────────────────────
// The notification plugin (channel, reply / mark-read actions) and the
// taskbar flash. Desktop adapter only.

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
import { clog } from "@/lib/console-logger";
import { isTauri } from "@/lib/runtime";
import { invokeCommand } from "./tauri-gateway";
import { MESSAGE_ACTION_TYPE_ID } from "./types";

const log = clog("DesktopNotifications");

type NotificationExtra = Record<string, unknown> & {
  channelId?: string;
  messageId?: string;
};

type NotificationWithExtra = Omit<NotificationOptions, "extra"> & {
  extra?: NotificationExtra;
};

type NotificationActionPayload = NotificationActionEvent &
  Partial<NotificationWithExtra> & {
    notification?: NotificationWithExtra | null;
  };

let pluginInitialized = false;
let pluginInitialization: Promise<void> | null = null;
let attentionActive = false;
let attentionChain = Promise.resolve();

/** Whether the taskbar is flashing, as far as this page knows. */
export function isTaskbarAttentionActive(): boolean {
  return attentionActive;
}

async function setTaskbarAttentionNow(active: boolean) {
  if (!isTauri()) return;
  await invokeCommand("set_taskbar_notification_attention", { active })
    .then(() => {
      attentionActive = active;
    })
    .catch(() => {
      /* taskbar attention unavailable */
    });
}

/** Flash or stop flashing the taskbar button. Calls run in order. */
export function setTaskbarAttention(active: boolean): Promise<void> {
  const next = attentionChain.then(() => setTaskbarAttentionNow(active));
  attentionChain = next.catch(() => undefined);
  return next;
}

/** Register the channel and the reply / mark-read actions, once per page. */
export async function ensureNotificationPluginReady() {
  if (!isTauri() || pluginInitialized) return;
  if (pluginInitialization) return pluginInitialization;

  const initialization = (async () => {
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
          id: MESSAGE_ACTION_TYPE_ID,
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
      await onAction((event: NotificationActionEvent) => {
        const payload = event as NotificationActionPayload;
        log.info("Notification action received", payload);
        const notification = payload.notification ?? payload;
        const messageId = notification.extra?.messageId;
        const channelId = notification.extra?.channelId;
        if (payload.actionId === "mark-read" && channelId) {
          window.dispatchEvent(
            new CustomEvent("notification-mark-read", {
              detail: { channelId, messageId },
            }),
          );
        }
        if (
          payload.actionId === "reply" &&
          channelId &&
          payload.inputValue?.trim()
        ) {
          window.dispatchEvent(
            new CustomEvent("notification-reply", {
              detail: {
                channelId,
                messageId,
                content: payload.inputValue.trim(),
              },
            }),
          );
        }
      });
    } catch {
      // Desktop may not support action callbacks.
    }

    pluginInitialized = true;
  })();
  pluginInitialization = initialization;
  try {
    await initialization;
  } finally {
    if (pluginInitialization === initialization) pluginInitialization = null;
  }
}

async function ensureNotificationPermission() {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  return granted;
}

export async function showDesktopToast(options: NotificationOptions) {
  if (!isTauri()) return;
  await ensureNotificationPluginReady();
  if (await ensureNotificationPermission()) {
    log.info("Showing native desktop toast", options);
    sendNotification(options);
  }
  await setTaskbarAttention(true);
}

/** Test-only: forget plugin and attention state. */
export function resetDesktopToastsForTests() {
  pluginInitialized = false;
  pluginInitialization = null;
  attentionActive = false;
  attentionChain = Promise.resolve();
}
