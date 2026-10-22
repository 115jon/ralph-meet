import { useSyncExternalStore } from "react";

let scrolling = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setMessageListScrolling(next: boolean) {
  if (scrolling === next) return;
  scrolling = next;
  notify();
}

export function isMessageListScrolling() {
  return scrolling;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot() {
  return false;
}

export function useMessageListScrolling() {
  return useSyncExternalStore(
    subscribe,
    isMessageListScrolling,
    getServerSnapshot,
  );
}
