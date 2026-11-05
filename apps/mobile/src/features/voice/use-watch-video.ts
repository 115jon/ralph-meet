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
 * Shows remote camera and screen video while the calling screen is focused
 * and the app is in front (or shrunk into its PiP window); new video is
 * pulled only then. Minimising the call or opening another screen hides it
 * but keeps what was pulled (a web camera drops to its lowest layer).
 * Backgrounding the app outside PiP closes every video pull (actions.ts,
 * onAppStateChange); audio keeps playing either way. See RemoteVideo.
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
