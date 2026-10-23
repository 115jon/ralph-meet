import { useSyncExternalStore } from "react";

/**
 * Whether the on-screen keyboard is (very likely) up.
 *
 * Two signals, because browsers disagree: iOS Safari keeps the layout
 * viewport and shrinks `visualViewport`, while Android Chrome with
 * `interactive-widget=resizes-content` shrinks both. So: a visual viewport
 * much shorter than the layout viewport, or a focused text field on a coarse
 * pointer.
 */
const KEYBOARD_MIN_PX = 120;

function isEditable(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLTextAreaElement) return !node.readOnly;
  if (node instanceof HTMLInputElement) {
    return (
      !node.readOnly &&
      !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(
        node.type,
      )
    );
  }
  return false;
}

function read(): boolean {
  if (typeof window === "undefined") return false;
  const viewport = window.visualViewport;
  if (viewport && window.innerHeight - viewport.height > KEYBOARD_MIN_PX) {
    return true;
  }
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return coarse && isEditable(document.activeElement);
}

function subscribe(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  // focusout fires before the next element is focused; read after it lands.
  const deferred = () => requestAnimationFrame(listener);
  window.addEventListener("focusin", listener);
  window.addEventListener("focusout", deferred);
  window.visualViewport?.addEventListener("resize", listener);
  return () => {
    window.removeEventListener("focusin", listener);
    window.removeEventListener("focusout", deferred);
    window.visualViewport?.removeEventListener("resize", listener);
  };
}

export function useSoftKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
