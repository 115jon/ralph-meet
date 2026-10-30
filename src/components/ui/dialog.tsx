"use client";

import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDialogBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";
import { Button, ButtonDefaults } from "@/components/ui/button";
import { DitherRule, DitherWord } from "@/components/ui/dither";
import { HIT, PRESS } from "@/components/ui/interaction";
import { shouldIgnoreSelectDismiss } from "@/components/ui/select-dismiss";
import {
  containsSlot,
  isDialogTopmost,
  isDrawerLayerTarget,
  lastInputWasKeyboard,
  useModalLayer,
  useOpenedByKeyboard,
} from "@/components/ui/dialog-stack";

type DialogRootContextValue = {
  id: string;
  openerRef: React.RefObject<HTMLElement | null>;
  handlesBack: boolean;
  open: boolean;
  modal: boolean;
  /** Opened over another modal layer (set by the surface, read by the scrim). */
  stacked: boolean;
  setStacked: (stacked: boolean) => void;
  /** Opened from the keyboard: opacity only, 100ms. */
  byKeyboard: boolean;
};

type DialogProps = React.ComponentProps<typeof DialogPrimitive.Root> & {
  onBackButton?: () => void;
};

const DialogRootContext = React.createContext<DialogRootContextValue | null>(
  null,
);

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  modal = true,
  onBackButton,
  ...props
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false,
  );
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const dialogId = React.useId();
  const handlesBack = modal || onBackButton !== undefined;
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  const [stacked, setStacked] = React.useState(false);
  const byKeyboard = useOpenedByKeyboard(isOpen);

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
    isOpen && handlesBack,
    () => {
      if (onBackButton) {
        onBackButton();
      } else {
        handleOpenChange(false);
      }
    },
    () => isDialogTopmost(dialogId),
  );

  return (
    <DialogRootContext.Provider
      value={{
        id: dialogId,
        openerRef,
        handlesBack,
        open: isOpen,
        modal,
        stacked,
        setStacked,
        byKeyboard,
      }}
    >
      <DialogPrimitive.Root
        data-slot="dialog"
        open={isOpen}
        modal={modal}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DialogRootContext.Provider>
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal" {...props}>
      <div data-slot="dialog-portal-root" className="pointer-events-auto">
        {children}
      </div>
    </DialogPrimitive.Portal>
  );
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The scrim. A dialog opened over another modal layer (a dialog, sheet,
 * drawer or the settings workbench) gets the light stacked scrim (.24) on
 * the stacked layer (z-60) instead of a second full one; the layer behind
 * recedes instead (see BEHIND_CUE).
 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const root = React.useContext(DialogRootContext);
  const stacked = root?.stacked ?? false;
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-stacked={stacked ? "" : undefined}
      className={cn(
        "fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-3) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--dur-3-exit)",
        stacked && "z-60 bg-scrim-stacked",
        root?.byKeyboard && "data-[state=open]:duration-100",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Recede for the layer behind a stacked one (overlays audit issue 9): scale
 * .985 and up 6px over 240ms, back over 160ms. `transform` composes with the
 * `translate` the centred dialogs use, so nothing jumps. Reduced motion keeps
 * the stacked scrim only.
 */
export const BEHIND_CUE =
  "[transition:transform_var(--dur-3)_var(--ease-out)] data-behind:[transform:translateY(-6px)_scale(0.985)] motion-reduce:data-behind:transform-none";

type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  showCloseButton?: boolean;
  /**
   * Where focus lands on open. "first" (default): the first focusable
   * (forms land on their first field, confirms on Cancel). "surface": the
   * dialog itself, with no visible ring (content dialogs such as a profile).
   *
   * With "first", a button, link or role=button that takes focus on a
   * pointer/touch open (a confirm's Cancel) shows no ring until the next key
   * press; opened from the keyboard it shows at once, and Tab always shows it.
   */
  initialFocus?: "first" | "surface";
};

const DialogSurface = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogSurface(
  {
    className,
    children,
    showCloseButton = true,
    initialFocus = "first",
    onOpenAutoFocus,
    onCloseAutoFocus,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onEscapeKeyDown,
    ...props
  },
  ref,
) {
  const rootContext = React.useContext(DialogRootContext);
  const layer = useModalLayer(Boolean(rootContext?.open && rootContext.modal));
  const setRootStacked = rootContext?.setStacked;
  React.useLayoutEffect(() => {
    setRootStacked?.(layer.stacked);
  }, [layer.stacked, setRootStacked]);
  const layerRef = layer.ref;
  const mergedRef = React.useCallback(
    (node: React.ElementRef<typeof DialogPrimitive.Content> | null) => {
      layerRef(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [layerRef, ref],
  );
  // First-focus on a pointer open: no ring on the landed button until a key is
  // pressed (data-pointer-focus, see the class on the surface below).
  const [pointerFocus, setPointerFocus] = React.useState(false);
  React.useEffect(() => {
    if (!pointerFocus) return;
    const onKey = (event: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      setPointerFocus(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [pointerFocus]);
  const hasTitle = containsSlot(children, "title");
  const hasDescription = containsSlot(children, "description");
  const hasDescribedBy = props["aria-describedby"] !== undefined;
  const accessibleLabel = props["aria-label"] ?? "Dialog";
  const ignoreSelectDismiss = <
    E extends { target: EventTarget | null; preventDefault: () => void },
  >(
    event: E,
    handler?: (event: E) => void,
  ) => {
    handler?.(event);
    // Base UI drawers (an action sheet or picker opened from this dialog)
    // portal outside Radix's layer stack; a tap or focus there isn't outside.
    if (
      shouldIgnoreSelectDismiss(event.target) ||
      isDrawerLayerTarget(event.target)
    ) {
      event.preventDefault();
    }
  };
  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    // A drawer opened above this dialog closes on its own Escape first.
    if (rootContext && !isDialogTopmost(rootContext.id)) {
      event.preventDefault();
      return;
    }
    onEscapeKeyDown?.(event);
  };
  const handleOpenAutoFocus = (event: Event) => {
    onOpenAutoFocus?.(event);
    if (event.defaultPrevented) return;
    if (initialFocus !== "surface") {
      setPointerFocus(!lastInputWasKeyboard());
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.focus?.({
      preventScroll: true,
    });
  };
  const handleCloseAutoFocus = (
    event: Parameters<
      NonNullable<
        React.ComponentProps<typeof DialogPrimitive.Content>["onCloseAutoFocus"]
      >
    >[0],
  ) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented) return;

    const opener = rootContext?.openerRef.current;
    if (opener?.isConnected && opener !== document.body) {
      event.preventDefault();
      opener.focus({ preventScroll: true });
    }
  };

  const content = (
    <DialogPrimitive.Content
      data-slot="dialog-surface"
      data-dialog-root-id={rootContext?.id}
      data-dialog-back-enabled={rootContext?.handlesBack ? "true" : undefined}
      data-stacked={layer.stacked ? "" : undefined}
      data-keyboard={rootContext?.byKeyboard ? "" : undefined}
      data-pointer-focus={pointerFocus ? "" : undefined}
      ref={mergedRef}
      className={cn(
        "min-h-0 data-pointer-focus:[&_:is(button,a,[role=button]):focus-visible]:outline-none!",
        className,
      )}
      onOpenAutoFocus={handleOpenAutoFocus}
      onCloseAutoFocus={handleCloseAutoFocus}
      onPointerDownOutside={(event) =>
        ignoreSelectDismiss(event, onPointerDownOutside)
      }
      onFocusOutside={(event) => ignoreSelectDismiss(event, onFocusOutside)}
      onInteractOutside={(event) =>
        ignoreSelectDismiss(event, onInteractOutside)
      }
      onEscapeKeyDown={handleEscapeKeyDown}
      {...props}
    >
      {!hasTitle && (
        <DialogTitle className="sr-only">{accessibleLabel}</DialogTitle>
      )}
      {!hasDescription && !hasDescribedBy && (
        <DialogDescription className="sr-only">
          Dialog content
        </DialogDescription>
      )}
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className={cn(
            // C1 close key: a 40px tint-2 key in the kicker row.
            "top-4 right-4 inline-flex size-10 items-center justify-center rounded-[2px] bg-tint-2 text-ink-1 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-5",
            PRESS,
            HIT,
            // After PRESS: tailwind-merge keeps the last position utility,
            // and PRESS's `relative` would otherwise drop this into the flow.
            "absolute",
          )}
        >
          <Icon name="close" size="md" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  );

  return content;
});

/**
 * The dialog width ladder (overlays §3b); nothing else.
 *   sm 400  confirms
 *   md 480  forms (default)
 *   lg 560  content (profile modal)
 *   xl 768  two-pane detail (shop item)
 * The settings workbench (1120 x 820) is its own shell, SettingsWorkbench.
 */
export const DIALOG_SIZE = {
  sm: "md:max-w-[400px]",
  md: "md:max-w-[480px]",
  lg: "md:max-w-[560px]",
  xl: "md:max-w-[768px]",
} as const;

export type DialogSize = keyof typeof DIALOG_SIZE;

/**
 * C1 plate (DESIGN.md, Dialog): 2px corners, ply-3, a line-strong edge,
 * shadow-modal. Content is a silkscreen kicker (DialogKicker), a Bricolage
 * title, the dithered DialogRule, a 15/22 body and a footer of 48px keys. Presence is
 * opacity + scale .96 -> 1 over 200ms, exit to .98 over 140ms; dialogs
 * opened from the keyboard skip the scale and fade for 100ms.
 */
export const DIALOG_SURFACE =
  "rounded-[2px] border border-line-strong bg-ply-3 [--plate-ground:var(--ply-3)] text-ink-1 shadow-modal outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.96] data-[state=open]:duration-(--dur-3) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=closed]:duration-(--dur-3-exit) data-keyboard:zoom-in-100! data-keyboard:zoom-out-100! data-keyboard:duration-100!";

type DialogContentFrameProps = DialogContentProps & {
  /** Width from the ladder (default md 480). */
  size?: DialogSize;
  /**
   * center: confirms. top: content and form dialogs anchor at
   * max(48px, 12vh) and grow downward, so a state change never recentres
   * them.
   */
  placement?: "center" | "top";
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentFrameProps
>(function DialogContent(
  { className, size = "md", placement = "center", ...props },
  ref,
) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogSurface
        ref={ref}
        data-slot="dialog-content"
        data-size={size}
        data-placement={placement}
        className={cn(
          "fixed left-[50%] z-50 data-stacked:z-60 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] gap-4 overscroll-contain p-6",
          placement === "top"
            ? "top-[max(48px,12vh)] max-h-[calc(100dvh-max(48px,12vh)-24px)] origin-top"
            : "top-[50%] translate-y-[-50%]",
          DIALOG_SURFACE,
          BEHIND_CUE,
          DIALOG_SIZE[size],
          className,
        )}
        {...props}
      />
    </DialogPortal>
  );
});

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 pr-12 text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 pt-2 md:flex-row md:flex-wrap md:items-center md:justify-end max-md:[&>[data-slot=button]]:w-full",
        className,
      )}
      {...props}
    >
      {/* Footer keys are 48 and a secondary here sits beside the primary. */}
      <ButtonDefaults size="lg" paired>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button variant="secondary">Close</Button>
          </DialogPrimitive.Close>
        )}
      </ButtonDefaults>
    </div>
  );
}

