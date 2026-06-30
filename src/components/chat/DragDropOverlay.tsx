import { Download } from "./Icons";

export function DragDropOverlay({ isDragging }: { isDragging: boolean }) {
  if (!isDragging) return null;
  return (
    <div className="absolute inset-0 bg-rm-accent/20 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none border-2 border-dashed border-rm-accent/50 m-4 rounded-xl transition-all animate-in fade-in zoom-in duration-200">
      <div className="flex flex-col items-center gap-4 bg-rm-bg-elevated p-12 rounded-3xl shadow-2xl border border-rm-border">
        <div className="w-20 h-20 rounded-full bg-rm-accent/10 flex items-center justify-center text-rm-accent">
          <Download size={40} className="animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite]" />
        </div>
        <p className="text-xl font-bold text-rm-text-primary">Drop to upload</p>
        <p className="text-sm text-rm-text-muted">You can upload files up to 25MB</p>
      </div>
    </div>
  );
}
