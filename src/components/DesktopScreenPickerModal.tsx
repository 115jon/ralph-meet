import { isDesktop } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AppWindow, Check, Loader2, Monitor, Music, Tv } from "lucide-react";
import React, { useCallback, useEffect, useReducer, useRef } from "react";
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

interface State {
  tab: Tab;
  sources: ScreenSource[];
  thumbnails: Record<string, string>;
  loading: boolean;
  selectedId: string | null;
  selectedQuality: string;
  withAudio: boolean;
  devices: MediaDeviceSource[];
}

type Action =
  | { type: 'SET_TAB'; payload: Tab }
  | { type: 'SET_SOURCES'; payload: ScreenSource[]; isInitial: boolean }
  | { type: 'SET_THUMBNAILS'; payload: Record<string, string> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SELECTED_ID'; payload: string | null }
  | { type: 'SET_QUALITY'; payload: string }
  | { type: 'TOGGLE_AUDIO' }
  | { type: 'SET_DEVICES'; payload: MediaDeviceSource[] }
  | { type: 'RESET_ON_OPEN' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, tab: action.payload };
    case 'SET_SOURCES':
      return {
        ...state,
        sources: action.payload,
        thumbnails: action.isInitial ? {} : state.thumbnails,
      };
    case 'SET_THUMBNAILS':
      return { ...state, thumbnails: { ...state.thumbnails, ...action.payload } };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_SELECTED_ID':
      return { ...state, selectedId: action.payload };
    case 'SET_QUALITY':
      return { ...state, selectedQuality: action.payload };
    case 'TOGGLE_AUDIO':
      return { ...state, withAudio: !state.withAudio };
    case 'SET_DEVICES':
      return { ...state, devices: action.payload };
    case 'RESET_ON_OPEN':
      return { ...state, selectedId: null, thumbnails: {} };
    default:
      return state;
  }
}

