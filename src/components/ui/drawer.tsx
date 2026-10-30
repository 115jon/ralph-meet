"use client";

/**
 * Quiet Pro drawer on Base UI's Drawer: a sheet you can drag away. A flick
 * dismisses on velocity, not distance, and the release animation is scaled by
 * that velocity (see `[data-rm-drawer]` in styles.css). Scroll
 * lock, focus trap, nested drawers and inner-scroll arbitration come from
 * Base UI: a touch that starts in a scroll container scrolls it, and only a
 * drag at the scroll edge (or on the handle/header) moves the sheet.
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

import { ButtonDefaults } from "@/components/ui/button";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { FocusScope } from "@radix-ui/react-focus-scope";

import {
  containsSlot,
  isDialogTopmost,
  useModalLayer,
} from "@/components/ui/dialog-stack";
import { shouldIgnoreSelectDismiss } from "@/components/ui/select-dismiss";
import {
  executeBackHandlers,
  useDialogBackButton,
} from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";

type DrawerDirection = "top" | "bottom" | "left" | "right";

const SWIPE_DIRECTION = {
  bottom: "down",
  top: "up",
  left: "left",
  right: "right",
} as const satisfies Record<DrawerDirection, string>;

type PointerDownOutsideEvent = CustomEvent<{ originalEvent: PointerEvent }>;

const preventDefault = (event: Event) => event.preventDefault();

/**
 * Runs a Radix-style handler and reports whether it called preventDefault.
 * Checking `defaultPrevented` afterwards isn't enough: a Radix dialog under
 * the drawer prevents the same native Escape first, to stay open itself.
 */
function vetoes<E extends Event>(event: E, handler: (event: E) => void) {
  let vetoed = false;
  const original = event.preventDefault;
  event.preventDefault = () => {
    vetoed = true;
    original.call(event);
  };
  try {
    handler(event);
  } finally {
    delete (event as { preventDefault?: unknown }).preventDefault;
  }
  return vetoed;
}

/** Radix-style dismiss hooks a DrawerContent registers with its root. */
type ContentDismissHandlers = {
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: PointerDownOutsideEvent) => void;
};

type DrawerRootContextValue = {
  id: string;
  open: boolean;
  modal: boolean;
  openerRef: React.RefObject<HTMLElement | null>;
  direction: DrawerDirection;
  hasSnapPoints: boolean;
  /** DrawerContent hands its Escape/scrim hooks to the root; returns cleanup. */
  registerDismissHandlers: (handlers: ContentDismissHandlers) => () => void;
};

const DrawerRootContext = React.createContext<DrawerRootContextValue | null>(
  null,
);

type DrawerProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Overrides what the back button does (default: close). */
  onBackButton?: () => void;
  /** Edge the sheet is attached to; it swipes away toward that edge. */
  direction?: DrawerDirection;
  /**
   * Keep focused fields above the software keyboard (iOS; Android already
   * resizes the layout viewport via `interactive-widget=resizes-content`).
   */
  repositionInputs?: boolean;
  /** Bottom drawers only: fractions of the viewport (0-1), px, or rem. */
  snapPoints?: DrawerPrimitive.Root.SnapPoint[];
  snapPoint?: DrawerPrimitive.Root.SnapPoint | null;
  onSnapPointChange?: (
    snapPoint: DrawerPrimitive.Root.SnapPoint | null,
  ) => void;
  modal?: boolean;
  children?: React.ReactNode;
};

