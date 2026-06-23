import { BaseModal } from "@/components/ui/BaseModal";
import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import type { StartScreenShareOptions } from "@/lib/screen-share-types";
import { Loader2, Monitor } from "lucide-react";
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  isClosing?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StartScreenShareOptions) => void;
  availableQualities: string[];
}

interface State {
  tab: Tab;
  sources: ScreenSource[];
  thumbnails: Record<string, string>;
  loading: boolean;
  previewLoading: boolean;
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
  | { type: 'SET_PREVIEW_LOADING'; payload: boolean }
  | { type: 'SET_SELECTED_ID'; payload: string | null }
  | { type: 'SET_QUALITY'; payload: string }
  | { type: 'TOGGLE_AUDIO' }
  | { type: 'SET_DEVICES'; payload: MediaDeviceSource[] }
  | { type: 'RESET_ON_OPEN' };

const log = clog("ScreenPicker");

function logScreenPicker(message: string, details?: unknown) {
  if (details === undefined) {
    log.info(message);
    return;
  }
  try {
    log.info(`${message} ${JSON.stringify(details, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      return value;
    })}`);
  } catch {
    log.info(message, details);
  }
}

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
    case 'SET_PREVIEW_LOADING':
      return { ...state, previewLoading: action.payload };
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
    previewLoading: false,
    selectedId: null,
    selectedQuality: "720p30",
    withAudio: true,
    devices: [],
  });

  const invokeRef = useRef<((cmd: string, args?: any) => Promise<any>) | null>(null);
  const [invokeReady, setInvokeReady] = useState(!isDesktop());
  const requestedThumbnailsRef = useRef<Set<string>>(new Set());
  const previewBatchKeyRef = useRef<string | null>(null);
  const thumbnailBatchTokenRef = useRef(0);
  const pickerOpenedAtRef = useRef<number | null>(null);

  // Load the invoke function once
  useEffect(() => {
    if (isDesktop()) {
      import("@tauri-apps/api/core")
        .then(mod => {
          invokeRef.current = mod.invoke;
          setInvokeReady(true);
        })
        .catch((error) => {
          log.error("Failed to load desktop invoke bridge:", error);
          dispatch({ type: 'SET_LOADING', payload: false });
        });
    }
  }, []);

  // Load sources (fast metadata only; thumbnails are loaded in a throttled batch)
  const loadSources = useCallback(async (isInitial = false) => {
    if (!invokeRef.current) {
      if (isInitial) dispatch({ type: 'SET_LOADING', payload: false });
      return [];
    }
    if (isInitial) dispatch({ type: 'SET_LOADING', payload: true });
    const startedAt = performance.now();
    try {
      const result = await invokeRef.current("get_screen_sources") as ScreenSource[];
      dispatch({ type: 'SET_SOURCES', payload: result, isInitial });
      logScreenPicker("Sources loaded", {
        elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
        queryElapsedMs: Math.round(performance.now() - startedAt),
        isInitial,
        monitorCount: result.filter((source) => source.kind === "monitor").length,
        windowCount: result.filter((source) => source.kind === "window").length,
      });
      return result;
    } catch (err) {
      logScreenPicker("Failed to load sources", {
        elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
        queryElapsedMs: Math.round(performance.now() - startedAt),
        error: err,
      });
      return [];
    } finally {
      if (isInitial) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  // Load a single thumbnail asynchronously
  const loadThumbnail = useCallback(async (sourceId: string) => {
    if (!invokeRef.current) return null;
    if (requestedThumbnailsRef.current.has(sourceId)) return null;
    requestedThumbnailsRef.current.add(sourceId);
    const startedAt = performance.now();
    try {
      const thumb = await invokeRef.current("get_source_thumbnail", { sourceId }) as string;
      logScreenPicker("Thumbnail loaded", {
        elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
        thumbnailElapsedMs: Math.round(performance.now() - startedAt),
        sourceId,
        ok: !!thumb,
      });
      if (thumb) return { sourceId, thumb };
    } catch (err) {
      logScreenPicker("Thumbnail failed", {
        elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
        thumbnailElapsedMs: Math.round(performance.now() - startedAt),
        sourceId,
        error: err,
      });
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
    if (isOpen && invokeReady) {
      pickerOpenedAtRef.current = performance.now();
      thumbnailBatchTokenRef.current += 1;
      requestedThumbnailsRef.current.clear();
      previewBatchKeyRef.current = null;
      logScreenPicker("Opened", { elapsedMs: 0 });
      void loadSources(true);
      void loadDevices();
      dispatch({ type: 'RESET_ON_OPEN' });
    }
  }, [invokeReady, isOpen, loadSources, loadDevices]);

  // On open: load sources + devices
  useEffect(() => {
    handleOpenInit();
  }, [handleOpenInit]);

  useEffect(() => {
    if (isOpen) return;
    thumbnailBatchTokenRef.current += 1;
    dispatch({ type: 'SET_PREVIEW_LOADING', payload: false });
  }, [isOpen]);

  const requestThumbnail = useCallback(async (sourceId: string) => {
    if (state.thumbnails[sourceId]) return;
    const result = await loadThumbnail(sourceId);
    if (result) {
      dispatch({ type: 'SET_THUMBNAILS', payload: { [result.sourceId]: result.thumb } });
    }
  }, [loadThumbnail, state.thumbnails]);

  const requestInitialThumbnails = useCallback(async (sources: ScreenSource[], tab: Tab) => {
    if (!isOpen || !invokeReady || tab === "devices") return;
    const batchToken = thumbnailBatchTokenRef.current;

    const visible = sources.filter(s => tab === "applications" ? s.kind === "window" : s.kind === "monitor");
    if (visible.length === 0) return;

    const missing = visible.filter((source) => !state.thumbnails[source.id]);
    if (missing.length === 0) return;

    dispatch({ type: 'SET_PREVIEW_LOADING', payload: true });

    let loaded = 0;
    const revealAfter = Math.min(missing.length, Math.max(1, Math.ceil(missing.length * 0.4)));
    const concurrency = 1;
    let index = 0;

    const worker = async () => {
      while (index < missing.length && thumbnailBatchTokenRef.current === batchToken) {
        const source = missing[index++];
        const result = await loadThumbnail(source.id);
        loaded += 1;
        if (result && thumbnailBatchTokenRef.current === batchToken) {
          dispatch({ type: 'SET_THUMBNAILS', payload: { [result.sourceId]: result.thumb } });
        }
        if (loaded >= revealAfter && thumbnailBatchTokenRef.current === batchToken) {
          dispatch({ type: 'SET_PREVIEW_LOADING', payload: false });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
    if (thumbnailBatchTokenRef.current !== batchToken) {
      logScreenPicker("Initial thumbnails batch canceled", {
        elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
        tab,
        requestedCount: missing.length,
        loadedCount: loaded,
        revealAfter,
      });
      return;
    }
    dispatch({ type: 'SET_PREVIEW_LOADING', payload: false });
    logScreenPicker("Initial thumbnails batch completed", {
      elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
      tab,
      requestedCount: missing.length,
      loadedCount: loaded,
      revealAfter,
    });
  }, [invokeReady, isOpen, loadThumbnail, state.thumbnails]);

  // Poll metadata at a modest cadence so newly opened/closed windows appear
  // without continuously re-capturing previews.
  useEffect(() => {
    if (!isOpen || !invokeReady) return;
    const sourceInterval = setInterval(() => { void loadSources(false); }, 5000);
    return () => clearInterval(sourceInterval);
  }, [invokeReady, isOpen, loadSources]);

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

  useEffect(function loadSelectedThumbnail() {
    if (!isOpen || !invokeReady || state.tab === "devices" || !state.selectedId) return;
    void requestThumbnail(state.selectedId);
  }, [invokeReady, isOpen, requestThumbnail, state.selectedId, state.tab]);

  useEffect(function loadInitialVisibleThumbnails() {
    if (!isOpen || !invokeReady || state.loading || state.tab === "devices" || state.sources.length === 0) return;
    const visibleSourceIds = state.sources
      .filter(s => state.tab === "applications" ? s.kind === "window" : s.kind === "monitor")
      .map((source) => source.id)
      .join(",");
    const batchKey = `${state.tab}:${visibleSourceIds}`;
    if (previewBatchKeyRef.current === batchKey) return;
    previewBatchKeyRef.current = batchKey;
    void requestInitialThumbnails(state.sources, state.tab);
  }, [invokeReady, isOpen, requestInitialThumbnails, state.loading, state.sources, state.tab]);

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

  const selectSource = (id: string) => {
    logScreenPicker("Selected source", {
      elapsedMs: pickerOpenedAtRef.current ? Math.round(performance.now() - pickerOpenedAtRef.current) : null,
      tab: state.tab,
      sourceId: id,
    });
    dispatch({ type: 'SET_SELECTED_ID', payload: id });
  };

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
            <DeviceGrid devices={state.devices} selectedId={state.selectedId} onSelect={selectSource} />
          ) : state.loading || state.previewLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 size={32} className="animate-spin text-rm-text-muted" />
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-rm-text-muted">
              <Monitor size={40} className="opacity-30" />
              <p className="text-sm">No {state.tab === "applications" ? "applications" : "screens"} found</p>
            </div>
          ) : (
            <SourceGrid
              sources={filteredSources}
              thumbnails={state.thumbnails}
              selectedId={state.selectedId}
              onSelect={selectSource}
              onPreview={(id) => { void requestThumbnail(id); }}
            />
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
            thumbnailBatchTokenRef.current += 1;
            dispatch({ type: 'SET_PREVIEW_LOADING', payload: false });
            const source = state.sources.find((s) => s.id === state.selectedId);
            const pickerSelectionElapsedMs = pickerOpenedAtRef.current
              ? Math.round(performance.now() - pickerOpenedAtRef.current)
              : undefined;
            logScreenPicker("Starting selected source", {
              elapsedMs: pickerSelectionElapsedMs ?? null,
              tab: state.tab,
              sourceId: state.selectedId,
              captureId: source?.capture_id,
              sourceName: source?.name ?? selectedDevice?.label,
              sourceKind: state.tab === "devices" ? "device" : source?.kind,
              quality: state.selectedQuality,
              withAudio: state.withAudio,
            });
            onStart({
              quality: state.selectedQuality,
              withAudio: state.withAudio,
              sourceId: state.selectedId,
              captureId: source?.capture_id,
              sourceName: source?.name ?? selectedDevice?.label,
              sourceKind: state.tab === "devices" ? "device" : source?.kind,
              pickerOpenedAt: pickerOpenedAtRef.current ?? undefined,
              pickerSelectionElapsedMs,
            });
          }}
          selectedId={state.selectedId}
        />
      </div>
    </div>
    </BaseModal>
  );
};

