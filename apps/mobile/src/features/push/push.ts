import { Option, Schema } from "effect";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { useChatStore } from "@/features/chat/store";
import { apiFetch } from "@/lib/api";
import { config } from "@/lib/config";

// Message pushes over FCM. The server sends a notification + data message
// (src/services/push.service.ts) on the `messages` channel; Android shows it
// while the app is in the background. In the foreground expo-notifications
// asks the handler below, which hides it when that conversation is open.

/** Matches MESSAGES_CHANNEL_ID on the server and the plugin's defaultChannel. */
const MESSAGES_CHANNEL_ID = "messages";

const PushTarget = Schema.Struct({
  channelId: Schema.String,
  serverId: Schema.optional(Schema.String),
});
export type PushTarget = typeof PushTarget.Type;
const decodeTarget = Schema.decodeUnknownOption(PushTarget);

/**
 * The conversation a push points at. FCM's data map is `content.data` when
 * the push was tapped from the tray, and the remote message's data when it
 * arrived with the app open.
 */
export function pushTarget(
  notification: Notifications.Notification,
): PushTarget | null {
  const { content, trigger } = notification.request;
  const remote =
    trigger && "type" in trigger && trigger.type === "push"
      ? trigger.remoteMessage?.data
      : undefined;
  for (const candidate of [content.data, remote]) {
    const target = decodeTarget(candidate);
    if (Option.isSome(target)) return target.value;
  }
  return null;
}

/** The handler and channel; call once at startup, before asking permission. */
export function configurePush(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const target = pushTarget(notification);
      const open =
        target !== null &&
        useChatStore.getState().openChannelId === target.channelId;
      return {
        shouldShowBanner: !open,
        shouldShowList: !open,
        shouldPlaySound: !open,
        shouldSetBadge: false,
      };
    },
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL_ID, {
      name: "Messages",
      description: "Direct messages, mentions and replies",
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  }
}

/** Asks for POST_NOTIFICATIONS the first time only; true when granted. */
export async function ensurePushPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.status !== Notifications.PermissionStatus.UNDETERMINED) {
    return false;
  }
  return (await Notifications.requestPermissionsAsync()).granted;
}

// The token this device last registered, so sign-out can unregister it.
let registeredToken: string | null = null;

/** POST /api/push-tokens; re-owns the token to whoever is signed in. */
export async function registerPushToken(token: string): Promise<void> {
  const response = await apiFetch("/api/push-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      app_variant: config.appVariant,
    }),
  });
  if (__DEV__) {
    console.info(`[push] register ${response.status}`);
  }
  if (response.ok) registeredToken = token;
}

/** The native FCM token (not an Expo push token), or null without one. */
export async function devicePushToken(): Promise<string | null> {
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === "string" ? data : null;
  } catch {
    // No Play services, or FCM unreachable: no pushes on this device.
    return null;
  }
}

const UNREGISTER_TIMEOUT_MS = 3000;

/**
 * DELETE /api/push-tokens before sign-out clears the session, so this phone
 * stops getting the account's pushes. Bounded: offline, sign-out goes on.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken ?? (await devicePushToken());
  if (!token) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UNREGISTER_TIMEOUT_MS);
  try {
    await apiFetch("/api/push-tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: abort.signal,
    });
    registeredToken = null;
  } catch {
    // The server drops it when FCM next reports it dead.
  } finally {
    clearTimeout(timer);
  }
}