function Drawer({
  open,
  defaultOpen,
  onOpenChange,
  onBackButton,
  direction = "bottom",
  repositionInputs = false,
  snapPoints,
  snapPoint,
  onSnapPointChange,
  modal = true,
  children,
}: DrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const id = React.useId();
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  const dismissHandlersRef = React.useRef<ContentDismissHandlers>({});
  const registerDismissHandlers = React.useCallback(
    (handlers: ContentDismissHandlers) => {
      dismissHandlersRef.current = handlers;
      return () => {
        if (dismissHandlersRef.current === handlers) {
          dismissHandlersRef.current = {};
        }
      };
    },
    [],
  );

  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const handleBack = () => (onBackButton ? onBackButton() : setOpen(false));

  useDialogBackButton(isOpen, handleBack, () => isDialogTopmost(id));

  const handlePrimitiveOpenChange = (
    nextOpen: boolean,
    details: DrawerPrimitive.Root.ChangeEventDetails,
  ) => {
    if (!nextOpen) {
      const handlers = dismissHandlersRef.current;
      switch (details.reason) {
        case "close-watcher":
          // Android's back gesture reaches Base UI's CloseWatcher before
          // popstate. Route it through the shared back stack instead, so a
          // Dialog above this drawer (or onBackButton) gets it first.
          details.cancel();
          executeBackHandlers();
          return;
        case "escape-key": {
          const event = details.event;
          if (shouldIgnoreSelectDismiss(event.target)) {
            details.cancel();
            return;
          }
          if (
            handlers.onEscapeKeyDown &&
            vetoes(event, handlers.onEscapeKeyDown)
          ) {
            details.cancel();
            return;
          }
          break;
        }
        case "outside-press": {
          const event = details.event;
          if (shouldIgnoreSelectDismiss(event.target)) {
            details.cancel();
            return;
          }
          if (handlers.onPointerDownOutside) {
            const outside: PointerDownOutsideEvent = new CustomEvent(
              "pointerdownoutside",
              {
                cancelable: true,
                detail: { originalEvent: event as PointerEvent },
              },
            );
            handlers.onPointerDownOutside(outside);
            if (outside.defaultPrevented) {
              details.cancel();
              return;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    setOpen(nextOpen);
  };

  const hasSnapPoints = (snapPoints?.length ?? 0) > 0;
  const contextValue = React.useMemo(
    () => ({
      id,
      open: isOpen,
      modal,
      openerRef,
      direction,
      hasSnapPoints,
      registerDismissHandlers,
    }),
    [id, isOpen, modal, direction, hasSnapPoints, registerDismissHandlers],
  );

  const root = (
    <DrawerPrimitive.Root
      open={isOpen}
      onOpenChange={handlePrimitiveOpenChange}
      swipeDirection={SWIPE_DIRECTION[direction]}
      modal={modal}
      snapPoints={snapPoints}
      snapPoint={snapPoint}
      onSnapPointChange={
        onSnapPointChange
          ? (nextSnapPoint) => onSnapPointChange(nextSnapPoint)
          : undefined
      }
    >
      {repositionInputs ? (
        <DrawerPrimitive.VirtualKeyboardProvider>
          {children}
        </DrawerPrimitive.VirtualKeyboardProvider>
      ) : (
        children
      )}
    </DrawerPrimitive.Root>
  );

  return (
    <DrawerRootContext.Provider value={contextValue}>
      {root}
    </DrawerRootContext.Provider>
  );
}

type AsChildProps = {
  /** Radix-style: render the single child element as the button. */
  asChild?: boolean;
};

function DrawerTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger> & AsChildProps) {
  if (asChild && React.isValidElement(children)) {
    return (
      <DrawerPrimitive.Trigger
        data-slot="drawer-trigger"
        render={children as React.ReactElement<Record<string, unknown>>}
        {...props}
      />
    );
  }
  return (
    <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props}>
      {children}
    </DrawerPrimitive.Trigger>
  );
}

function DrawerPortal({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DrawerPrimitive.Portal>, "className"> & {
  className?: string;
}) {
  return (
    <DrawerPrimitive.Portal
      data-slot="drawer-portal"
      // A Radix modal Dialog under this drawer sets pointer-events: none on
      // <body>; the drawer must still take taps.
      className={cn("pointer-events-auto", className)}
      {...props}
    />
  );
}

function DrawerClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close> & AsChildProps) {
  if (asChild && React.isValidElement(children)) {
    return (
      <DrawerPrimitive.Close
        data-slot="drawer-close"
        render={children as React.ReactElement<Record<string, unknown>>}
        {...props}
      />
    );
  }
  return (
    <DrawerPrimitive.Close data-slot="drawer-close" {...props}>
      {children}
    </DrawerPrimitive.Close>
  );
}

function DrawerOverlay({
  className,
  stacked = false,
  ...props
}: Omit<React.ComponentProps<typeof DrawerPrimitive.Backdrop>, "className"> & {
  className?: string;
  /** Over another modal layer: the light stacked scrim (.24) at z-60. */
  stacked?: boolean;
}) {
  const root = React.useContext(DrawerRootContext);
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      data-rm-drawer-overlay=""
      // Base UI counts the lowest snap point as full swipe progress, which
      // would hide the scrim while the sheet rests there (styles.css).
      data-rm-snap={root?.hasSnapPoints ? "" : undefined}
      // Nested drawers (an action sheet over the nav sheet) keep their scrim.
      forceRender
      data-stacked={stacked ? "" : undefined}
      className={cn(
        "fixed inset-0 z-50 bg-scrim",
        stacked && "z-60 bg-scrim-stacked",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Grab bar. Decorative for assistive tech (Escape/back close the drawer), but
 * it sits outside the text-selectable content, so a mouse can drag from it.
 */
function DrawerHandle({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="drawer-handle"
      className={cn(
        "mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-line-strong",
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

type DrawerContentProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "className" | "style"
> & {
  className?: string;
  style?: React.CSSProperties;
  /** Shows the grab bar on bottom drawers. */
  showHandle?: boolean;
  /** Skip the scrim (rare: a drawer over a busy live view). */
  hideOverlay?: boolean;
  /** Scrim classes, e.g. a z-index to match a raised content layer. */
  overlayClassName?: string;
  /** Escape; call `event.preventDefault()` to keep the drawer open. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Scrim tap; call `event.preventDefault()` to keep the drawer open. */
  onPointerDownOutside?: (event: PointerDownOutsideEvent) => void;
};

const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent(
    {
      className,
      children,
      showHandle = true,
      hideOverlay = false,
      overlayClassName,
      onEscapeKeyDown,
      onPointerDownOutside,
      ...props
    },
    ref,
  ) {
    const root = React.useContext(DrawerRootContext);
    const direction = root?.direction ?? "bottom";
    const hasTitle = containsSlot(children, "title");
    const hasDescription = containsSlot(children, "description");
    const accessibleLabel = props["aria-label"] ?? "Drawer";
    const registerDismissHandlers = root?.registerDismissHandlers;
    const openerRef = root?.openerRef;
    const layer = useModalLayer(Boolean(root?.open && root.modal));
    const layerRef = layer.ref;
    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        layerRef(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [layerRef, ref],
    );

    React.useLayoutEffect(
      () =>
        registerDismissHandlers?.({ onEscapeKeyDown, onPointerDownOutside }),
      [registerDismissHandlers, onEscapeKeyDown, onPointerDownOutside],
    );

    return (
      <DrawerPortal>
        {hideOverlay ? null : (
          <DrawerOverlay stacked={layer.stacked} className={overlayClassName} />
        )}
        {/*
         * The viewport owns swipe and touch-scroll arbitration, and Base UI
         * measures it to resolve snap points, so it needs the window's size.
         * Absolute (not fixed) with no z-index creates no stacking context:
         * z-index classes on the popup still stack against the page, and taps
         * beside the popup land on the scrim above this box.
         */}
        <DrawerPrimitive.Viewport
          data-slot="drawer-viewport"
          className="absolute inset-0"
        >
          <DrawerPrimitive.Popup
            ref={mergedRef}
            data-slot="drawer-content"
            // Motion hook (styles.css); data-slot may be overridden, e.g.
            // ActionSheet tags itself data-slot="action-sheet".
            data-rm-drawer=""
            data-dialog-root-id={root?.id}
            data-dialog-back-enabled="true"
            data-stacked={layer.stacked ? "" : undefined}
            className={cn(
              "fixed z-50 flex min-h-0 flex-col overscroll-contain border-line bg-ply-3 text-ink-1 shadow-modal outline-none data-stacked:z-60",
              // Behind a stacked layer: recede with the individual scale /
              // translate properties (styles.css owns `transform` for the
              // swipe). The transition list is extended so they ease too.
              "origin-top [transition-property:transform,opacity,scale,translate]! data-behind:scale-[0.96] data-behind:-translate-y-2.5 motion-reduce:data-behind:scale-100 motion-reduce:data-behind:translate-y-0",
              SIDE_CLASSES[direction],
              className,
            )}
            // Focus lands on the surface itself (Base UI's default for
            // drawers), not its first field: focusing a search box on a phone
            // would raise the keyboard every time.
            finalFocus={() => {
              const opener = openerRef?.current;
              return opener?.isConnected && opener !== document.body
                ? opener
                : true;
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
            {/*
             * Content lets a mouse select text without starting a swipe; it
             * adds no box, so children lay out in the popup's flex column.
             *
             * The untrapped Radix FocusScope pauses the focus trap of any
             * Radix Dialog under this drawer (Radix keeps one scope stack),
             * which would otherwise pull focus out of the drawer's fields.
             * Pinned to the version radix-ui uses so the stack is shared.
             */}
            <FocusScope
              asChild
              onMountAutoFocus={preventDefault}
              onUnmountAutoFocus={preventDefault}
            >
              <DrawerPrimitive.Content className="contents">
                {children}
              </DrawerPrimitive.Content>
            </FocusScope>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPortal>
    );
  },
);

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1 px-4 pt-2 pb-3", className)}
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 px-4 pt-3 [&>[data-slot=button]]:w-full",
        className,
      )}
      {...props}
    >
      {/* Sheet keys are 48 (thumb reach) and a secondary sits by the primary. */}
      <ButtonDefaults size="lg" paired>
        {children}
      </ButtonDefaults>
    </div>
  );
}

function DrawerTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DrawerPrimitive.Title>, "className"> & {
  className?: string;
}) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        "font-display [font-optical-sizing:auto] text-[22px] leading-7 font-extrabold tracking-[-0.02em] text-balance text-ink-1",
        className,
      )}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof DrawerPrimitive.Description>,
  "className"
> & {
  className?: string;
}) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-ui-base text-pretty text-ink-2", className)}
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
