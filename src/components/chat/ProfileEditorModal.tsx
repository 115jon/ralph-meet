import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { useUser } from "@kova/react";
import SettingsAccountTab from "./SettingsAccountTab";

interface ProfileEditorModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfileEditorModal({
  open,
  onClose,
}: ProfileEditorModalProps) {
  const { isLoaded: isUserLoaded } = useUser();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/56 p-4 backdrop-blur-[2px] transition-opacity duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 md:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <DialogSurface
            showCloseButton={false}
            aria-label="Edit profile"
            tabIndex={-1}
            className="relative overflow-hidden rounded-3xl border border-rm-border bg-rm-bg-primary shadow-[0_36px_110px_rgba(0,0,0,0.52)] animate-in zoom-in-95 duration-200 md:rounded-3xl"
            style={{
              width: "min(1240px, calc(100vw - 32px))",
              height: "min(860px, calc(100dvh - 32px))",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <SettingsAccountTab
              authUserLoaded={isUserLoaded}
              asModal
              onClose={onClose}
            />
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
