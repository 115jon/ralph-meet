"use client";

/**
 * Shared shell for the composer pickers (emoji, GIF, soundboard) and the
 * notification inbox.
 *
 * Phones (below `md`, 768px): a bottom Drawer, so the sheet drags away, respects
 * the bottom safe area, and the back button closes it. No snap points: a
 * picker is a fixed 85dvh sheet, and dragging only starts when the inner list
 * is scrolled to the top.
 *
 * Desktop: an anchored float in the menu recipe (`MENU_PANEL`: ply-3, line,
 * shadow-float, radius 10), capped at `min(600px, 100dvh - 24px)`. The
 * surface owns its z-index (modal layer 50, or the stacked layer 60 when
 * opened from a dialog). Callers pass only position and width. Outside
 * presses close it through the Dialog's own dismiss handling (non-modal by
 * default), so pickers add no click-catcher; a press on the control that
 * opened it is ignored, so that control's own toggle closes it instead of
 * closing and reopening it.
 *
 * Motion (talk-tree-spec §6, presence): a pointer open fades and scales from
 * the trigger (transform-origin is measured from the opener, or `anchorRef`)
 * over --dur-3; the exit runs at ~0.7x (--dur-3-exit). A keyboard-initiated
 * open never scales: it fades in over --dur-1 and out over 70ms.
 */

import * as React from "react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { MENU_PANEL } from "@/components/ui/menu";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

import { getLastInputWasKeyboard } from "./picker-grid";

type DialogSurfaceProps = React.ComponentProps<typeof DialogSurface>;

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
}

/** The desktop panel recipe. */
const PICKER_PANEL = cn(
  MENU_PANEL,
  "fixed z-50 m-0 flex max-h-[min(600px,calc(100dvh-24px))] flex-col overflow-hidden p-0 outline-none",
);
/** Pointer open: fade + scale from the trigger; exit at ~0.7x. */
const PRESENCE_POINTER =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-(--motion-scale-in) data-[state=open]:duration-(--dur-3) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-(--motion-scale-out) data-[state=closed]:duration-(--dur-3-exit)";
/** Keyboard open: opacity only, 100ms in, 70ms out. */
const PRESENCE_KEYBOARD =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-1) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-70";

export type PickerSurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Desktop Dialog modality. Defaults to non-modal (an anchored popover);
   * pass `true` for a centred workbench, which also gets the standard scrim.
   * Phones are always a modal drawer.
   */
  modal?: boolean;
  onBackButton?: () => void;
  ariaLabel: string;
  /** Called on Escape (desktop and phone). */
  onEscapeKeyDown?: DialogSurfaceProps["onEscapeKeyDown"];
  /** Desktop only: phones let a scrim tap dismiss the drawer. */
  onPointerDownOutside?: DialogSurfaceProps["onPointerDownOutside"];
  /** Desktop position, width and any height override; never z-index. */
  className?: string;
  style?: React.CSSProperties;
  /** Extra desktop DialogSurface props (e.g. onMouseDown). */
  desktopProps?: Omit<
    DialogSurfaceProps,
    | "className"
    | "style"
    | "children"
    | "ref"
    | "aria-label"
    | "showCloseButton"
    | "onEscapeKeyDown"
    | "onPointerDownOutside"
  >;
  /**
   * Opened from inside a dialog or another picker: sits on the stacked
   * layer (z-60, design-system 11.1) instead of the modal layer (z-50).
   */
  stacked?: boolean;
  /** Ref to the surface element (desktop DialogSurface / phone drawer). */
  contentRef?: React.Ref<HTMLDivElement>;
  /**
   * Desktop: where focus lands on open (usually the search field) instead of
   * the first focusable control. Phones keep the drawer's own focus, so the
   * keyboard doesn't jump up over the sheet.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * The element the presence scales out of. Defaults to the control that had
   * focus when the picker opened.
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

export function PickerSurface({
  open,
  onOpenChange,
  modal = false,
  onBackButton,
  ariaLabel,
  onEscapeKeyDown,
  onPointerDownOutside,
  className,
  style,
  desktopProps,
  stacked = false,
  contentRef,
  initialFocusRef,
  anchorRef,
  children,
}: PickerSurfaceProps) {
  const isMobile = useIsMobile();
  // The control that had focus when the picker opened (usually its toggle).
  const openerRef = React.useRef<Element | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  // How this open started; read once per open so the class is on the first
  // frame the presence keyframes run on.
  const [keyboardOpen, setKeyboardOpen] = React.useState(
    () => open && getLastInputWasKeyboard(),
  );
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setKeyboardOpen(getLastInputWasKeyboard());
  }

  // Layout effect: runs before the dialog's focus scope moves focus inside.
  React.useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement;
  }, [open]);

  const setSurfaceRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      surfaceRef.current = node;
      assignRef(contentRef, node);
    },
    [contentRef],
  );

  // Origin-aware presence: scale out of the trigger's nearest point. Pickers
  // position themselves after mount, so this re-measures when the position
  // style changes.
  const positionKey = style
    ? `${style.left}|${style.top}|${style.right}|${style.bottom}`
    : "";
  React.useLayoutEffect(() => {
    if (!open || modal || isMobile) return;
    const surface = surfaceRef.current;
    const anchor =
      anchorRef?.current ??
      (openerRef.current instanceof HTMLElement &&
      openerRef.current !== document.body
        ? openerRef.current
        : null);
    if (!surface || !anchor) return;
    const box = surface.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    if (box.width === 0 || target.width === 0) return;
    const clamp = (value: number, max: number) =>
      Math.min(Math.max(value, 0), max);
    const x = clamp(target.left + target.width / 2 - box.left, box.width);
    const y =
      target.top >= box.bottom
        ? box.height
        : target.bottom <= box.top
          ? 0
          : clamp(target.top + target.height / 2 - box.top, box.height);
    surface.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
  }, [anchorRef, isMobile, modal, open, positionKey, className]);

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        onBackButton={onBackButton}
        repositionInputs
      >
        <DrawerContent
          ref={setSurfaceRef}
          aria-label={ariaLabel}
          overlayClassName={cn(stacked && "z-60")}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn("h-[85dvh] overflow-hidden", stacked && "z-60")}
        >
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  const { onInteractOutside, onOpenAutoFocus, ...restDesktopProps } =
    desktopProps ?? {};

  return (
    <Dialog
      open={open}
      modal={modal}
      onBackButton={onBackButton}
      onOpenChange={onOpenChange}
    >
      <DialogPortal>
        {modal ? <DialogOverlay className={cn(stacked && "z-60")} /> : null}
        <DialogSurface
          {...restDesktopProps}
          ref={setSurfaceRef}
          showCloseButton={false}
          className={cn(
            PICKER_PANEL,
            keyboardOpen ? PRESENCE_KEYBOARD : PRESENCE_POINTER,
            stacked && "z-60",
            className,
          )}
          style={style}
          aria-label={ariaLabel}
          onEscapeKeyDown={onEscapeKeyDown}
          onPointerDownOutside={onPointerDownOutside}
          onOpenAutoFocus={(event) => {
            onOpenAutoFocus?.(event);
            if (event.defaultPrevented) return;
            const target = initialFocusRef?.current;
            if (target) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            const opener = openerRef.current;
            if (
              opener &&
              opener !== document.body &&
              target instanceof Node &&
              opener.contains(target)
            ) {
              // The opener toggles the picker itself; closing here first
              // would let its click reopen it.
              event.preventDefault();
            }
            onInteractOutside?.(event);
          }}
        >
          {children}
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
