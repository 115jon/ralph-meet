"use client";

/**
 * A Dialog on desktop and a bottom Drawer on phones (below md), behind the
 * Dialog's own subcomponent names, so a modal adopts it by swapping imports:
 *
 *   <ResponsiveDialog open={open} onOpenChange={setOpen}>
 *     <ResponsiveDialogContent className="md:max-w-md">
 *       <ResponsiveDialogHeader>
 *         <ResponsiveDialogTitle>Invite people</ResponsiveDialogTitle>
 *       </ResponsiveDialogHeader>
 *       …
 *       <ResponsiveDialogFooter>…</ResponsiveDialogFooter>
 *     </ResponsiveDialogContent>
 *   </ResponsiveDialog>
 *
 * `className` on the content applies to both; `drawerClassName` /
 * `dialogClassName` to one.
 */

import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const ResponsiveDialogContext = React.createContext(false);

function useDrawerMode() {
  return React.useContext(ResponsiveDialogContext);
}

type ResponsiveDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  /** Force one form (fixtures, or a surface that must stay a dialog). */
  forceMode?: "dialog" | "drawer";
};

function ResponsiveDialog({
  forceMode,
  children,
  ...props
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  const drawer = forceMode ? forceMode === "drawer" : isMobile;

  return (
    <ResponsiveDialogContext.Provider value={drawer}>
      {drawer ? (
        <Drawer {...props}>{children}</Drawer>
      ) : (
        <Dialog {...props}>{children}</Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

type ResponsiveDialogContentProps = React.ComponentProps<
  typeof DialogContent
> & {
  drawerClassName?: string;
  dialogClassName?: string;
};

const ResponsiveDialogContent = React.forwardRef<
  HTMLDivElement,
  ResponsiveDialogContentProps
>(function ResponsiveDialogContent(
  {
    className,
    drawerClassName,
    dialogClassName,
    showCloseButton,
    children,
    ...props
  },
  ref,
) {
  const drawer = useDrawerMode();
  if (drawer) {
    // Radix focus/outside hooks have no drawer equivalent (focus is managed
    // by Base UI); Escape and scrim-tap hooks carry over.
    const {
      onOpenAutoFocus: _onOpenAutoFocus,
      onCloseAutoFocus: _onCloseAutoFocus,
      onInteractOutside: _onInteractOutside,
      onFocusOutside: _onFocusOutside,
      forceMount: _forceMount,
      size: _size,
      placement: _placement,
      initialFocus: _initialFocus,
      ...drawerProps
    } = props;
    return (
      <DrawerContent
        ref={ref}
        className={cn("gap-4 px-4 pt-1", className, drawerClassName)}
        {...drawerProps}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </DrawerContent>
    );
  }
  return (
    <DialogContent
      ref={ref}
      showCloseButton={showCloseButton}
      className={cn(className, dialogClassName)}
      {...props}
    >
      {children}
    </DialogContent>
  );
});

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const drawer = useDrawerMode();
  return drawer ? (
    <DrawerHeader className={cn("px-0 text-left", className)} {...props} />
  ) : (
    <DialogHeader className={className} {...props} />
  );
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const drawer = useDrawerMode();
  return drawer ? (
    // Same DOM order as the dialog footer (secondary first, primary last):
    // the primary lands on top of the phone stack, nearest the thumb's reach
    // from the content above it.
    <DrawerFooter
      className={cn(
        "flex-col-reverse px-0 [&_button]:min-h-11 [&_button]:w-full",
        className,
      )}
      {...props}
    />
  ) : (
    <DialogFooter className={className} {...props} />
  );
}

function ResponsiveDialogTitle(
  props: React.ComponentProps<typeof DialogTitle>,
) {
  const drawer = useDrawerMode();
  return drawer ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

function ResponsiveDialogDescription(
  props: React.ComponentProps<typeof DialogDescription>,
) {
  const drawer = useDrawerMode();
  return drawer ? (
    <DrawerDescription {...props} />
  ) : (
    <DialogDescription {...props} />
  );
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogClose>,
) {
  const drawer = useDrawerMode();
  return drawer ? <DrawerClose {...props} /> : <DialogClose {...props} />;
}

Object.assign(ResponsiveDialogTitle, { rmSlot: "title" });
Object.assign(ResponsiveDialogDescription, { rmSlot: "description" });

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
};
