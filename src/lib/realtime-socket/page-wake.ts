// ── Page wake ───────────────────────────────────────────────────────────────
// A backgrounded tab or a sleeping phone throttles or freezes timers, so a
// pending retry can sit for its whole backoff after the user is back, and a
// socket that died in the background is only noticed after three missed
// heartbeats. "Wake" is the page coming back: visible again, back online, or
// restored from the back/forward cache. Every realtime socket owner (the
// chat store, each SFUClient) subscribes here; the page gets one set of DOM
// listeners however many sockets are open.

type WakeListener = () => void;

const listeners = new Set<WakeListener>();
let detachDomListeners: (() => void) | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function attachDomListeners(): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "visible") notify();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", notify);
    window.removeEventListener("pageshow", notify);
  };
}

/** Calls `listener` whenever the page wakes; returns the unsubscribe. */
export function onPageWake(listener: WakeListener): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  listeners.add(listener);
  detachDomListeners ??= attachDomListeners();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachDomListeners) {
      detachDomListeners();
      detachDomListeners = null;
    }
  };
}
