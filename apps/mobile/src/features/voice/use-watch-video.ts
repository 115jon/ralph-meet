import { useIsFocused } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { setWatchingVideo } from "./actions";
import { usePipActive } from "./pip";

function subscribeAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function appInFront(): boolean {
  return AppState.currentState === "active";
}

/**
 * Pulls remote camera and screen video while the calling screen is focused
 * and the app is in front (or shrunk into its PiP window); minimising the
 * call, opening another screen or backgrounding the app stops the video
 * pulls (audio keeps playing).
 */
export function useWatchCallVideo(): void {
  const focused = useIsFocused();
  const inFront = useSyncExternalStore(subscribeAppState, appInFront);
  const pip = usePipActive();
  const watching = focused && (inFront || pip);

  useEffect(() => {
    setWatchingVideo(watching);
    return () => setWatchingVideo(false);
  }, [watching]);
}
