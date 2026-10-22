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

// All active handlers share one browser history entry. Keeping one entry for
// the stack avoids one handler's delayed cleanup consuming another handler's
// entry during rapid dialog transitions.
let ownsHistoryEntry = false;
let programmaticPopPending = false;
let historyCleanupTimeout: ReturnType<typeof setTimeout> | null = null;

function ensureHistoryEntry() {
  if (typeof window === "undefined" || isTauri() || ownsHistoryEntry) {
    return;
  }

  window.history.pushState({ backHandlerOpen: true }, "");
  ownsHistoryEntry = true;
}

function releaseHistoryEntry() {
  if (
    typeof window === "undefined" ||
    isTauri() ||
    !ownsHistoryEntry ||
    historyCleanupTimeout !== null
  ) {
    return;
  }

  historyCleanupTimeout = setTimeout(() => {
    historyCleanupTimeout = null;
    if (backHandlers.length > 0 || !ownsHistoryEntry) return;

    ownsHistoryEntry = false;
    programmaticPopPending = true;
    try {
      window.history.go(-1);
    } catch {
      programmaticPopPending = false;
    }
  }, 10);
}

function cancelHistoryRelease() {
  if (historyCleanupTimeout === null) return;
  clearTimeout(historyCleanupTimeout);
  historyCleanupTimeout = null;
}

function initGlobalBackListener() {
  if (typeof window === "undefined" || hasRegisteredGlobalListener) return;

  hasRegisteredGlobalListener = true;

  // Web Browser Listener (handles browser back button or Android back button in PWA)
  window.addEventListener("popstate", () => {
    if (programmaticPopPending) {
      programmaticPopPending = false;
      return;
    }

    ownsHistoryEntry = false;
    const handled = executeBackHandlers();
    if (handled) {
      // Allow React to remove a handler that closed before deciding whether
      // another active handler needs a replacement entry.
      setTimeout(() => {
        if (backHandlers.length > 0) ensureHistoryEntry();
      }, 0);
    }
  });

  // Tauri Native Listener (handles Android back button in native Tauri app)
  if (isTauri() && isMobile()) {
    Promise.all([import("@tauri-apps/api/app"), import("@tauri-apps/api/core")])
      .then(([{ onBackButtonPress }, { invoke }]) => {
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
      })
      .catch(console.error);
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

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!active) return;

    cancelHistoryRelease();
    ensureHistoryEntry();

    const proxyHandler = () => {
      return handlerRef.current();
    };

    const cleanup = registerBackHandler(proxyHandler);

    return () => {
      cleanup();

      releaseHistoryEntry();
    };
  }, [active]);
}

/** Registers a dialog host above the screen's base back handler. */
export function useDialogBackButton(
  open: boolean,
  onClose: () => void,
  isTopmost?: () => boolean,
) {
  useBackButton(() => {
    if (isTopmost && !isTopmost()) return false;
    onClose();
    return true;
  }, open);
}