export const DesktopScreenPickerModal: React.FC<DesktopScreenPickerModalProps> = ({
  isOpen,
  onClose,
  onStart,
  availableQualities,
}) => {
  const [state, dispatch] = useReducer(reducer, {
    tab: "applications",
    sources: [],
    thumbnails: {},
    loading: true,
    selectedId: null,
    selectedQuality: "720p30",
    withAudio: true,
    devices: [],
  });

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
    if (isInitial) dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await invokeRef.current("get_screen_sources") as ScreenSource[];
      dispatch({ type: 'SET_SOURCES', payload: result, isInitial });
    } catch (err) {
      console.error("[ScreenPicker] Failed to load sources:", err);
    } finally {
      if (isInitial) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  // Load a single thumbnail asynchronously
  const loadThumbnail = useCallback(async (sourceId: string) => {
    if (!invokeRef.current) return null;
    try {
      const thumb = await invokeRef.current("get_source_thumbnail", { sourceId }) as string;
      if (thumb) return { sourceId, thumb };
    } catch {
      // silently skip failed thumbnails
    }
    return null;
  }, []);

  // Load video input devices for "Devices" tab
  const loadDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 6)}` }));
      dispatch({ type: 'SET_DEVICES', payload: videoInputs });
    } catch {
      dispatch({ type: 'SET_DEVICES', payload: [] });
    }
  }, []);

  const handleOpenInit = useCallback(() => {
    if (isOpen) {
      loadSources(true);
      loadDevices();
      dispatch({ type: 'RESET_ON_OPEN' });
    }
  }, [isOpen, loadSources, loadDevices]);

  // On open: load sources + devices
  useEffect(() => {
    handleOpenInit();
  }, [handleOpenInit]);

  // Start polling for updates
  useEffect(() => {
    if (!isOpen) return;
    // Poll sources every 2s for real-time title/window updates
    const sourceInterval = setInterval(() => loadSources(false), 2000);
    return () => clearInterval(sourceInterval);
  }, [isOpen, loadSources]);

  // After sources load, fire off thumbnail requests for visible sources
  // Also refresh thumbnails every 3s so previews stay current
  useEffect(function refreshThumbnails() {
    if (state.sources.length === 0 || !isOpen) return;
    const getVisible = () => state.sources.filter(s =>
      state.tab === "applications" ? s.kind === "window" : s.kind === "monitor"
    );

    const updateThumbnails = async () => {
      const visible = getVisible();
      const results = await Promise.all(visible.map(s => loadThumbnail(s.id)));
      const newThumbs: Record<string, string> = {};
      results.forEach(res => { if (res) newThumbs[res.sourceId] = res.thumb; });
      if (Object.keys(newThumbs).length > 0) {
        dispatch({ type: 'SET_THUMBNAILS', payload: newThumbs });
      }
    };

    // Initial load immediately
    updateThumbnails();

    // Periodic refresh
    const thumbInterval = setInterval(updateThumbnails, 3000);
    return () => clearInterval(thumbInterval);
  }, [state.sources, state.tab, isOpen, loadThumbnail]);

  // When tab changes or selected item disappears, auto-select first source
  // When tab changes or selected item disappears, auto-select first source
  useEffect(function autoSelectSource() {
    if (state.tab === "devices") {
      if (!state.selectedId || !state.devices.some(d => d.deviceId === state.selectedId)) {
        dispatch({ type: 'SET_SELECTED_ID', payload: state.devices.length > 0 ? state.devices[0].deviceId : null });
      }
      return;
    }
    const tabSources = state.sources.filter(s =>
      state.tab === "applications" ? s.kind === "window" : s.kind === "monitor"
    );
    // Only auto-select if no current selection or selected item is gone
    const selectionStillExists = state.selectedId && tabSources.some(s => s.id === state.selectedId);
    if (!selectionStillExists) {
      dispatch({ type: 'SET_SELECTED_ID', payload: tabSources.length > 0 ? tabSources[0].id : null });
    }
  }, [state.tab, state.sources, state.devices, state.selectedId]);

  if (!isOpen) return null;

  const filteredSources = state.tab === "devices" ? [] : state.sources.filter(s =>
    state.tab === "applications" ? s.kind === "window" : s.kind === "monitor"
  );

  const selectedSource = state.sources.find(s => s.id === state.selectedId);
  const selectedDevice = state.devices.find(d => d.deviceId === state.selectedId);
  const qualities = QUALITY_PRESETS.filter(q => availableQualities.includes(q.id));
  const selectedQ = QUALITY_PRESETS.find(q => q.id === state.selectedQuality);

  const displayName = state.tab === "devices"
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
              onClick={() => dispatch({ type: 'SET_TAB', payload: t.key })}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold transition-all",
                state.tab === t.key
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
          {state.tab === "devices" ? (
            <DeviceGrid devices={state.devices} selectedId={state.selectedId} onSelect={(id) => dispatch({ type: 'SET_SELECTED_ID', payload: id })} />
          ) : state.loading ? (
            /* Devices Tab */
            state.devices.length === 0 ? (
              <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
                <Tv size={40} className="opacity-30" />
                <p className="text-sm">No capture devices found</p>
                <p className="text-xs text-rm-text-muted/50">Connect a capture card or webcam to share</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {state.devices.map((device) => (
                  <button
                    key={device.deviceId}
                    onClick={() => dispatch({ type: 'SET_SELECTED_ID', payload: device.deviceId })}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all outline-none",
                      state.selectedId === device.deviceId
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                        : "border-rm-border/50 hover:border-rm-text/30 bg-rm-bg-surface/20"
                    )}
                  >
                    <div className="flex aspect-video w-full items-center justify-center bg-rm-bg-elevated/30">
                      <Tv size={32} className={cn(
                        "transition-colors",
                        state.selectedId === device.deviceId ? "text-primary" : "text-rm-text-muted/30"
                      )} />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className={cn(
                        "truncate text-xs font-semibold",
                        state.selectedId === device.deviceId ? "text-primary" : "text-rm-text"
                      )}>
                        {device.label}
                      </span>
                    </div>
                    {state.selectedId === device.deviceId && (
                      <div className="absolute right-2 top-2 rounded-full bg-primary p-1 shadow-lg">
                        <Check size={12} className="text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : state.loading ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 size={32} className="animate-spin text-rm-text-muted" />
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
              <Monitor size={40} className="opacity-30" />
              <p className="text-sm">No {state.tab === "applications" ? "applications" : "screens"} found</p>
            </div>
          ) : (
            <SourceGrid sources={filteredSources} thumbnails={state.thumbnails} selectedId={state.selectedId} onSelect={(id) => dispatch({ type: 'SET_SELECTED_ID', payload: id })} />
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
              value={state.selectedQuality}
              onChange={(e) => dispatch({ type: 'SET_QUALITY', payload: e.target.value })}
              className="rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-1.5 text-xs font-bold text-rm-text outline-none focus:ring-2 focus:ring-primary/30"
            >
              {qualities.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label} · {q.fps}fps
                </option>
              ))}
            </select>

            <button
              onClick={() => dispatch({ type: 'TOGGLE_AUDIO' })}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                state.withAudio
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
                if (!state.selectedId) return;
                onStart({ quality: state.selectedQuality, withAudio: state.withAudio, sourceId: state.selectedId });
              }}
              disabled={!state.selectedId}
              className={cn(
                "flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-black shadow-xl transition-all active:scale-95",
                state.selectedId
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

function DeviceGrid({ devices, selectedId, onSelect }: { devices: MediaDeviceSource[], selectedId: string | null, onSelect: (id: string) => void }) {
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

function SourceGrid({ sources, thumbnails, selectedId, onSelect }: { sources: ScreenSource[], thumbnails: Record<string, string>, selectedId: string | null, onSelect: (id: string) => void }) {
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
