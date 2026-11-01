import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribe(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function isActive(): boolean {
  return AppState.currentState === "active";
}

/** Whether the app is in front; media loops stop the moment it is not. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, isActive);
}
