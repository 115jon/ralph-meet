import * as React from "react";

/**
 * Back-button stacking shared by Dialog and Drawer. Every open modal surface
 * marks itself with data-dialog-root-id + data-dialog-back-enabled, and only
 * the last one in DOM order answers the hardware/browser back button.
 */
export function isDialogTopmost(id: string) {
  if (typeof document === "undefined") return true;

  // Radix dialogs mark open with data-state="open", Base UI drawers with
  // data-open; both portal to <body> in the order they opened.
  const surface = '[data-dialog-root-id][data-dialog-back-enabled="true"]';
  const openSurfaces = document.querySelectorAll<HTMLElement>(
    `${surface}[data-state="open"], ${surface}[data-open]`,
  );
  const topmostSurface = openSurfaces.item(openSurfaces.length - 1);

  return !topmostSurface || topmostSurface.dataset.dialogRootId === id;
}

/**
 * True for targets inside a Base UI drawer (ui/drawer.tsx) portal or a Base UI
 * popover/menu portal (ui/popover.tsx, ui/dropdown-menu.tsx). Those portal
 * outside Radix's layer stack, so a Radix dialog must not call them outside.
 */
export function isDrawerLayerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('[data-slot="drawer-portal"], [data-rm-floating-layer]')
  );
}

/**
 * Title/description detection for the auto sr-only fallbacks. Wrappers that
 * render a Dialog or Drawer title (ResponsiveDialogTitle) tag themselves with
 * the same slot so the surface doesn't add a second, competing name.
 */
type SlotTagged = { rmSlot?: "title" | "description" };

export function containsSlot(
  children: React.ReactNode,
  slot: "title" | "description",
): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (
      typeof child.type !== "string" &&
      (child.type as SlotTagged).rmSlot === slot
    ) {
      return true;
    }
    return containsSlot(
      (child.props as { children?: React.ReactNode }).children,
      slot,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Modal layer stack: stacked scrim + the "behind" cue                  */
/* ------------------------------------------------------------------ */

/**
 * Every open modal surface (Dialog, Sheet, Drawer, the settings workbench)
 * registers here in open order. A surface opened over another one is
 * "stacked": it brings the light stacked scrim (.24) instead of a second
 * full one, and every surface under the top gets `data-behind`, which the
 * primitives turn into a small recede (scale .985, up 6px) so the parent
 * reads as "behind" (overlays audit issue 9).
 */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const layers: HTMLElement[] = [];
type LayerListener = () => void;
const layerListeners = new Set<LayerListener>();

function syncBehind() {
  layers.forEach((el, index) => {
    if (index < layers.length - 1) el.setAttribute("data-behind", "");
    else el.removeAttribute("data-behind");
  });
  layerListeners.forEach((listener) => listener());
}

/** Registers an open modal surface; returns its unregister. */
function registerModalLayer(el: HTMLElement): () => void {
  if (!layers.includes(el)) layers.push(el);
  syncBehind();
  return () => {
    const index = layers.indexOf(el);
    if (index >= 0) layers.splice(index, 1);
    el.removeAttribute("data-behind");
    syncBehind();
  };
}

/** Open modal layers right now (tests and fixtures). */
export function modalLayerCount() {
  return layers.length;
}

/**
 * Tracks one surface's place in the modal stack. `stacked` is true when
 * another modal layer was already open when this one registered; it stays
 * fixed for the life of the surface so the scrim doesn't flip mid-exit.
 */
export function useModalLayer(open: boolean) {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [stacked, setStacked] = React.useState(false);
  useIsoLayoutEffect(() => {
    if (!open || !node) return;
    setStacked(layers.length > 0 && !layers.includes(node));
    return registerModalLayer(node);
  }, [open, node]);
  return { ref: setNode, stacked };
}

/* ------------------------------------------------------------------ */
/* Input modality: keyboard-opened overlays run opacity only            */
/* ------------------------------------------------------------------ */

let lastModality: "keyboard" | "pointer" = "pointer";
let modalityInstalled = false;

function installModality() {
  if (modalityInstalled || typeof document === "undefined") return;
  modalityInstalled = true;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.metaKey && event.key === "Meta") return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      lastModality = "keyboard";
    },
    true,
  );
  const pointer = () => {
    lastModality = "pointer";
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("mousedown", pointer, true);
}

/** True when the last input before now was a key (not a click or tap). */
export function lastInputWasKeyboard() {
  installModality();
  return lastModality === "keyboard";
}

/**
 * Captures the modality at the moment `open` turns true. Keyboard-opened
 * overlays (a shortcut, the command menu, Enter on a trigger) skip the scale
 * and run a 100ms fade (talk-tree-spec §6).
 */
export function useOpenedByKeyboard(open: boolean) {
  installModality();
  const [byKeyboard, setByKeyboard] = React.useState(false);
  const wasOpen = React.useRef(false);
  useIsoLayoutEffect(() => {
    if (open && !wasOpen.current) setByKeyboard(lastModality === "keyboard");
    wasOpen.current = open;
  }, [open]);
  return open && byKeyboard;
}

/**
 * Inline motion overrides for a Base UI `rm-presence` popup opened from the
 * keyboard: no scale, 100ms fade both ways. motion.css reads these vars on
 * the popup itself, so they win without fighting the stylesheet.
 */
export const KEYBOARD_PRESENCE_VARS = {
  "--motion-scale-in": "1",
  "--motion-scale-out": "1",
  "--dur-3": "100ms",
  "--dur-3-exit": "100ms",
  "--dur-2": "100ms",
  "--dur-2-exit": "100ms",
} as React.CSSProperties;

/**
 * True when a modal layer was already open as `open` turned true: a menu or
 * popover opened from a dialog, sheet, drawer or the workbench. Those take
 * the "menus over modals" layer (z-70) so they never sink under it.
 */
export function useOpenedOverModal(open: boolean) {
  const [overModal, setOverModal] = React.useState(false);
  const wasOpen = React.useRef(false);
  useIsoLayoutEffect(() => {
    if (open && !wasOpen.current) setOverModal(layers.length > 0);
    wasOpen.current = open;
  }, [open]);
  return open && overModal;
}
