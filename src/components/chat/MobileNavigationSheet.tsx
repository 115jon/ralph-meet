import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { registerBackHandler } from "@/hooks/useBackButton";
import { useCallback, useEffect, type ReactNode } from "react";

interface MobileNavigationSheetProps {
  open: boolean;
  onClose: () => void;
  serverList: ReactNode;
  current: ReactNode;
}

export function MobileNavigationSheet({
  open,
  onClose,
  serverList,
  current,
}: MobileNavigationSheetProps) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      handleClose();
      return true;
    });
  }, [handleClose, open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <SheetContent
        side="left"
        className="flex w-[min(88vw,420px)] max-w-none flex-row gap-0 border-rm-border bg-rm-bg-primary p-0 pt-[var(--safe-area-top,0px)] md:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Chat navigation</SheetTitle>
          <SheetDescription>
            Choose a server, direct message, or channel.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden pb-[var(--safe-area-bottom,0px)]">
          <div className="w-[72px] shrink-0 overflow-hidden border-r border-rm-border bg-rm-bg-floating">
            {serverList}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden bg-rm-sidebar">
            {current}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
