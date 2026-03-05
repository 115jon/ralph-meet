import { Download } from "./Icons";

export function DragDropOverlay({ isDragging }: { isDragging: boolean }) {
  if (!isDragging) return null;
  return (
    <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none border-2 border-dashed border-indigo-500/50 m-4 rounded-xl transition-all animate-in fade-in zoom-in duration-200">
      <div className="flex flex-col items-center gap-4 bg-rm-bg-elevated p-12 rounded-3xl shadow-2xl border border-rm-border">
        <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
          <Download size={40} className="animate-bounce" />
        </div>
        <p className="text-xl font-bold text-rm-text-primary">Drop to upload</p>
        <p className="text-sm text-rm-text-muted">You can upload files up to 25MB</p>
      </div>
    </div>
  );
}
