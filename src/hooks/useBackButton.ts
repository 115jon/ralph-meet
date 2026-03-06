import { isTauri } from "@/lib/platform";
import { useEffect } from "react";

type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];
let hasRegisteredGlobalListener = false;

function initGlobalBackListener() {
  if (!isTauri() || typeof window === "undefined" || hasRegisteredGlobalListener) return;

  hasRegisteredGlobalListener = true;
  import("@tauri-apps/api/app").then(({ onBackButtonPress }) => {
    onBackButtonPress((_event) => {
      // Execute the LIFO queue of specific back handlers
      return executeBackHandlers();
    }).catch(console.error);
  });
}

/**
 * Registers a handler to be called when the hardware back button is pressed.
 * The handler should return `true` to consume the event, or `false` to pass it on.
 * Handlers are evaluated in reverse order of registration (LIFO stack).
 */
export function registerBackHandler(handler: BackHandler) {
  initGlobalBackListener();
  backHandlers.push(handler);
  return () => {
    const index = backHandlers.indexOf(handler);
    if (index > -1) {
      backHandlers.splice(index, 1);
    }
  };
}

export function executeBackHandlers(): boolean {
  // Loop backwards to execute the most recently added handler first
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    const handler = backHandlers[i];
    if (handler()) {
      return true; // Handled
    }
  }
  return false;
}

/**
 * React hook to easily register a back button handler.
 * @param handler Callback to run. Return true to consume the back event.
 * @param active Whether this listener is currently active (e.g., is a modal open?)
 */
export function useBackButton(handler: BackHandler, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(handler);
  }, [handler, active]);
}
