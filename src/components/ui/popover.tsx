"use client";

/**
 * Anchored popover on Base UI (design-system 12.7, 13.1): portalled to
 * <body>, on the modal layer (z-50, `stacked` -> z-60 when opened from a
 * dialog), `MENU_PANEL` surface. Phones get a bottom drawer instead through
 * `ResponsivePopover`.
 *
 *   <Popover open={open} onOpenChange={setOpen}>
 *     <PopoverTrigger render={<button />}>Open</PopoverTrigger>
 *     <PopoverContent aria-label="Account" variant="rich">…</PopoverContent>
 *   </Popover>
 *
 * A popover opened from an element that isn't a Base UI trigger passes
 * `anchor` to PopoverContent; a press on that anchor is then not an "outside
 * press", so the anchor's own toggle still works.
 *
 * Joins the dialog stack: Escape and the back button close the topmost
 * surface first, focus returns to the opener, and a Radix dialog underneath
 * neither closes nor steals focus while the popover is open.
 */

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { FocusScope } from "@radix-ui/react-focus-scope";

import {
  isDialogTopmost,
  KEYBOARD_PRESENCE_VARS,
  useOpenedByKeyboard,
  useOpenedOverModal,
} from "@/components/ui/dialog-stack";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MENU_PANEL } from "@/components/ui/menu";
import { useDialogBackButton } from "@/hooks/useBackButton";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const preventDefault = (event: Event) => event.preventDefault();

/** Marks a portal as a floating layer a Radix dialog must not treat as outside. */
export const FLOATING_LAYER_ATTR = "data-rm-floating-layer";

type Anchor = PopoverPrimitive.Positioner.Props["anchor"];

type PopoverContextValue = {
  id: string;
  /** PopoverContent reports its `anchor` element (null on unmount). */
  setAnchor: (element: Element | null) => void;
  /** Opened from the keyboard: opacity only, 100ms. */
  byKeyboard: boolean;
  /** Opened while a modal layer is open: the menus-over-modals layer (z-70). */
  overModal: boolean;
};

/**
 * Popover presence (overlays §3b): fade + scale .96 from the trigger,
 * 160ms in, 100ms out. motion.css reads these vars on the popup itself.
 */
const POPOVER_PRESENCE_VARS = {
  "--motion-scale-in": "0.96",
  "--dur-3": "160ms",
  "--dur-3-exit": "100ms",
} as React.CSSProperties;

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function anchorElement(anchor: Anchor | undefined): Element | null {
  if (!anchor) return null;
  if (anchor instanceof Element) return anchor;
  if (typeof anchor === "function") {
    const resolved = anchor();
    return resolved instanceof Element ? resolved : null;
  }
  if ("current" in anchor) {
    return anchor.current instanceof Element ? anchor.current : null;
  }
  return null;
}

type PopoverProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (
    open: boolean,
    details?: PopoverPrimitive.Root.ChangeEventDetails,
  ) => void;
  modal?: PopoverPrimitive.Root.Props["modal"];
  children?: React.ReactNode;
};

