import { useSyncExternalStore } from "react";

type MediaQueryStore = {
  matches: boolean;
  mediaQuery: MediaQueryList | null;
  listeners: Set<() => void>;
  handleChange: (() => void) | null;
  listenerType: "event" | "legacy" | null;
  listening: boolean;
};

const stores = new Map<string, MediaQueryStore>();

function getStore(query: string): MediaQueryStore {
  let store = stores.get(query);
  if (!store) {
    store = {
      matches: false,
      mediaQuery: null,
      listeners: new Set(),
      handleChange: null,
      listenerType: null,
      listening: false,
    };
    stores.set(query, store);
  }
  return store;
}

function subscribeToMediaQuery(
  query: string,
  listener: () => void,
): () => void {
  const store = getStore(query);
  const wasEmpty = store.listeners.size === 0;
  store.listeners.add(listener);

  if (
    !store.mediaQuery &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    const mediaQuery = window.matchMedia(query);
    store.mediaQuery = mediaQuery;
    store.matches = mediaQuery.matches;
    store.handleChange = () => {
      store.matches = mediaQuery.matches;
      for (const subscribedListener of store.listeners) {
        subscribedListener();
      }
    };
  }

  if (store.mediaQuery) {
    store.matches = store.mediaQuery.matches;
    if (wasEmpty && store.handleChange && !store.listening) {
      if (typeof store.mediaQuery.addEventListener === "function") {
        store.mediaQuery.addEventListener("change", store.handleChange);
        store.listenerType = "event";
        store.listening = true;
      } else if (typeof store.mediaQuery.addListener === "function") {
        store.mediaQuery.addListener(store.handleChange);
        store.listenerType = "legacy";
        store.listening = true;
      }
    }
  }

  return () => {
    store.listeners.delete(listener);
    if (
      store.listeners.size === 0 &&
      store.mediaQuery &&
      store.handleChange &&
      store.listening
    ) {
      if (store.listenerType === "event") {
        store.mediaQuery.removeEventListener("change", store.handleChange);
      } else if (store.listenerType === "legacy") {
        store.mediaQuery.removeListener(store.handleChange);
      }
      store.listenerType = null;
      store.listening = false;
      store.mediaQuery = null;
      store.handleChange = null;
      stores.delete(query);
    }
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeToMediaQuery(query, listener),
    () => getStore(query).matches,
    () => false,
  );
}

/**
 * The one phone breakpoint: below Tailwind's `md` (768px). CSS uses `md:`;
 * JS uses these, so layout and behavior switch at the same width.
 */
export const MOBILE_MAX_WIDTH_PX = 767;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/** Event-time check (click handlers, positioning). */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(MOBILE_QUERY).matches;
  }
  return window.innerWidth <= MOBILE_MAX_WIDTH_PX;
}

function subscribeToViewport(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mediaQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_QUERY)
      : null;
  mediaQuery?.addEventListener?.("change", listener);
  // Resize too: covers environments without matchMedia change events.
  window.addEventListener("resize", listener);
  return () => {
    mediaQuery?.removeEventListener?.("change", listener);
    window.removeEventListener("resize", listener);
  };
}

/** True below `md`. Server render and first paint assume desktop. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    isMobileViewport,
    () => false,
  );
}

/** The one wide breakpoint: Tailwind's `lg` (1024px) and up. */
export const WIDE_MIN_WIDTH_PX = 1024;
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH_PX}px)`;

/** Event-time check for `lg`+ (pane drag handlers, positioning). */
export function isWideViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(WIDE_QUERY).matches;
  }
  return window.innerWidth >= WIDE_MIN_WIDTH_PX;
}
