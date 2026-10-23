"use client";

/**
 * Shared shell for the composer pickers (emoji, GIF, soundboard).
 *
 * Phones (below `md`, 768px): a vaul Drawer, so the sheet drags away, respects
 * the bottom safe area, and the back button closes it. No snap points: a
 * picker is a fixed 85dvh sheet, and dragging only starts when the inner list
 * is scrolled to the top.
 *
 * Desktop: renders exactly the Dialog / DialogPortal / DialogSurface each
 * picker used before, so the desktop DOM is unchanged.
 */

import * as React from "react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

type DialogSurfaceProps = React.ComponentProps<typeof DialogSurface>;

export type PickerSurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Desktop Dialog modality. Phones are always a modal drawer. */
  modal?: boolean;
  onBackButton?: () => void;
  ariaLabel: string;
  /** Called on Escape (desktop and phone). */
  onEscapeKeyDown?: DialogSurfaceProps["onEscapeKeyDown"];
  /** Desktop only: phones let a scrim tap dismiss the drawer. */
  onPointerDownOutside?: DialogSurfaceProps["onPointerDownOutside"];
  /** Desktop DialogSurface classes and inline style. */
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
  /** Desktop only: wraps the surface inside DialogPortal (overlay nodes). */
  desktopWrap?: (surface: React.ReactElement) => React.ReactNode;
  /** Phone drawer content classes (height, z-index, etc.). */
  drawerClassName?: string;
  drawerOverlayClassName?: string;
  /** Ref to the surface element (desktop DialogSurface / phone drawer). */
  contentRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
};

export function PickerSurface({
  open,
  onOpenChange,
  modal,
  onBackButton,
  ariaLabel,
  onEscapeKeyDown,
  onPointerDownOutside,
  className,
  style,
  desktopProps,
  desktopWrap,
  drawerClassName,
  drawerOverlayClassName,
  contentRef,
  children,
}: PickerSurfaceProps) {
  const isMobile = useIsMobile();

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
          overlayClassName={drawerOverlayClassName}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(
            "picker-panel h-[85dvh] overflow-hidden",
            drawerClassName,
          )}
        >
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  const surface = (
    <DialogSurface
      {...desktopProps}
      ref={contentRef}
      showCloseButton={false}
      className={className}
      style={style}
      aria-label={ariaLabel}
      onEscapeKeyDown={onEscapeKeyDown}
      onPointerDownOutside={onPointerDownOutside}
    >
      {children}
    </DialogSurface>
  );

  return (
    <Dialog
      open={open}
      modal={modal}
      onBackButton={onBackButton}
      onOpenChange={onOpenChange}
    >
      <DialogPortal>
        {desktopWrap ? desktopWrap(surface) : surface}
      </DialogPortal>
    </Dialog>
  );
}
