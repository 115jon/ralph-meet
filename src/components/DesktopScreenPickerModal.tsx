import { isDesktop } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AppWindow, Check, Loader2, Monitor, Music, Tv } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ScreenSource {
  id: string;
  name: string;
  kind: "window" | "monitor";
  thumbnail: string;
  app_name: string;
}

interface MediaDeviceSource {
  deviceId: string;
  label: string;
}

interface DesktopScreenPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: { quality: string; withAudio: boolean; sourceId?: string }) => void;
  availableQualities: string[];
}

type Tab = "applications" | "screens" | "devices";

const QUALITY_PRESETS = [
  { id: "720p30", label: "720p", fps: 30 },
  { id: "720p60", label: "720p", fps: 60 },
  { id: "1080p30", label: "1080p", fps: 30 },
  { id: "1080p60", label: "1080p", fps: 60 },
  { id: "1440p30", label: "1440p", fps: 30 },
  { id: "1440p60", label: "1440p", fps: 60 },
  { id: "4k30", label: "4K", fps: 30 },
  { id: "4k60", label: "4K", fps: 60 },
];

export const DesktopScreenPickerModal: React.FC<DesktopScreenPickerModalProps> = ({
  isOpen,
  onClose,
  onStart,
  availableQualities,
}) => {
  const [tab, setTab] = useState<Tab>("applications");
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedQuality, setSelectedQuality] = useState("720p30");
  const [withAudio, setWithAudio] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceSource[]>([]);
  const invokeRef = useRef<((cmd: string, args?: any) => Promise<any>) | null>(null);

  // Load the invoke function once
  useEffect(() => {
    if (isDesktop()) {
      import("@tauri-apps/api/core").then(mod => {
        invokeRef.current = mod.invoke;
      });
    }
  }, []);

  // Load sources (fast — metadata only, no thumbnails)
  const loadSources = useCallback(async (isInitial = false) => {
    if (!invokeRef.current) return;
    if (isInitial) setLoading(true);
    try {
      const result = await invokeRef.current("get_screen_sources") as ScreenSource[];
      setSources(result);
      if (isInitial) setThumbnails({}); // only reset thumbnails on first load
    } catch (err) {
      console.error("[ScreenPicker] Failed to load sources:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  // Load a single thumbnail asynchronously
  const loadThumbnail = useCallback(async (sourceId: string) => {
    if (!invokeRef.current) return;
    try {
      const thumb = await invokeRef.current("get_source_thumbnail", { sourceId }) as string;
      if (thumb) {
        setThumbnails(prev => ({ ...prev, [sourceId]: thumb }));
      }
    } catch {
      // silently skip failed thumbnails
    }
  }, []);

  // Load video input devices for "Devices" tab
  const loadDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 6)}` }));
      setDevices(videoInputs);
    } catch {
      setDevices([]);
    }
  }, []);

  // On open: load sources + devices, start polling for updates
  useEffect(() => {
    if (isOpen) {
      loadSources(true);
      loadDevices();
      setSelectedId(null);

      // Poll sources every 2s for real-time title/window updates
      const sourceInterval = setInterval(() => loadSources(false), 2000);

      return () => {
        clearInterval(sourceInterval);
      };
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // After sources load, fire off thumbnail requests for visible sources
  // Also refresh thumbnails every 3s so previews stay current
  useEffect(() => {
    if (sources.length === 0 || !isOpen) return;
    const getVisible = () => sources.filter(s =>
      tab === "applications" ? s.kind === "window" : s.kind === "monitor"
    );

    // Initial load: only fetch missing thumbnails
    const visible = getVisible();
    visible.forEach((s, i) => {
      if (!thumbnails[s.id]) {
        setTimeout(() => loadThumbnail(s.id), i * 50);
      }
    });

    // Periodic refresh: update ALL visible thumbnails
    const thumbInterval = setInterval(() => {
      getVisible().forEach((s, i) => {
        setTimeout(() => loadThumbnail(s.id), i * 30);
      });
    }, 3000);

    return () => clearInterval(thumbInterval);
  }, [sources, tab, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // When tab changes or selected item disappears, auto-select first source
  useEffect(() => {
    if (tab === "devices") {
      if (!selectedId || !devices.some(d => d.deviceId === selectedId)) {
        setSelectedId(devices.length > 0 ? devices[0].deviceId : null);
      }
      return;
    }
    const tabSources = sources.filter(s =>
      tab === "applications" ? s.kind === "window" : s.kind === "monitor"
    );
    // Only auto-select if no current selection or selected item is gone
    const selectionStillExists = selectedId && tabSources.some(s => s.id === selectedId);
    if (!selectionStillExists) {
      setSelectedId(tabSources.length > 0 ? tabSources[0].id : null);
    }
  }, [tab, sources, devices]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const filteredSources = tab === "devices" ? [] : sources.filter(s =>
    tab === "applications" ? s.kind === "window" : s.kind === "monitor"
  );

  const selectedSource = sources.find(s => s.id === selectedId);
  const selectedDevice = devices.find(d => d.deviceId === selectedId);
  const qualities = QUALITY_PRESETS.filter(q => availableQualities.includes(q.id));
  const selectedQ = QUALITY_PRESETS.find(q => q.id === selectedQuality);

  const displayName = tab === "devices"
    ? selectedDevice?.label || "Select a device"
    : selectedSource?.name || "Select a source";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      role="presentation"
    >
      <div
        className="flex w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-picker-title"
        tabIndex={-1}
      >
        {/* Tab Bar */}
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

        {/* Content Area */}
        <div className="min-h-[320px] max-h-[420px] overflow-y-auto p-4">
          {tab === "devices" ? (
            /* Devices Tab */
            devices.length === 0 ? (
              <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
                <Tv size={40} className="opacity-30" />
                <p className="text-sm">No capture devices found</p>
                <p className="text-xs text-rm-text-muted/50">Connect a capture card or webcam to share</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {devices.map((device) => (
                  <button
                    key={device.deviceId}
                    onClick={() => setSelectedId(device.deviceId)}
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
            )
          ) : loading ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 size={32} className="animate-spin text-rm-text-muted" />
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
              <Monitor size={40} className="opacity-30" />
              <p className="text-sm">No {tab === "applications" ? "applications" : "screens"} found</p>
            </div>
          ) : (
            /* Applications / Screens Grid */
            <div className="grid grid-cols-2 gap-3">
              {filteredSources.map((source) => {
                const thumb = thumbnails[source.id];
                return (
                  <button
                    key={source.id}
                    onClick={() => setSelectedId(source.id)}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all hover:brightness-110 outline-none",
                      selectedId === source.id
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                        : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20"
                    )}
                  >
                    {/* Thumbnail */}
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
                          <Loader2 size={20} className="animate-spin text-rm-text-muted/30" />
                        </div>
                      )}
                      {/* Selection checkmark */}
                      {selectedId === source.id && (
                        <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
                          <Check size={12} className="text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    {/* Label */}
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
          )}
        </div>

        {/* Bottom Controls Bar */}
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
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-1.5 text-xs font-bold text-rm-text outline-none focus:ring-2 focus:ring-primary/30"
            >
              {qualities.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label} · {q.fps}fps
                </option>
              ))}
            </select>

            <button
              onClick={() => setWithAudio(!withAudio)}
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
              onClick={() => {
                if (!selectedId) return;
                onStart({ quality: selectedQuality, withAudio, sourceId: selectedId });
              }}
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
      </div>
    </div>,
    document.body
  );
};
