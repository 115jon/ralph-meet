import { isTauri } from "@/lib/platform";
import { useEffect, useRef } from "react";

/**
 * Represents a function that handles a back button press.
 * It should return `true` if the event is consumed, `false` otherwise.
 */
type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];
let hasRegisteredGlobalListener = false;

function initGlobalBackListener() {
  if (!isTauri() || typeof window === "undefined" || hasRegisteredGlobalListener) return;

  hasRegisteredGlobalListener = true;
  import("@tauri-apps/api/app").then(({ onBackButtonPress }) => {
    onBackButtonPress(async (event) => {
      // Execute the LIFO queue of specific back handlers
      const handled = executeBackHandlers();

      // If none of our app's specific hooks consumed the back button:
      if (!handled) {
        if (event.canGoBack) {
          window.history.back();
        } else {
          // If the WebView itself has no remaining history, close the application.
          // On mobile, Window API is not available to exit, so we must use the process plugin
          const { exit } = await import("@tauri-apps/plugin-process");
          exit(0).catch(console.error);
        }
      }
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


export function useBackButton(handler: BackHandler, active: boolean = true) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;

    // Register a proxy handler that calls the latest handler
    const proxyHandler = () => handlerRef.current();
    return registerBackHandler(proxyHandler);
  }, [active]);
}
