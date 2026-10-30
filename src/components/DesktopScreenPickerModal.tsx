import {
  ScreenSharePickerFooter,
  ScreenSharePickerShell,
} from "@/components/ScreenSharePickerShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { tabId } from "@/components/ui/tabs";
import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import type { StartScreenShareOptions } from "@/lib/screen-share-types";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type MediaDeviceSource,
  type ScreenSource,
  type Tab,
  DesktopScreenPickerTabBar,
  DeviceGrid,
  PickerEmpty,
  SCREEN_PICKER_PANEL_ID,
  SCREEN_PICKER_TABS_ID,
  SourceGrid,
} from "./DesktopScreenPickerUI";
import { shouldIgnoreSelectDismiss } from "@/components/ui/select-dismiss";

export interface DesktopScreenPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StartScreenShareOptions) => void;
  availableQualities: string[];
  /**
   * The Tauri command bridge. Defaults to `@tauri-apps/api/core` in the
   * desktop app; fixtures and tests pass a stub.
   */
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
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
  | { type: "SET_TAB"; payload: Tab }
  | { type: "SET_SOURCES"; payload: ScreenSource[]; isInitial: boolean }
  | { type: "SET_THUMBNAILS"; payload: Record<string, string> }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_PREVIEW_LOADING"; payload: boolean }
  | { type: "SET_SELECTED_ID"; payload: string | null }
  | { type: "SET_QUALITY"; payload: string }
  | { type: "TOGGLE_AUDIO" }
  | { type: "SET_DEVICES"; payload: MediaDeviceSource[] }
  | {
      type: "RESET_ON_OPEN";
      payload: { selectedQuality: string; withAudio: boolean };
    };

const log = clog("ScreenPicker");

/** The last tab you shared from, remembered per device. */
const LAST_TAB_KEY = "rm-screen-picker-tab";

function readLastTab(): Tab {
  try {
    const stored = localStorage.getItem(LAST_TAB_KEY);
    if (
      stored === "applications" ||
      stored === "screens" ||
      stored === "devices"
    ) {
      return stored;
    }
  } catch {
    /* storage unavailable */
  }
  return "applications";
}

function rememberTab(tab: Tab) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    /* storage unavailable */
  }
}

function logScreenPicker(message: string, details?: unknown) {
  if (details === undefined) {
    log.info(message);
    return;
  }
  try {
    log.info(
      `${message} ${JSON.stringify(details, (_key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        return value;
      })}`,
    );
  } catch {
    log.info(message, details);
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, tab: action.payload };
    case "SET_SOURCES":
      return {
        ...state,
        sources: action.payload,
        thumbnails: action.isInitial ? {} : state.thumbnails,
      };
    case "SET_THUMBNAILS":
      return {
        ...state,
        thumbnails: { ...state.thumbnails, ...action.payload },
      };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_PREVIEW_LOADING":
      return { ...state, previewLoading: action.payload };
    case "SET_SELECTED_ID":
      return { ...state, selectedId: action.payload };
    case "SET_QUALITY":
      return { ...state, selectedQuality: action.payload };
    case "TOGGLE_AUDIO":
      return { ...state, withAudio: !state.withAudio };
    case "SET_DEVICES":
      return { ...state, devices: action.payload };
    case "RESET_ON_OPEN":
      return {
        ...state,
        selectedId: null,
        thumbnails: {},
        selectedQuality: action.payload.selectedQuality,
        withAudio: action.payload.withAudio,
      };
    default:
      return state;
  }
}

export const DesktopScreenPickerModal: React.FC<
  DesktopScreenPickerModalProps
