import { cn } from "@/lib/utils";
import { AppWindow, Check, Loader2, Monitor, Music, Tv } from "lucide-react";

export interface ScreenSource {
  id: string;
  name: string;
  kind: "window" | "monitor";
  thumbnail: string;
  app_name: string;
}

export interface MediaDeviceSource {
  deviceId: string;
  label: string;
}

export type Tab = "applications" | "screens" | "devices";

export const QUALITY_PRESETS = [
  { id: "720p30", label: "720p", fps: 30 },
  { id: "720p60", label: "720p", fps: 60 },
  { id: "1080p30", label: "1080p", fps: 30 },
  { id: "1080p60", label: "1080p", fps: 60 },
  { id: "1440p30", label: "1440p", fps: 30 },
  { id: "1440p60", label: "1440p", fps: 60 },
  { id: "4k30", label: "4K", fps: 30 },
  { id: "4k60", label: "4K", fps: 60 },
];

export function DeviceGrid({ devices, selectedId, onSelect }: { devices: MediaDeviceSource[], selectedId: string | null, onSelect: (id: string) => void }) {
  if (devices.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
        <Tv size={40} className="opacity-30" />
        <p className="text-sm">No capture devices found</p>
        <p className="text-xs text-rm-text-muted/50">Connect a capture card or webcam to share</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {devices.map((device) => (
        <button
          key={device.deviceId}
          onClick={() => onSelect(device.deviceId)}
          className={cn(
            "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all outline-none",
            selectedId === device.deviceId
              ? "border-primary ring-2 ring-primary/30 bg-primary/5"
              : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20"
          )}
        >
          <div className="flex aspect-video w-full items-center justify-center bg-rm-bg-elevated/30">
            <Tv size={32} className={cn(
              "transition-colors",
              selectedId === device.deviceId ? "text-primary" : "text-rm-text-muted/30"
            )} />
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className={cn(
              "truncate text-xs font-semibold",
              selectedId === device.deviceId ? "text-primary" : "text-rm-text"
            )}>
              {device.label}
            </span>
          </div>
          {selectedId === device.deviceId && (
            <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
              <Check size={12} className="text-primary-foreground" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export function SourceGrid({ sources, thumbnails, selectedId, onSelect }: { sources: ScreenSource[], thumbnails: Record<string, string>, selectedId: string | null, onSelect: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {sources.map((source) => {
        const thumb = thumbnails[source.id];
        return (
          <button
            key={source.id}
            onClick={() => onSelect(source.id)}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all hover:brightness-110 outline-none",
              selectedId === source.id
                ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20"
            )}
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black/60">
              {thumb ? (
                <img src={thumb} alt={source.name} className="h-full w-full object-contain animate-in fade-in duration-300" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-rm-text-muted/30" />
                </div>
              )}
              {selectedId === source.id && (
                <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
                  <Check size={12} className="text-primary-foreground" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              <span className={cn(
                "truncate text-xs font-semibold",
                selectedId === source.id ? "text-primary" : "text-rm-text"
              )}>
                {source.name}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DesktopScreenPickerTabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="flex border-b border-rm-border bg-rm-bg-surface/30">
      {(
        [
          { key: "applications" as Tab, icon: AppWindow, label: "Applications" },
          { key: "screens" as Tab, icon: Monitor, label: "Entire Screen" },
          { key: "devices" as Tab, icon: Tv, label: "Devices" },
        ] as const
      ).map(t => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold transition-all",
            tab === t.key
              ? "border-b-2 border-primary text-primary"
              : "text-rm-text-muted hover:text-rm-text"
          )}
        >
          <t.icon size={16} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DesktopScreenPickerBottomBar({
  displayName,
  selectedQ,
  qualities,
  selectedQuality,
  setQuality,
  withAudio,
  toggleAudio,
  onClose,
  onStart,
  selectedId,
}: {
  displayName: string;
  selectedQ: { label: string; fps: number } | undefined;
  qualities: typeof QUALITY_PRESETS;
  selectedQuality: string;
  setQuality: (q: string) => void;
  withAudio: boolean;
  toggleAudio: () => void;
  onClose: () => void;
  onStart: () => void;
  selectedId: string | null;
}) {
  return (
    <div className="flex items-center justify-between border-t border-rm-border bg-rm-bg-surface/30 px-5 py-3">
      {/* Left: Source name + quality info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-rm-text max-w-[200px]">
            {displayName}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-rm-text-muted">
            <span>{selectedQ?.label || "720p"}</span>
            <span className="opacity-40">·</span>
            <span>{selectedQ?.fps || 30} FPS</span>
          </div>
        </div>
      </div>

      {/* Center: Quality selector + Audio toggle */}
      <div className="flex items-center gap-3">
        <select
          value={selectedQuality}
          onChange={(e) => setQuality(e.target.value)}
          className="rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-1.5 text-xs font-bold text-rm-text outline-none focus:ring-2 focus:ring-primary/30"
        >
          {qualities.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label} · {q.fps}fps
            </option>
          ))}
        </select>

        <button
          onClick={toggleAudio}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
            withAudio
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-rm-border bg-rm-bg-elevated text-rm-text-muted hover:text-rm-text"
          )}
        >
          <Music size={14} />
          Audio
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-bold text-rm-text-muted hover:text-rm-text transition-colors outline-none"
        >
          Cancel
        </button>
        <button
          onClick={onStart}
          disabled={!selectedId}
          className={cn(
            "flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-black shadow-xl transition-all active:scale-95",
            selectedId
              ? "bg-primary text-primary-foreground shadow-primary/20 hover:brightness-110"
              : "bg-rm-bg-elevated text-rm-text-muted cursor-not-allowed"
          )}
        >
          <span>Go Live</span>
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground/40" />
        </button>
      </div>
    </div>
  );
}