/**
 * The kicker over a dialog title: silkscreen in ink-3 ("Invite · Ralph HQ",
 * "Desktop sign-in · 4 min left"). Context, not a heading.
 */
function DialogKicker({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-kicker"
      className={cn("silkscreen min-h-6 text-ink-3", className)}
      {...props}
    />
  );
}

/** The dithered rule under a C1 plate's title. Decorative and still. */
function DialogRule({ className }: { className?: string }) {
  return <DitherRule className={cn("mt-2 h-2", className)} cell={2} />;
}

function DialogTitle({
  className,
  poster = false,
  ditherLast,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  /**
   * C2 poster: a 40px display title for one-off moments (device approval,
   * first run). Pair with `ditherLast`.
   */
  poster?: boolean;
  /** The poster's last word, printed in the accent dither (DitherWord). */
  ditherLast?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      data-poster={poster ? "" : undefined}
      className={cn(
        "font-display [font-optical-sizing:auto] text-balance text-ink-1",
        poster
          ? "text-[40px] leading-[0.92] font-extrabold tracking-[-0.04em]"
          : // C1 plate: 28/32 extrabold; a confirm (sm) dialog runs 22/28.
            "text-[28px] leading-8 font-extrabold tracking-[-0.03em] in-data-[size=sm]:text-[22px] in-data-[size=sm]:leading-7 in-data-[size=sm]:font-bold in-data-[size=sm]:tracking-[-0.01em]",
        className,
      )}
      {...props}
    >
      {children}
      {ditherLast ? (
        <>
          {" "}
          <DitherWord cell={3}>{ditherLast}</DitherWord>
        </>
      ) : null}
    </DialogPrimitive.Title>
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-ui-base text-pretty text-ink-2", className)}
      {...props}
    />
  );
}

Object.assign(DialogTitle, { rmSlot: "title" });
Object.assign(DialogDescription, { rmSlot: "description" });

export type { DialogContentFrameProps as DialogContentProps };

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogKicker,
  DialogOverlay,
  DialogRule,
  DialogPortal,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
};
