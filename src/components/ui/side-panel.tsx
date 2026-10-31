"use client";

/**
 * A side panel over content (design-system 13.1: thread, pins, members,
 * search): a docked 360 column at `lg`+, a `Sheet` on the right below `lg`,
 * and a full-height right `Drawer` on phones. One component so the host does
 * not branch on width and never draws its own scrim, z-index, Escape or
 * back-button handling.
 *
 *   <SidePanel open={open} onOpenChange={setOpen} title="Thread">
 *     …body (owns its scroller)…
 *   </SidePanel>
 *
 * The docked column is part of the layout (no scrim, no focus trap); the
 * hardware/browser back button still closes it. The sheet and drawer share the
 * dialog stack with every other modal surface.
 *
 * Plies: the docked column is a ply-1 panel; the sheet and drawer are floats
 * and keep their primitive's ply-3 surface.
 */

import * as React from "react";

import { IconButton } from "@/components/ui/IconButton";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBackButton } from "@/hooks/useBackButton";
import { useIsMobile, useMediaQuery, WIDE_QUERY } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

export type SidePanelMode = "dock" | "sheet" | "drawer";

type SidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible header title, and the panel's accessible name. */
  title: React.ReactNode;
  /** Accessible name when `title` is not plain text or the header is hidden. */
  ariaLabel?: string;
  /** Screen-reader description for the sheet/drawer forms. */
  description?: string;
  /** Leading header content after the title (e.g. a count). */
  titleAdornment?: React.ReactNode;
  /** Trailing header actions, before the close button. */
  actions?: React.ReactNode;
  /**
   * The body draws its own header (and close control), e.g. a whole chat
   * column; the panel then renders no header.
   */
  hideHeader?: boolean;
  /** Dock as a layout column at `lg`+ (default). Off: a sheet at every desktop width. */
  dock?: boolean;
  /** Classes for the docked column (width, background). Default 360 wide. */
  dockClassName?: string;
  /** Classes for the sheet and drawer surfaces. */
  className?: string;
  /** Force one form (fixtures, tests). */
  forceMode?: SidePanelMode;
  children: React.ReactNode;
};

/** The form a SidePanel takes at the current width. */
export function useSidePanelLayout(dock: boolean, forceMode?: SidePanelMode) {
  const isMobile = useIsMobile();
  const isWide = useMediaQuery(WIDE_QUERY);
  if (forceMode) return forceMode;
  if (isMobile) return "drawer";
  return dock && isWide ? "dock" : "sheet";
}

function PanelHeader({
  mode,
  title,
  titleAdornment,
  actions,
  onClose,
  titleId,
}: {
  mode: SidePanelMode;
  title: React.ReactNode;
  titleAdornment?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  titleId: string;
}) {
  const phone = mode === "drawer";
  const titleClass = "min-w-0 truncate text-ui-row font-semibold text-ink-1";
  const titleNode =
    mode === "sheet" ? (
      <SheetTitle id={titleId} className={cn(titleClass, "flex-none")}>
        {title}
      </SheetTitle>
    ) : mode === "drawer" ? (
      <DrawerTitle id={titleId} className={titleClass}>
        {title}
      </DrawerTitle>
    ) : (
      <h2 id={titleId} className={titleClass}>
        {title}
      </h2>
    );

  return (
    <div
      data-slot="side-panel-header"
      className={cn(
        "relative z-20 flex shrink-0 items-center gap-2 border-b border-line",
        phone
          ? "min-h-12 pt-[var(--safe-area-top,0px)] pr-2 pl-1"
          : "h-12 pr-2 pl-4",
      )}
    >
      {phone ? (
        <IconButton
          icon="back"
          size="md"
          variant="muted"
          aria-label="Close"
          onClick={onClose}
        />
      ) : null}
      {titleNode}
      {titleAdornment}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        {phone ? null : (
          <IconButton
            icon="close"
            size="sm"
            variant="muted"
            aria-label="Close"
            onClick={onClose}
          />
        )}
      </div>
    </div>
  );
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  ariaLabel,
  description,
  titleAdornment,
  actions,
  hideHeader = false,
  dock = true,
  dockClassName,
  className,
  forceMode,
  children,
}: SidePanelProps) {
  const mode = useSidePanelLayout(dock, forceMode);
  const titleId = React.useId();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);

  // The docked column is not a modal surface, so the dialog stack doesn't
  // see it; it still answers the back button like the sheet and drawer do.
  useBackButton(
    React.useCallback(() => {
      close();
      return true;
    }, [close]),
    open && mode === "dock",
  );

  const header = hideHeader ? null : (
    <PanelHeader
      mode={mode}
      title={title}
      titleAdornment={titleAdornment}
      actions={actions}
      onClose={close}
      titleId={titleId}
    />
  );
  const labelProps = hideHeader
    ? { "aria-label": label }
    : { "aria-labelledby": titleId };

  let surface: React.ReactNode;
  if (mode === "dock") {
    surface = open ? (
      <aside
        data-slot="side-panel"
        data-mode="dock"
        {...labelProps}
        className={cn(
          "flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-line bg-ply-1",
          dockClassName,
        )}
      >
        {header}
        {children}
      </aside>
    ) : null;
  } else if (mode === "sheet") {
    surface = (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-mode="sheet"
          aria-label={label}
          className={className}
          // Focus the panel itself, like the drawer does: landing on the close
          // button shows its ring on every pointer open.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus?.({
              preventScroll: true,
            });
          }}
        >
          {hideHeader ? (
            <SheetTitle className="sr-only">{label}</SheetTitle>
          ) : (
            header
          )}
          {description ? (
            <SheetDescription className="sr-only">
              {description}
            </SheetDescription>
          ) : null}
          {children}
        </SheetContent>
      </Sheet>
    );
  } else {
    surface = (
      <Drawer open={open} onOpenChange={onOpenChange} direction="right">
        <DrawerContent
          data-mode="drawer"
          aria-label={label}
          className={cn("pb-[var(--safe-area-bottom,0px)]", className)}
        >
          {hideHeader ? (
            <DrawerTitle className="sr-only">{label}</DrawerTitle>
          ) : (
            header
          )}
          {description ? (
            <DrawerDescription className="sr-only">
              {description}
            </DrawerDescription>
          ) : null}
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  return surface;
}
