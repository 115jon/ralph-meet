"use client";

/**
 * Quiet Pro drawer on vaul: a sheet you can drag away. A flick dismisses on
 * velocity, not distance; dragging past the open edge is damped; scroll lock,
 * nested drawers and keyboard repositioning come from vaul.
 *
 * Mirrors dialog.tsx: controlled or uncontrolled, the hardware/browser back
 * button closes the topmost surface (Dialogs and Drawers share one stack),
 * Escape closes, and focus returns to whatever opened it.
 *
 *   <Drawer open={open} onOpenChange={setOpen}>
 *     <DrawerContent>
 *       <DrawerHeader><DrawerTitle>Reply</DrawerTitle></DrawerHeader>
 *       …
 *     </DrawerContent>
 *   </Drawer>
 */

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { containsSlot, isDialogTopmost } from "@/components/ui/dialog-stack";
import { useDialogBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";

type DrawerDirection = "top" | "bottom" | "left" | "right";

type DrawerRootContextValue = {
  id: string;
  openerRef: React.RefObject<HTMLElement | null>;
  direction: DrawerDirection;
};

const DrawerRootContext = React.createContext<DrawerRootContextValue | null>(
  null,
);

type DrawerProps = React.ComponentProps<typeof DrawerPrimitive.Root> & {
  /** Overrides what the back button does (default: close). */
  onBackButton?: () => void;
};

function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  onBackButton,
  direction = "bottom",
  ...props
}: DrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const id = React.useId();
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useDialogBackButton(
    isOpen,
    () => (onBackButton ? onBackButton() : handleOpenChange(false)),
    () => isDialogTopmost(id),
  );

  const contextValue = React.useMemo(
    () => ({ id, openerRef, direction }),
    [id, direction],
  );

  return (
    <DrawerRootContext.Provider value={contextValue}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        open={isOpen}
        onOpenChange={handleOpenChange}
        direction={direction}
        {...props}
      />
    </DrawerRootContext.Provider>
  );
}

function DrawerTrigger(
  props: React.ComponentProps<typeof DrawerPrimitive.Trigger>,
) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal(
  props: React.ComponentProps<typeof DrawerPrimitive.Portal>,
) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose(
  props: React.ComponentProps<typeof DrawerPrimitive.Close>,
) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn("fixed inset-0 z-50 bg-rm-scrim", className)}
      {...props}
    />
  );
}

/** Grab bar. Decorative: the whole sheet drags, and Escape/back close it. */
function DrawerHandle({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="drawer-handle"
      className={cn(
        "mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-rm-border-strong",
        className,
      )}
    />
  );
}

const SIDE_CLASSES: Record<DrawerDirection, string> = {
  bottom:
    "inset-x-0 bottom-0 max-h-[calc(100dvh-24px)] rounded-t-2xl border-t pb-[max(16px,var(--safe-area-bottom,0px))]",
  top: "inset-x-0 top-0 max-h-[calc(100dvh-24px)] rounded-b-2xl border-b pt-[var(--safe-area-top,0px)]",
  left: "inset-y-0 left-0 h-full w-full border-r",
  right: "inset-y-0 right-0 h-full w-full border-l",
};

type DrawerContentProps = React.ComponentProps<
  typeof DrawerPrimitive.Content
> & {
  /** Shows the grab bar on bottom drawers. */
  showHandle?: boolean;
  /** Skip the scrim (rare: a drawer over a busy live view). */
  hideOverlay?: boolean;
  /** Scrim classes, e.g. a z-index to match a raised content layer. */
  overlayClassName?: string;
};

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent(
  {
    className,
    children,
    showHandle = true,
    hideOverlay = false,
    overlayClassName,
    onOpenAutoFocus,
    onCloseAutoFocus,
    ...props
  },
  ref,
) {
  const root = React.useContext(DrawerRootContext);
  const direction = root?.direction ?? "bottom";
  const hasTitle = containsSlot(children, "title");
  const hasDescription = containsSlot(children, "description");
  const accessibleLabel = props["aria-label"] ?? "Drawer";

  return (
    <DrawerPortal>
      {hideOverlay ? null : <DrawerOverlay className={overlayClassName} />}
      <DrawerPrimitive.Content
        ref={ref}
        data-slot="drawer-content"
        data-dialog-root-id={root?.id}
        data-dialog-back-enabled="true"
        className={cn(
          "fixed z-50 flex min-h-0 flex-col overscroll-contain border-rm-border bg-rm-bg-surface text-rm-text shadow-[var(--rm-shadow-3)] outline-none dark:bg-rm-bg-elevated",
          SIDE_CLASSES[direction],
          className,
        )}
        // Move focus into the drawer (for keyboards and screen readers) but onto
        // the surface itself, not its first field: focusing a search box on a
        // phone would raise the keyboard every time.
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          (event.target as HTMLElement | null)?.focus?.({
            preventScroll: true,
          });
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const opener = root?.openerRef.current;
          if (opener?.isConnected && opener !== document.body) {
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }
        }}
        {...props}
      >
        {!hasTitle && (
          <DrawerPrimitive.Title className="sr-only">
            {accessibleLabel}
          </DrawerPrimitive.Title>
        )}
        {!hasDescription && props["aria-describedby"] === undefined && (
          <DrawerPrimitive.Description className="sr-only">
            Drag down or press Escape to close.
          </DrawerPrimitive.Description>
        )}
        {showHandle && direction === "bottom" ? <DrawerHandle /> : null}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
});

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1 px-4 pt-2 pb-3", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 px-4 pt-3", className)}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-ui-lg font-semibold text-rm-text", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-ui-sm text-pretty text-rm-text-muted", className)}
      {...props}
    />
  );
}

Object.assign(DrawerTitle, { rmSlot: "title" });
Object.assign(DrawerDescription, { rmSlot: "description" });

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
