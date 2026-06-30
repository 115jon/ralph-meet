
import { BaseModal } from "@/components/ui/BaseModal";
import { cn } from "@/lib/utils";
import { Check, Info, Music, Zap } from "lucide-react";
import React, { useState } from "react";
import { Monitor } from "./chat/Icons";

interface ScreenShareModalProps {
  isClosing?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: { quality: string; withAudio: boolean }) => void;
  availableQualities: string[];
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  isOpen,
  isClosing,
  onClose,
  onStart,
  availableQualities
}) => {
  const [selectedQuality, setSelectedQuality] = useState("720p30");
  const [withAudio, setWithAudio] = useState(true);

  if (!isOpen) return null;

  const qualities = [
    { id: "720p30", label: "720p", fps: "30 FPS", desc: "Standard HD. Reliable and efficient." },
    { id: "720p60", label: "720p", fps: "60 FPS", desc: "Smooth HD. Better for gaming/video." },
    { id: "1080p30", label: "1080p", fps: "30 FPS", desc: "Full HD. High detail for text/apps." },
    { id: "1080p60", label: "1080p", fps: "60 FPS", desc: "Pro Grade. Maximum smoothness and detail." },
    { id: "1440p30", label: "1440p", fps: "30 FPS", desc: "2K Quality. Ultra sharp." },
    { id: "1440p60", label: "1440p", fps: "60 FPS", desc: "2K High Motion. The sweet spot for gamers." },
    { id: "4k30", label: "4k", fps: "30 FPS", desc: "Ultra HD. Cinema grade detail." },
    { id: "4k60", label: "4k", fps: "60 FPS", desc: "The Ultimate. Highest possible fidelity." },
  ].filter(q => availableQualities.includes(q.id));

  return (
    <BaseModal onClose={onClose}>
      <div
      className={cn("fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm duration-200", isClosing ? "animate-out fade-out" : "animate-in fade-in")}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      role="presentation"
    >
      <dialog
        open
        className={cn("relative m-0 flex w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary p-0 shadow-2xl outline-none duration-300", isClosing ? "animate-out fade-out zoom-out-95 slide-out-to-bottom-4" : "animate-in zoom-in-95 slide-in-from-bottom-4")}
        aria-labelledby="screen-share-title"
      >
        {/* Header */}
        <div className="p-6 pb-2">
          <div className="mb-1 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Monitor size={24} />
            </div>
            <h2 id="screen-share-title" className="text-xl font-black text-rm-text">Share Your Screen</h2>
          </div>
          <p className="text-sm text-rm-text-muted">Choose your stream quality and settings. Higher settings require more bandwidth and CPU.</p>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Quality Grid */}
          <div className="grid grid-cols-2 gap-3">
            {qualities.map((q) => (
              <button
                key={q.id}
                onClick={() => setSelectedQuality(q.id)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-3 text-left transition-all outline-none",
                  selectedQuality === q.id
                    ? "border-primary/50 bg-primary/10 ring-1 ring-primary/50"
                    : "border-rm-border bg-rm-bg-surface/40 hover:border-rm-text/20 hover:bg-rm-bg-surface/60"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-black", selectedQuality === q.id ? "text-primary" : "text-rm-text")}>
                      {q.label}
                    </span>
                    <span className="rounded-md bg-rm-bg-elevated/40 px-1.5 py-0.5 text-[10px] font-black text-rm-text-muted group-hover:text-rm-text-secondary">
                      {q.fps}
                    </span>
                  </div>
                  {selectedQuality === q.id && <Check size={14} className="text-primary" />}
                </div>
                <p className="line-clamp-1 text-[10px] leading-tight text-rm-text-muted group-hover:text-rm-text-secondary">{q.desc}</p>

                {q.id.includes("60") && (
                  <div className="absolute -right-1 -top-1 p-1">
                    <Zap size={10} className="fill-warning text-warning opacity-50" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Options */}
          <div className="space-y-3">
            <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-rm-text-muted/40">Settings</h3>
            <button
              type="button"
              onClick={() => setWithAudio(!withAudio)}
              aria-pressed={withAudio}
              className="group flex w-full items-center justify-between rounded-xl border border-rm-border bg-rm-bg-surface/40 p-3 text-left transition-all hover:border-rm-text/20 hover:bg-rm-bg-surface/60 outline-none focus:ring-2 focus:ring-primary/20"
            >
              <div className="flex items-center gap-3">
                <div className={cn("rounded-lg p-2 transition-colors", withAudio ? "bg-primary/10 text-primary" : "bg-rm-bg-elevated/40 text-rm-text-muted/20")}>
                  <Music size={18} />
                </div>
                <div>
                  <div className="text-xs font-bold text-rm-text">Share Audio</div>
                  <div className="text-[10px] text-rm-text-muted">Monitor shares include system audio. App shares include only that app's audio when supported.</div>
                </div>
              </div>
              <div className={cn(
                "relative h-5 w-10 rounded-full transition-colors duration-200",
                withAudio ? "bg-primary" : "bg-rm-bg-elevated"
              )}>
                <div className={cn(
                  "absolute top-1 h-3 w-3 rounded-full bg-rm-text shadow-sm transition-all duration-200",
                  withAudio ? "left-6" : "left-1"
                )} />
              </div>
            </button>

            <div className="flex gap-3 rounded-xl border border-warning/10 bg-warning/5 p-3">
              <Info size={16} className="shrink-0 text-warning" />
              <p className="text-[10px] leading-relaxed italic text-warning/60">
                Pro Tip: Use <span className="font-bold text-warning">1080p / 30 FPS</span> for productivity and coding. Switch to <span className="font-bold text-warning">60 FPS</span> for smooth gameplay and video playback.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-rm-border bg-rm-bg-surface/20 p-4">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm font-bold text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart({ quality: selectedQuality, withAudio })}
            className="flex items-center gap-2 rounded-xl bg-primary px-8 py-2.5 text-sm font-black text-primary-foreground shadow-xl shadow-primary/20 transition-all active:scale-95 hover:brightness-110"
          >
            <span>Go Live</span>
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground/40" />
          </button>
        </div>
      </dialog>
    </div>
    </BaseModal>
  );
};
