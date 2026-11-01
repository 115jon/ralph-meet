import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Whether this app may post notifications, re-read whenever the app comes
 * back to the foreground (e.g. from system settings). Null until known.
 */
export function useNotificationPermission(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      Notifications.getPermissionsAsync()
        .then((p) => {
          if (live) setGranted(p.granted);
        })
        .catch(() => undefined);
    void read();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void read();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return granted;
}
