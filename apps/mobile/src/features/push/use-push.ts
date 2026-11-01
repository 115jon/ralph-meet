import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { useSession } from "@/features/auth/session";
import { goToConversation } from "@/features/conversation/navigation";

import {
  devicePushToken,
  ensurePushPermission,
  pushTarget,
  registerPushToken,
} from "./push";

/**
 * While signed in: ask for notifications once, register this device's FCM
 * token (again whenever FCM rotates it) and open the conversation a tapped
 * push points at, including the push that launched the app.
 */
export function usePush(): void {
  const token = useSession((s) => s.token);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!token) return;
    let live = true;
    const register = (deviceToken: string) =>
      registerPushToken(deviceToken).catch(() => undefined);

    // The token is registered even if permission is refused, so allowing
    // notifications later in system settings needs nothing more.
    void ensurePushPermission()
      .catch(() => false)
      .then(devicePushToken)
      .then((deviceToken) => {
        if (__DEV__ && deviceToken) {
          console.info(
            `[push] fcm token ${deviceToken.length} chars, ${deviceToken.slice(0, 8)}…`,
          );
        }
        if (live && deviceToken) return register(deviceToken);
      });
    const rotation = Notifications.addPushTokenListener(({ data }) => {
      if (typeof data === "string") void register(data);
    });
    return () => {
      live = false;
      rotation.remove();
    };
  }, [token]);

  useEffect(() => {
    if (!token || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }
    Notifications.clearLastNotificationResponse();
    const target = pushTarget(response.notification);
    if (!target) return;
    goToConversation(
      { kind: target.serverId ? "channel" : "dm", id: target.channelId },
      target.messageId,
    );
  }, [token, response]);
}