function Popover({
  open,
  defaultOpen,
  onOpenChange,
  modal,
  children,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const id = React.useId();
  const anchorRef = React.useRef<Element | null>(null);
  const byKeyboard = useOpenedByKeyboard(isOpen);
  const overModal = useOpenedOverModal(isOpen);

  const setOpen = React.useCallback(
    (nextOpen: boolean, details?: PopoverPrimitive.Root.ChangeEventDetails) => {
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen, details);
    },
    [isControlled, onOpenChange],
  );

  useDialogBackButton(
    isOpen,
    () => setOpen(false),
    () => isDialogTopmost(id),
  );

  const handleOpenChange = (
    nextOpen: boolean,
    details: PopoverPrimitive.Root.ChangeEventDetails,
  ) => {
    if (!nextOpen) {
      if (
        details.reason === "outside-press" &&
        details.event.target instanceof Node &&
        anchorRef.current?.contains(details.event.target)
      ) {
        // The anchor toggles the popover itself; closing here first would
        // let its click reopen it.
        details.cancel();
        return;
      }
      if (details.reason === "escape-key" && !isDialogTopmost(id)) {
        // A drawer or dialog opened from this popover closes first.
        details.cancel();
        return;
      }
    }
    setOpen(nextOpen, details);
  };

  const setAnchor = React.useCallback((element: Element | null) => {
    anchorRef.current = element;
  }, []);
  const contextValue = React.useMemo(
    () => ({ id, setAnchor, byKeyboard, overModal }),
    [id, setAnchor, byKeyboard, overModal],
  );

  return (
    <PopoverContext.Provider value={contextValue}>
      <PopoverPrimitive.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        modal={modal}
      >
        {children}
      </PopoverPrimitive.Root>
    </PopoverContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

const VARIANT = {
  /** Menu rows (MENU_ITEM), max 280. */
  menu: "w-max max-w-[min(280px,var(--available-width))]",
  /** Rich content (profile, account, notifications): max 360, own body. */
  rich: "w-[min(360px,var(--available-width))] max-w-[360px]",
  /** Rich content with the standard 16px body padding (profile, account: 340). */
  panel: "w-[min(340px,var(--available-width))] max-w-[360px] p-4",
} as const;

type PopoverContentProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "className" | "style"
> & {
  className?: string;
  style?: React.CSSProperties;
  variant?: keyof typeof VARIANT;
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: number;
  alignOffset?: number;
  collisionPadding?: number;
  /** Position against this instead of the trigger. */
  anchor?: Anchor;
  /** Opened from a dialog or picker: the stacked layer (z-60). */
  stacked?: boolean;
  initialFocus?: PopoverPrimitive.Popup.Props["initialFocus"];
  finalFocus?: PopoverPrimitive.Popup.Props["finalFocus"];
  /** Classes for the positioner (rarely needed). */
  positionerClassName?: string;
};

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent(
    {
      className,
      style,
      variant = "menu",
      side = "bottom",
      align = "center",
      sideOffset = 8,
      alignOffset = 0,
      collisionPadding = 8,
      anchor,
      stacked = false,
      initialFocus,
      finalFocus,
      positionerClassName,
      children,
      ...props
    },
    ref,
  ) {
    const context = React.useContext(PopoverContext);
    const setAnchor = context?.setAnchor;

    React.useLayoutEffect(() => {
      if (!setAnchor) return;
      setAnchor(anchorElement(anchor));
      return () => setAnchor(null);
    });

    return (
      <PopoverPrimitive.Portal
        data-slot="popover-portal"
        {...{ [FLOATING_LAYER_ATTR]: "" }}
        // A Radix modal dialog under this popover sets pointer-events: none
        // on <body>; the popover must still take clicks.
        className="pointer-events-auto"
      >
        <PopoverPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          anchor={anchor}
          className={cn(
            context?.overModal ? "z-70" : stacked ? "z-60" : "z-50",
            "outline-none",
            positionerClassName,
          )}
        >
          <PopoverPrimitive.Popup
            ref={ref}
            data-slot="popover-content"
            data-dialog-root-id={context?.id}
            data-dialog-back-enabled="true"
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              MENU_PANEL,
              VARIANT[variant],
              "flex max-h-(--available-height) origin-(--transform-origin) flex-col overflow-y-auto text-ink-1 outline-none",
              // Presence (styles/motion.css): fade + scale from the anchor.
              "rm-presence",
              className,
            )}
            data-keyboard={context?.byKeyboard ? "" : undefined}
            style={{
              ...POPOVER_PRESENCE_VARS,
              ...(context?.byKeyboard ? KEYBOARD_PRESENCE_VARS : null),
              ...style,
            }}
            {...props}
          >
            {/*
             * Pauses the focus trap of a Radix dialog under this popover
             * (Radix keeps one scope stack); see ui/drawer.tsx. Its own
             * auto-focus is off so Base UI's `initialFocus` / return focus
             * decide where focus goes, not "first focusable".
             */}
            <FocusScope
              asChild
              onMountAutoFocus={preventDefault}
              onUnmountAutoFocus={preventDefault}
            >
              <div className="contents">{children}</div>
            </FocusScope>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    );
  },
);

/**
 * The 13.1 "anchored picker / menu" pair: a popover on desktop, a bottom
 * drawer on phones, with one body. Controlled only; the host owns `open`.
 */
type ResponsivePopoverProps = Omit<PopoverContentProps, "children"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name; the drawer shows it as its title when `drawerTitle`. */
  title: string;
  /** Show `title` as a visible heading in the phone drawer. */
  drawerTitle?: boolean;
  /** Phone drawer classes (height, padding). */
  drawerClassName?: string;
  /** Force one form (fixtures, tests). */
  forceMode?: "popover" | "drawer";
  children: React.ReactNode;
};

function ResponsivePopover({
  open,
  onOpenChange,
  title,
  drawerTitle = false,
  drawerClassName,
  forceMode,
  stacked,
  children,
  ...contentProps
}: ResponsivePopoverProps) {
  const isMobile = useIsMobile();
  const drawer = forceMode ? forceMode === "drawer" : isMobile;

  if (drawer) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          aria-label={title}
          className={cn(stacked && "z-60", drawerClassName)}
          overlayClassName={stacked ? "z-60" : undefined}
        >
          {drawerTitle ? (
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
            </DrawerHeader>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-2">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverContent aria-label={title} stacked={stacked} {...contentProps}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  ResponsivePopover,
};
