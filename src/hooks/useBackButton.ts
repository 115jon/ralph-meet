import { isMobile, isTauri } from "@/lib/platform";
import { useEffect, useRef } from "react";

/**
 * Represents a function that handles a back button press.
 * It should return `true` if the event is consumed, `false` otherwise.
 */
type BackHandler = () => boolean;

const backHandlers: BackHandler[] = [];
let hasRegisteredGlobalListener = false;
let globalInvoke: typeof import("@tauri-apps/api/core").invoke | null = null;

// For web history programmatic popping
let statesToPop = 0;
let popTimeout: ReturnType<typeof setTimeout> | null = null;

function popHistory() {
  if (statesToPop > 0) {
    window.history.go(-statesToPop);
    statesToPop = 0;
  }
}

function initGlobalBackListener() {
  if (typeof window === "undefined" || hasRegisteredGlobalListener) return;

  hasRegisteredGlobalListener = true;

  // Web Browser Listener (handles browser back button or Android back button in PWA)
  window.addEventListener("popstate", () => {
    executeBackHandlers();
  });

  // Tauri Native Listener (handles Android back button in native Tauri app)
  if (isTauri() && isMobile()) {
    Promise.all([
      import("@tauri-apps/api/app"),
      import("@tauri-apps/api/core")
    ]).then(([{ onBackButtonPress }, { invoke }]) => {
      globalInvoke = invoke;

      onBackButtonPress((event) => {
        // Execute the LIFO queue of specific back handlers
        const handled = executeBackHandlers();

        // If none of our app's specific hooks consumed the back button:
        if (!handled) {
          if (event.canGoBack) {
            window.history.back();
          } else {
            // If the WebView itself has no remaining history, close the application.
            if (globalInvoke) {
              globalInvoke("exit_app").catch(console.error);
            }
          }
        }
      }).catch(console.error);
    }).catch(console.error);
  }
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
  const isPushedRef = useRef(false);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;

    // Web: push state to intercept browser back
    if (typeof window !== "undefined" && !isTauri()) {
      window.history.pushState({ backHandlerOpen: true }, "");
      isPushedRef.current = true;
    }

    const proxyHandler = () => {
      if (isPushedRef.current) {
        isPushedRef.current = false; // Popped by user action
      }
      return handlerRef.current();
    };

    const cleanup = registerBackHandler(proxyHandler);

    return () => {
      cleanup();
      
      // If closed manually (not via back button), we must pop history to keep it clean
      if (isPushedRef.current && typeof window !== "undefined" && !isTauri()) {
        isPushedRef.current = false;
        statesToPop++;
        
        if (popTimeout) clearTimeout(popTimeout);
        popTimeout = setTimeout(popHistory, 10);
      }
    };
  }, [active]);
}
