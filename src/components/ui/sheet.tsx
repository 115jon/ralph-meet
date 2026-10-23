"use client";

/**
 * Desktop side sheet (design-system 12.10): a modal panel attached to a
 * screen edge, 360 wide, on the modal layer (z-50) over `bg-rm-scrim`.
 * Phones use a Drawer with `direction` instead (see ui/side-panel.tsx).
 *
 * Built on ui/dialog.tsx, so it shares the dialog stack: the hardware/browser
 * back button closes the topmost surface, Escape closes it (a drawer or
 * dialog above it closes first), and focus returns to whatever opened it.
 *
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetContent aria-label="Pinned messages">
 *       <SheetHeader><SheetTitle>Pinned messages</SheetTitle></SheetHeader>
 *       …
 *     </SheetContent>
 *   </Sheet>
 */

import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const Sheet = Dialog;
const SheetTrigger = DialogTrigger;
const SheetClose = DialogClose;

type SheetSide = "top" | "right" | "bottom" | "left";

const SIDE_CLASSES: Record<SheetSide, string> = {
  right:
    "inset-y-0 right-0 h-full w-[360px] max-w-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
  left: "inset-y-0 left-0 h-full w-[360px] max-w-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  top: "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
  bottom:
    "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
};

type SheetContentProps = React.ComponentProps<typeof DialogSurface> & {
  side?: SheetSide;
  /** Skip the scrim (a preview that must leave the page undimmed). */
  hideOverlay?: boolean;
};

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContent(
    {
      className,
      children,
      side = "right",
      hideOverlay = false,
      showCloseButton = false,
      ...props
    },
    ref,
  ) {
    return (
      <DialogPortal>
        {hideOverlay ? null : <DialogOverlay data-slot="sheet-overlay" />}
        <DialogSurface
          ref={ref}
          data-slot="sheet-content"
          showCloseButton={showCloseButton}
          className={cn(
            "fixed z-50 flex flex-col overscroll-contain border-rm-border bg-rm-bg-surface text-rm-text shadow-2xl outline-none ease-drawer dark:bg-rm-bg-elevated data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:duration-240",
            SIDE_CLASSES[side],
            className,
          )}
          {...props}
        >
          {children}
        </DialogSurface>
      </DialogPortal>
    );
  },
);

/** 48px header with a bottom hairline (12.10); title leads, actions trail. */
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-rm-border px-4",
        className,
      )}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      data-slot="sheet-title"
      className={cn(
        "min-w-0 flex-1 truncate text-ui-md font-semibold text-rm-text",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      data-slot="sheet-description"
      className={cn("text-ui-sm text-rm-text-muted", className)}
      {...props}
    />
  );
}

Object.assign(SheetTitle, { rmSlot: "title" });
Object.assign(SheetDescription, { rmSlot: "description" });

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
