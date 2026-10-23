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
 * Desktop: an anchored popover panel (design-system 13.1) in the menu recipe:
 * `MENU_PANEL` geometry, radius 12, `shadow-lg`, capped at
 * `min(600px, 100dvh - 24px)`. The surface owns its z-index (modal layer 50,
 * or the stacked layer 60 when opened from a dialog). Callers pass only
 * position and width. Outside presses close it through the Dialog's own
 * dismiss handling (non-modal by default), so pickers add no click-catcher;
 * a press on the control that opened it is ignored, so that control's own
 * toggle closes it instead of closing and reopening it.
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

type DialogSurfaceProps = React.ComponentProps<typeof DialogSurface>;

/** The desktop panel recipe. */
const PICKER_PANEL = cn(
  MENU_PANEL,
  "fixed z-50 m-0 flex max-h-[min(600px,calc(100dvh-24px))] flex-col overflow-hidden p-0 outline-none",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-180",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=closed]:duration-120",
);

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
  children,
}: PickerSurfaceProps) {
  const isMobile = useIsMobile();
  // The control that had focus when the picker opened (usually its toggle).
  const openerRef = React.useRef<Element | null>(null);
  // Layout effect: runs before the dialog's focus scope moves focus inside.
  React.useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement;
  }, [open]);

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        onBackButton={onBackButton}
        repositionInputs
      >
        <DrawerContent
          ref={contentRef}
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

  const { onInteractOutside, ...restDesktopProps } = desktopProps ?? {};

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
          ref={contentRef}
          showCloseButton={false}
          className={cn(PICKER_PANEL, stacked && "z-60", className)}
          style={style}
          aria-label={ariaLabel}
          onEscapeKeyDown={onEscapeKeyDown}
          onPointerDownOutside={onPointerDownOutside}
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