> = ({ isOpen, onClose, onStart, availableQualities, invoke }) => {
  const settings = useVoiceSettingsStore((s) => s.getSettings());
  const setScreenShareDefaults = useVoiceSettingsStore(
    (s) => s.setScreenShareDefaults,
  );
  const initialQuality = availableQualities.includes(
    settings.screenShareQuality,
  )
    ? settings.screenShareQuality
    : (availableQualities[0] ?? "720p30");
  const [state, dispatch] = useReducer(
    reducer,
    null,
    (): State => ({
      tab: readLastTab(),
      sources: [],
      thumbnails: {},
      loading: true,
      previewLoading: false,
      selectedId: null,
      selectedQuality: initialQuality,
      withAudio: settings.screenShareWithAudio,
      devices: [],
    }),
  );
  const setTab = (tab: Tab) => {
    rememberTab(tab);
    dispatch({ type: "SET_TAB", payload: tab });
  };

  const invokeRef = useRef<((cmd: string, args?: any) => Promise<any>) | null>(
    invoke ?? null,
  );
  const [invokeReady, setInvokeReady] = useState(
    Boolean(invoke) || !isDesktop(),
  );
  const requestedThumbnailsRef = useRef<Set<string> | null>(null);
  const previewBatchKeyRef = useRef<string | null>(null);
  const thumbnailBatchTokenRef = useRef(0);
  const pickerOpenedAtRef = useRef<number | null>(null);
  const getRequestedThumbnails = useCallback(() => {
    if (!requestedThumbnailsRef.current) {
      requestedThumbnailsRef.current = new Set<string>();
    }
    return requestedThumbnailsRef.current;
  }, []);

  // Load the invoke function once
  useEffect(() => {
    if (!invokeRef.current && isDesktop()) {
      import("@tauri-apps/api/core")
        .then((mod) => {
          invokeRef.current = mod.invoke;
          setInvokeReady(true);
        })
        .catch((error) => {
          log.error("Failed to load desktop invoke bridge:", error);
          setInvokeReady(true);
          dispatch({ type: "SET_LOADING", payload: false });
        });
    }
  }, []);

  // Load sources (fast metadata only; thumbnails are loaded in a throttled batch)
  const loadSources = useCallback(async (isInitial = false) => {
    if (!invokeRef.current) {
      if (isInitial) dispatch({ type: "SET_LOADING", payload: false });
      return [];
    }
    if (isInitial) dispatch({ type: "SET_LOADING", payload: true });
    const startedAt = performance.now();
    try {
      const result = (await invokeRef.current(
        "get_screen_sources",
      )) as ScreenSource[];
      dispatch({ type: "SET_SOURCES", payload: result, isInitial });
      logScreenPicker("Sources loaded", {
        elapsedMs: pickerOpenedAtRef.current
          ? Math.round(performance.now() - pickerOpenedAtRef.current)
          : null,
        queryElapsedMs: Math.round(performance.now() - startedAt),
        isInitial,
        monitorCount: result.filter((source) => source.kind === "monitor")
          .length,
        windowCount: result.filter((source) => source.kind === "window").length,
      });
      return result;
    } catch (err) {
      logScreenPicker("Failed to load sources", {
        elapsedMs: pickerOpenedAtRef.current
          ? Math.round(performance.now() - pickerOpenedAtRef.current)
          : null,
        queryElapsedMs: Math.round(performance.now() - startedAt),
        error: err,
      });
      return [];
    } finally {
      if (isInitial) dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  // Load a single thumbnail asynchronously
  const loadThumbnail = useCallback(
    async (sourceId: string) => {
      if (!invokeRef.current) return null;
      const requestedThumbnails = getRequestedThumbnails();
      if (requestedThumbnails.has(sourceId)) return null;
      requestedThumbnails.add(sourceId);
      const startedAt = performance.now();
      try {
        const thumb = (await invokeRef.current("get_source_thumbnail", {
          sourceId,
        })) as string;
        logScreenPicker("Thumbnail loaded", {
          elapsedMs: pickerOpenedAtRef.current
            ? Math.round(performance.now() - pickerOpenedAtRef.current)
            : null,
          thumbnailElapsedMs: Math.round(performance.now() - startedAt),
          sourceId,
          ok: !!thumb,
        });
        if (thumb) return { sourceId, thumb };
      } catch (err) {
        logScreenPicker("Thumbnail failed", {
          elapsedMs: pickerOpenedAtRef.current
            ? Math.round(performance.now() - pickerOpenedAtRef.current)
            : null,
          thumbnailElapsedMs: Math.round(performance.now() - startedAt),
          sourceId,
          error: err,
        });
        // silently skip failed thumbnails
      }
      return null;
    },
    [getRequestedThumbnails],
  );

  // Load video input devices for "Devices" tab
  const loadDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs: MediaDeviceSource[] = [];
      for (const device of allDevices) {
        if (device.kind !== "videoinput") continue;
        videoInputs.push({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 6)}`,
        });
      }
      dispatch({ type: "SET_DEVICES", payload: videoInputs });
    } catch {
      dispatch({ type: "SET_DEVICES", payload: [] });
    }
  }, []);

  const handleOpenInit = useCallback(() => {
    if (isOpen && invokeReady) {
      pickerOpenedAtRef.current = performance.now();
      thumbnailBatchTokenRef.current += 1;
      getRequestedThumbnails().clear();
      previewBatchKeyRef.current = null;
      logScreenPicker("Opened", { elapsedMs: 0 });
      void loadSources(true);
      void loadDevices();
      dispatch({
        type: "RESET_ON_OPEN",
        payload: {
          selectedQuality: initialQuality,
          withAudio: settings.screenShareWithAudio,
        },
      });
    }
  }, [
    getRequestedThumbnails,
    initialQuality,
    invokeReady,
    isOpen,
    loadDevices,
    loadSources,
    settings.screenShareWithAudio,
  ]);

  // On open: load sources + devices
  useEffect(() => {
    handleOpenInit();
  }, [handleOpenInit]);

  useEffect(() => {
    if (isOpen) return;
    thumbnailBatchTokenRef.current += 1;
    dispatch({ type: "SET_PREVIEW_LOADING", payload: false });
  }, [isOpen]);

  const requestThumbnail = useCallback(
    async (sourceId: string) => {
      if (state.thumbnails[sourceId]) return;
      const result = await loadThumbnail(sourceId);
      if (result) {
        dispatch({
          type: "SET_THUMBNAILS",
          payload: { [result.sourceId]: result.thumb },
        });
      }
    },
    [loadThumbnail, state.thumbnails],
  );

  const requestInitialThumbnails = useCallback(
    (sources: ScreenSource[], tab: Tab) => {
      if (!isOpen || !invokeReady || tab === "devices") return;
      const batchToken = thumbnailBatchTokenRef.current;

      const visible = sources.filter((s) =>
        tab === "applications" ? s.kind === "window" : s.kind === "monitor",
      );
      if (visible.length === 0) return;

      const missing = visible.filter((source) => !state.thumbnails[source.id]);
      if (missing.length === 0) return;

      dispatch({ type: "SET_PREVIEW_LOADING", payload: true });

      let loaded = 0;
      const revealAfter = Math.min(
        missing.length,
        Math.max(1, Math.ceil(missing.length * 0.4)),
      );
      const concurrency = 1;
      let index = 0;

      const worker = async (): Promise<void> => {
        if (
          index >= missing.length ||
          thumbnailBatchTokenRef.current !== batchToken
        ) {
          return;
        }
        const source = missing[index++];
        const result = await loadThumbnail(source.id);
        loaded += 1;
        if (result && thumbnailBatchTokenRef.current === batchToken) {
          dispatch({
            type: "SET_THUMBNAILS",
            payload: { [result.sourceId]: result.thumb },
          });
        }
        if (
          loaded >= revealAfter &&
          thumbnailBatchTokenRef.current === batchToken
        ) {
          dispatch({ type: "SET_PREVIEW_LOADING", payload: false });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        return worker();
      };

      return Promise.all(
        Array.from({ length: Math.min(concurrency, missing.length) }, () =>
          worker(),
        ),
      ).then(() => {
        if (thumbnailBatchTokenRef.current !== batchToken) {
          logScreenPicker("Initial thumbnails batch canceled", {
            elapsedMs: pickerOpenedAtRef.current
              ? Math.round(performance.now() - pickerOpenedAtRef.current)
              : null,
            tab,
            requestedCount: missing.length,
            loadedCount: loaded,
            revealAfter,
          });
          return;
        }
        dispatch({ type: "SET_PREVIEW_LOADING", payload: false });
        logScreenPicker("Initial thumbnails batch completed", {
          elapsedMs: pickerOpenedAtRef.current
            ? Math.round(performance.now() - pickerOpenedAtRef.current)
            : null,
          tab,
          requestedCount: missing.length,
          loadedCount: loaded,
          revealAfter,
        });
      });
    },
    [invokeReady, isOpen, loadThumbnail, state.thumbnails],
  );

  // Poll metadata at a modest cadence so newly opened/closed windows appear
  // without continuously re-capturing previews.
  useEffect(() => {
    if (!isOpen || !invokeReady) return;
    const sourceInterval = setInterval(() => {
      void loadSources(false);
    }, 5000);
    return () => clearInterval(sourceInterval);
  }, [invokeReady, isOpen, loadSources]);

  // When tab changes or selected item disappears, auto-select first source
  // When tab changes or selected item disappears, auto-select first source
  useEffect(
    function autoSelectSource() {
      if (state.tab === "devices") {
        if (
          !state.selectedId ||
          !state.devices.some((d) => d.deviceId === state.selectedId)
        ) {
          dispatch({
            type: "SET_SELECTED_ID",
            payload:
              state.devices.length > 0 ? state.devices[0].deviceId : null,
          });
        }
        return;
      }
      const tabSources = state.sources.filter((s) =>
        state.tab === "applications"
          ? s.kind === "window"
          : s.kind === "monitor",
      );
      // Only auto-select if no current selection or selected item is gone
      const selectionStillExists =
        state.selectedId && tabSources.some((s) => s.id === state.selectedId);
      if (!selectionStillExists) {
        dispatch({
          type: "SET_SELECTED_ID",
          payload: tabSources.length > 0 ? tabSources[0].id : null,
        });
      }
    },
    [state.tab, state.sources, state.devices, state.selectedId],
  );

  useEffect(
    function loadSelectedThumbnail() {
      if (
        !isOpen ||
        !invokeReady ||
        state.tab === "devices" ||
        !state.selectedId
      )
        return;
      void requestThumbnail(state.selectedId);
    },
    [invokeReady, isOpen, requestThumbnail, state.selectedId, state.tab],
  );

  useEffect(
    function loadInitialVisibleThumbnails() {
      if (
        !isOpen ||
        !invokeReady ||
        state.loading ||
        state.tab === "devices" ||
        state.sources.length === 0
      )
        return;
      const visibleSourceIds: string[] = [];
      for (const source of state.sources) {
        const isVisible =
          state.tab === "applications"
            ? source.kind === "window"
            : source.kind === "monitor";
        if (isVisible) {
          visibleSourceIds.push(source.id);
        }
      }
      const batchKey = `${state.tab}:${visibleSourceIds}`;
      if (previewBatchKeyRef.current === batchKey) return;
      previewBatchKeyRef.current = batchKey;
      void requestInitialThumbnails(state.sources, state.tab);
    },
    [
      invokeReady,
      isOpen,
      requestInitialThumbnails,
      state.loading,
      state.sources,
      state.tab,
    ],
  );

  const filteredSources =
    state.tab === "devices"
      ? []
      : state.sources.filter((s) =>
          state.tab === "applications"
            ? s.kind === "window"
            : s.kind === "monitor",
        );

  const selectedSource = state.sources.find((s) => s.id === state.selectedId);
  const selectedDevice = state.devices.find(
    (d) => d.deviceId === state.selectedId,
  );
  const pickedName =
    state.tab === "devices" ? selectedDevice?.label : selectedSource?.name;
  const displayName =
    pickedName ||
    (state.tab === "devices" ? "Select a device" : "Select a source");

  const selectSource = (id: string) => {
    logScreenPicker("Selected source", {
      elapsedMs: pickerOpenedAtRef.current
        ? Math.round(performance.now() - pickerOpenedAtRef.current)
        : null,
      tab: state.tab,
      sourceId: id,
    });
    dispatch({ type: "SET_SELECTED_ID", payload: id });
  };

  const ignoreSelectDismiss = (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => {
    if (shouldIgnoreSelectDismiss(event.target)) event.preventDefault();
  };

  const startShare = () => {
    if (!state.selectedId) return;
    thumbnailBatchTokenRef.current += 1;
    dispatch({ type: "SET_PREVIEW_LOADING", payload: false });
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
    setScreenShareDefaults({
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
      sourceAppName: source?.app_name,
      sourceIcon: source?.icon || undefined,
      pickerOpenedAt: pickerOpenedAtRef.current ?? undefined,
      pickerSelectionElapsedMs,
    });
  };

  return (
    <ScreenSharePickerShell
      open={isOpen}
      onClose={onClose}
      description="Pick an app, a screen or a capture device."
      contentProps={{
        "aria-busy": !invokeReady || state.loading || state.previewLoading,
        onPointerDownOutside: ignoreSelectDismiss,
        onFocusOutside: ignoreSelectDismiss,
        onInteractOutside: ignoreSelectDismiss,
      }}
      tabs={<DesktopScreenPickerTabBar tab={state.tab} setTab={setTab} />}
      sourceProps={{
        role: "tabpanel",
        id: SCREEN_PICKER_PANEL_ID,
        "aria-labelledby": tabId(SCREEN_PICKER_TABS_ID, state.tab),
      }}
      footer={
        <ScreenSharePickerFooter
          quality={state.selectedQuality}
          onQualityChange={(q) => dispatch({ type: "SET_QUALITY", payload: q })}
          availableQualities={availableQualities}
          withAudio={state.withAudio}
          onWithAudioChange={() => dispatch({ type: "TOGGLE_AUDIO" })}
          sourceName={displayName}
          sourcePicked={Boolean(pickedName)}
          onClose={onClose}
          onStart={startShare}
          startDisabled={!state.selectedId}
        />
      }
    >
      {state.tab === "devices" ? (
        <DeviceGrid
          devices={state.devices}
          selectedId={state.selectedId}
          onSelect={selectSource}
        />
      ) : state.loading || state.previewLoading ? (
        <EmptyState
          loading
          motif="screen"
          size="sm"
          className="h-full min-h-40"
          title="Finding what you can share"
        />
      ) : filteredSources.length === 0 ? (
        state.tab === "applications" ? (
          <PickerEmpty
            title="No open apps to share"
            body="Open the app you want to share, or share an entire screen instead."
            action={
              <Button variant="secondary" onClick={() => setTab("screens")}>
                Share entire screen
              </Button>
            }
          />
        ) : (
          <PickerEmpty title="No screens found" />
        )
      ) : (
        <SourceGrid
          sources={filteredSources}
          thumbnails={state.thumbnails}
          selectedId={state.selectedId}
          onSelect={selectSource}
          onPreview={(id) => {
            void requestThumbnail(id);
          }}
        />
      )}
    </ScreenSharePickerShell>
  );
};
