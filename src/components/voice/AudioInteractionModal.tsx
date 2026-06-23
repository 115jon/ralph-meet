
import { BaseModal } from "@/components/ui/BaseModal";
import { X } from "../chat/Icons";
import { cn } from "@/lib/utils";

interface AudioInteractionModalProps {
  onInteract: () => void;
  onClose: () => void;
  isClosing?: boolean;
}

export function AudioInteractionModal({ onInteract, onClose, isClosing }: AudioInteractionModalProps) {
  return (
    <BaseModal onClose={onClose}>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className={cn("absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300", isClosing && "animate-out fade-out")}
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose(); }}
        role="presentation"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={cn("relative z-10 w-full max-w-sm animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl p-6 duration-300", isClosing && "animate-out fade-out zoom-out-95")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-modal-title"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-rm-text-muted/40 hover:text-rm-text transition-colors outline-none"
        >
          <X size={18} />
        </button>

        <div className="space-y-4">
          <div className="space-y-2">
            <h2 id="audio-modal-title" className="text-xl font-bold text-rm-text tracking-tight">Interaction Required</h2>
            <p className="text-sm text-rm-text-muted leading-relaxed">
              Browsers require user interaction before they will play audio. Just click okay to continue.
            </p>
          </div>

          <button
            onClick={onInteract}
            className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-indigo-500/20 outline-none"
          >
            Okay
          </button>
        </div>
      </div>
    </div>
    </BaseModal>
  );
}
