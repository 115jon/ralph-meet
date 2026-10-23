"use client";

import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDialogBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HIT, PRESS } from "@/components/ui/interaction";
import { shouldIgnoreSelectDismiss } from "@/components/ui/select-dismiss";
import { containsSlot, isDialogTopmost } from "@/components/ui/dialog-stack";

type DialogRootContextValue = {
  id: string;
  openerRef: React.RefObject<HTMLElement | null>;
  handlesBack: boolean;
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
      value={{ id: dialogId, openerRef, handlesBack }}
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

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-rm-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  showCloseButton?: boolean;
};

const DialogSurface = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogSurface(
  {
    className,
    children,
    showCloseButton = true,
    onCloseAutoFocus,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    ...props
  },
  ref,
) {
  const rootContext = React.useContext(DialogRootContext);
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
    if (shouldIgnoreSelectDismiss(event.target)) {
      event.preventDefault();
    }
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
      ref={ref}
      className={cn("min-h-0", className)}
      onCloseAutoFocus={handleCloseAutoFocus}
      onPointerDownOutside={(event) =>
        ignoreSelectDismiss(event, onPointerDownOutside)
      }
      onFocusOutside={(event) => ignoreSelectDismiss(event, onFocusOutside)}
      onInteractOutside={(event) =>
        ignoreSelectDismiss(event, onInteractOutside)
      }
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
            "absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-rm-text-muted pointer-fine:hover:text-rm-text disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-4",
            PRESS,
            HIT,
          )}
        >
          <Icon name="close" size="sm" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  );

  return content;
});

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent({ className, ...props }, ref) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogSurface
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overscroll-contain rounded-xl border border-rm-border bg-rm-bg-surface p-6 shadow-[var(--rm-shadow-3)] outline-none dark:bg-rm-bg-elevated data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-200 sm:max-w-lg",
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
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
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
        "flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-ui-lg font-semibold text-balance text-rm-text",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-ui-sm text-pretty text-rm-text-muted", className)}
      {...props}
    />
  );
}

Object.assign(DialogTitle, { rmSlot: "title" });
Object.assign(DialogDescription, { rmSlot: "description" });

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
};
