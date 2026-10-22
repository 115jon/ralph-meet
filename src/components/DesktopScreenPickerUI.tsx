import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";

export interface ScreenSource {
  id: string;
  capture_id?: string;
  name: string;
  kind: "window" | "monitor";
  thumbnail: string;
  app_name: string;
  /** base64 PNG data URL of the window's app icon ("" for monitors / no icon). */
  icon?: string;
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

export function DeviceGrid({
  devices,
  selectedId,
  onSelect,
}: {
  devices: MediaDeviceSource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (devices.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
        <Icon name="tv" size="3xl" className="opacity-30" />
        <p className="text-sm">No capture devices found</p>
        <p className="text-xs text-rm-text-muted/50">
          Connect a capture card or webcam to share
        </p>
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
            "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-ui outline-none",
            selectedId === device.deviceId
              ? "border-primary ring-2 ring-primary/30 bg-primary/5"
              : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20",
          )}
        >
          <div className="flex aspect-video w-full items-center justify-center bg-rm-bg-elevated/30">
            <Icon
              name="tv"
              size="2xl"
              className={cn(
                "transition-colors",
                selectedId === device.deviceId
                  ? "text-primary"
                  : "text-rm-text-muted/30",
              )}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className={cn(
                "truncate text-xs font-semibold",
                selectedId === device.deviceId
                  ? "text-primary"
                  : "text-rm-text",
              )}
            >
              {device.label}
            </span>
          </div>
          {selectedId === device.deviceId && (
            <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
              <Icon
                name="check"
                size="xs"
                className="text-primary-foreground"
              />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export function SourceGrid({
  sources,
  thumbnails,
  selectedId,
  onSelect,
  onPreview,
}: {
  sources: ScreenSource[];
  thumbnails: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {sources.map((source) => {
        const thumb = thumbnails[source.id];
        return (
          <button
            key={source.id}
            onClick={() => onSelect(source.id)}
            onFocus={() => onPreview(source.id)}
            onMouseEnter={() => onPreview(source.id)}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-ui hover:brightness-110 outline-none",
              selectedId === source.id
                ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20",
            )}
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black/60">
              {thumb ? (
                <img
                  src={thumb}
                  alt={source.name}
                  className="h-full w-full object-contain animate-in fade-in duration-300"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  {source.kind === "monitor" ? (
                    <Icon
                      name="monitor"
                      size="xl"
                      className="text-rm-text-muted/30"
                    />
                  ) : (
                    <Icon
                      name="window"
                      size="xl"
                      className="text-rm-text-muted/30"
                    />
                  )}
                </div>
              )}
              {selectedId === source.id && (
                <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
                  <Icon
                    name="check"
                    size="xs"
                    className="text-primary-foreground"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              {source.kind === "window" && source.icon ? (
                <img
                  src={source.icon}
                  alt=""
                  className="h-3.5 w-3.5 shrink-0 object-contain"
                  draggable={false}
                />
              ) : source.kind === "monitor" ? (
                <Icon
                  name="monitor"
                  size="sm"
                  className="shrink-0 text-rm-text-muted"
                />
              ) : (
                <Icon
                  name="window"
                  size="sm"
                  className="shrink-0 text-rm-text-muted"
                />
              )}
              <span
                className={cn(
                  "truncate text-xs font-semibold",
                  selectedId === source.id ? "text-primary" : "text-rm-text",
                )}
              >
                {source.name}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DesktopScreenPickerTabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  return (
    <div className="flex border-b border-rm-border bg-rm-bg-surface/30">
      {(
        [
          {
            key: "applications" as Tab,
            icon: "window",
            label: "Applications",
          },
          { key: "screens" as Tab, icon: "monitor", label: "Entire Screen" },
          { key: "devices" as Tab, icon: "tv", label: "Devices" },
        ] as const
      ).map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold transition-ui",
            tab === t.key
              ? "border-b-2 border-primary text-primary"
              : "text-rm-text-muted hover:text-rm-text",
          )}
        >
          <Icon name={t.icon} size="sm" />
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
          <div className="flex items-center gap-1.5 text-ui-2xs text-rm-text-muted">
            <span>{selectedQ?.label || "720p"}</span>
            <span className="opacity-40">·</span>
            <span>{selectedQ?.fps || 30} FPS</span>
          </div>
        </div>
      </div>

      {/* Center: Quality selector + Audio toggle */}
      <div className="flex items-center gap-3">
        <Select value={selectedQuality} onValueChange={setQuality}>
          <SelectTrigger
            aria-label="Select stream quality"
            className="h-auto rounded-lg border-rm-border bg-rm-bg-elevated px-3 py-1.5 text-xs font-bold text-rm-text outline-none focus:ring-2 focus:ring-primary/30"
          >
            <SelectValue placeholder="Select quality" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {qualities.map((quality) => (
              <SelectItem
                key={quality.id}
                value={quality.id}
                textValue={`${quality.label} ${quality.fps}fps`}
              >
                {quality.label} · {quality.fps}fps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={toggleAudio}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-ui",
            withAudio
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-rm-border bg-rm-bg-elevated text-rm-text-muted hover:text-rm-text",
          )}
        >
          <Icon name="music" size="sm" />
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
            "flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-semibold shadow-xl transition-ui active:scale-[0.96]",
            selectedId
              ? "bg-primary text-primary-foreground shadow-primary/20 hover:brightness-110"
              : "bg-rm-bg-elevated text-rm-text-muted cursor-not-allowed",
          )}
        >
          <span>Go Live</span>
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground/40" />
        </button>
      </div>
    </div>
  );
}
