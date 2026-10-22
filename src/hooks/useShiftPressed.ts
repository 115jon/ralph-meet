import { useSyncExternalStore } from "react";

let shiftPressed = false;
let attached = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function handleKey(event: KeyboardEvent) {
  const next = event.shiftKey;
  if (next === shiftPressed) return;
  shiftPressed = next;
  notify();
}

function handleBlur() {
  if (!shiftPressed) return;
  shiftPressed = false;
  notify();
}

function ensureAttached() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("keydown", handleKey);
  window.addEventListener("keyup", handleKey);
  window.addEventListener("blur", handleBlur);
}

function subscribe(listener: () => void) {
  ensureAttached();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return shiftPressed;
}

function getServerSnapshot() {
  return false;
}

export function useShiftPressed() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
