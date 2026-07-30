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
