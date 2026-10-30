import { isTauri } from "@/lib/platform";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether the app is worth drawing (talk-tree-spec §5f). It is inactive when
 *
 *   - the document is hidden (background tab, minimised window), or
 *   - the Tauri window is minimised, or
 *   - the Tauri window is unfocused AND covered (a fullscreen game). The
 *     cover signal comes from the native shell as the `rm://occlusion`
 *     event (payload: boolean), or from `setAppOccluded()`; until the shell
 *     emits it, an unfocused desktop window stays active so a stream on a
 *     second monitor keeps playing.
 *
 * One module-level store feeds every caller, with listeners attached on the
 * first subscriber and removed after the last. SSR and tests see "active".
 *
 *   const active = useAppActive();
 *   useEffect(() => { if (!active) return; const id = requestAnimationFrame(…); … }, [active]);
 *
 * `<AppActiveRoot />` (mounted once in routes/__root.tsx) mirrors the state
 * onto `<html data-app-inactive>`, where one CSS rule pauses every
 * animation.
 */

type Activity = {
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  occluded: boolean;
};

let activity: Activity = {
  visible: true,
  focused: true,
  minimized: false,
  occluded: false,
};
let active = true;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

export function computeAppActive(state: Activity, desktop: boolean): boolean {
  if (!state.visible) return false;
  if (desktop && state.minimized) return false;
  if (desktop && !state.focused && state.occluded) return false;
  return true;
}

function update(patch: Partial<Activity>) {
  activity = { ...activity, ...patch };
  const next = computeAppActive(activity, isTauri());
  if (next === active) return;
  active = next;
  listeners.forEach((listener) => listener());
}

/** The native shell (or a test) reports whether the window is covered. */
export function setAppOccluded(occluded: boolean) {
  update({ occluded });
}

/** Run every cleanup even if one throws. */
function runAll(cleanups: Array<() => void>) {
  for (const off of cleanups.splice(0)) {
    try {
      off();
    } catch {
      // A listener that is already gone; keep removing the rest.
    }
  }
}

function attach(): () => void {
  if (typeof document === "undefined") return () => {};
  const cleanups: Array<() => void> = [];
  let disposed = false;
  /** Track one unlisten; one that lands after dispose runs at once. */
  const keep = (off: () => void) => {
    if (disposed) runAll([off]);
    else cleanups.push(off);
  };
  const dispose = () => {
    disposed = true;
    runAll(cleanups);
  };

  const onVisibility = () =>
    update({ visible: document.visibilityState !== "hidden" });
  const onFocus = () => update({ focused: true });
  const onBlur = () => update({ focused: false });

  try {
    document.addEventListener("visibilitychange", onVisibility);
    keep(() => document.removeEventListener("visibilitychange", onVisibility));
    window.addEventListener("focus", onFocus);
    keep(() => window.removeEventListener("focus", onFocus));
    window.addEventListener("blur", onBlur);
    keep(() => window.removeEventListener("blur", onBlur));
    onVisibility();
    update({ focused: document.hasFocus?.() ?? true });
  } catch {
    // Do not leave half the listeners behind when setup fails; the app
    // just stays "active", as it does under SSR.
    dispose();
    return () => {};
  }

  if (isTauri()) {
    void (async () => {
      try {
        const [{ getCurrentWindow }, { listen }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/event"),
        ]);
        if (disposed) return;
        const win = getCurrentWindow();
        // Keep each unlisten as soon as it exists, so a later step that
        // throws cannot strand the earlier ones.
        keep(
          await win.onFocusChanged(({ payload }) =>
            update({ focused: payload }),
          ),
        );
        keep(
          await win.onResized(() => {
            void win
              .isMinimized()
              .then((minimized) => update({ minimized }))
              .catch(() => {});
          }),
        );
        keep(
          await listen<boolean>("rm://occlusion", (event) =>
            update({ occluded: event.payload === true }),
          ),
        );
      } catch {
        // Not a Tauri window we can talk to: the DOM signals still apply.
      }
    })();
  }

  return dispose;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

const getSnapshot = () => active;
const getServerSnapshot = () => true;

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Mount once at the root: mirrors activity onto `<html data-app-inactive>`. */
export function AppActiveRoot() {
  const isActive = useAppActive();
  useEffect(() => {
    const root = document.documentElement;
    if (isActive) root.removeAttribute("data-app-inactive");
    else root.setAttribute("data-app-inactive", "");
  }, [isActive]);
  useEffect(() => {
    return () => {
      document.documentElement.removeAttribute("data-app-inactive");
    };
  }, []);
  return null;
}
