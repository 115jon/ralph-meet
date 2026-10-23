import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface AudioInteractionModalProps {
  open: boolean;
  onInteract: () => void;
  onClose: () => void;
}

export function AudioInteractionModal({
  open,
  onInteract,
  onClose,
}: AudioInteractionModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <DialogSurface
          showCloseButton={false}
          className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-transparent p-4 outline-none"
          aria-labelledby="audio-modal-title"
        >
          <div
            className={cn(
              "absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out",
            )}
            onClick={onClose}
            role="presentation"
            aria-hidden="true"
          />
          <div
            className={cn(
              "relative z-10 m-0 w-full max-w-sm rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-300",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            )}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 rounded-md text-rm-text-muted hover:text-rm-text transition-colors"
            >
              <Icon name="close" size="md" />
            </button>

            <div className="space-y-4">
              <div className="space-y-2">
                <h2
                  id="audio-modal-title"
                  className="text-ui-xl font-semibold text-rm-text tracking-tight"
                >
                  Interaction Required
                </h2>
                <p className="text-ui-sm text-rm-text-muted leading-relaxed">
                  Browsers require user interaction before they will play audio.
                  Just click okay to continue.
                </p>
              </div>

              <button
                type="button"
                onClick={onInteract}
                className="w-full py-3 bg-rm-accent hover:bg-rm-accent-hover text-white font-bold rounded-xl transition-ui active:scale-[0.98] shadow-lg shadow-rm-accent/20 outline-none"
              >
                Okay
              </button>
            </div>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
