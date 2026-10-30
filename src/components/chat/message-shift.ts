/**
 * Shift state for the message list without React state.
 *
 * Holding Shift swaps the hover bar to its power-user variant (copy ID,
 * mark unread, delete without confirm). The old `useShiftPressed()` in every
 * row re-rendered every mounted message on each Shift keydown and keyup,
 * which is every capital letter typed in the composer. Instead one listener
 * sets `data-shift` on <html>; the bar swaps variants with CSS
 * (`in-data-shift:` / `not-in-data-shift:`), and click handlers read
 * `isShiftHeld()` or `event.shiftKey` at the moment of the click.
 */

let held = false;
let attached = false;

function apply(next: boolean) {
  if (next === held) return;
  held = next;
  const root = document.documentElement;
  if (next) root.dataset.shift = "";
  else delete root.dataset.shift;
}

function onKey(event: KeyboardEvent) {
  apply(event.shiftKey);
}

function onBlur() {
  apply(false);
}

/** Attach the single listener (idempotent; call from any row on mount). */
export function ensureShiftAttribute() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("keydown", onKey, { passive: true });
  window.addEventListener("keyup", onKey, { passive: true });
  window.addEventListener("blur", onBlur);
}

/** Whether Shift is held right now (read inside handlers, never in render). */
export function isShiftHeld(): boolean {
  return held;
}
