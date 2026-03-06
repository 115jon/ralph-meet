import { BaseModal } from "@/components/ui/BaseModal";
import { isDesktop } from "@/lib/platform";
import { Loader2, Monitor } from "lucide-react";
import React, { useCallback, useEffect, useReducer, useRef } from "react";
import {
  type MediaDeviceSource,
  type ScreenSource,
  type Tab,
  DesktopScreenPickerBottomBar,
  DesktopScreenPickerTabBar,
  DeviceGrid,
  QUALITY_PRESETS,
  SourceGrid,
} from "./DesktopScreenPickerUI";

export interface DesktopScreenPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: { quality: string; withAudio: boolean; sourceId?: string }) => void;
  availableQualities: string[];
}

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

  return (
    <BaseModal onClose={onClose}>
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
        <DesktopScreenPickerTabBar
          tab={state.tab}
          setTab={(tab) => dispatch({ type: 'SET_TAB', payload: tab })}
        />

        {/* Content Area */}
        <div className="min-h-[320px] max-h-[420px] overflow-y-auto p-4">
          {state.tab === "devices" ? (
            <DeviceGrid devices={state.devices} selectedId={state.selectedId} onSelect={(id) => dispatch({ type: 'SET_SELECTED_ID', payload: id })} />
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

        <DesktopScreenPickerBottomBar
          displayName={displayName}
          selectedQ={selectedQ}
          qualities={qualities}
          selectedQuality={state.selectedQuality}
          setQuality={(q) => dispatch({ type: 'SET_QUALITY', payload: q })}
          withAudio={state.withAudio}
          toggleAudio={() => dispatch({ type: 'TOGGLE_AUDIO' })}
          onClose={onClose}
          onStart={() => {
            if (!state.selectedId) return;
            onStart({ quality: state.selectedQuality, withAudio: state.withAudio, sourceId: state.selectedId });
          }}
          selectedId={state.selectedId}
        />
      </div>
    </div>
    </BaseModal>
  );
};


