import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { VoiceDetailsPanel } from "@/components/voice/VoiceDetailsPanel";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import type { GridItem } from "@/components/voice/types";
import { useMounted } from "@/hooks/useMounted";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import type { SFUClient } from "@/lib/sfu-client";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { FloatingListenTogetherPlayer } from "./FloatingListenTogetherPlayer";
import { FloatingSoundboardManager } from "./FloatingSoundboardManager";
import { Icon } from "@/components/ui/icon";
import { NoiseReductionPanel } from "./NoiseReductionPanel";
import { SpatialAudioPanel } from "./SpatialAudioPanel";

/* Quiet Pro: compact dock row in the sidebar voice panel. Rest = neutral
 * tint; live (camera / screen share on) = the only accent fill; open
 * pickers = stronger neutral tint. */
const ACTION_BTN = cn(
  PRESS,
  HIT,
  DISABLED,
  "group flex h-8 items-center justify-center rounded-md outline-none",
);
const ACTION_REST = "bg-rm-tint-1 text-rm-text";
const ACTION_OPEN = "bg-rm-tint-3 text-rm-text";
const ACTION_LIVE = "bg-rm-accent-tint text-rm-accent-ink [--hover-o:0.12]";
const HEADER_ICON_BTN = cn(
  PRESS,
  HIT,
  "group relative z-10 flex size-8 items-center justify-center rounded-md text-rm-text-secondary outline-none pointer-fine:hover:text-rm-text",
);

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));
const SoundboardPicker = lazy(
  () => import("@/components/chat/SoundboardPicker"),
);

const EMPTY_QUALITIES: string[] = [];
const EMPTY_GRID_ITEMS: GridItem[] = [];
const EMPTY_WATCHERS_BY_STREAMER: StreamWatchersByStreamer = {};
const NOISE_REDUCTION_PANEL_GAP = 8;
const NOISE_REDUCTION_VIEWPORT_PADDING = 12;

function formatScreenQualityBadge(quality?: string) {
  if (!quality) return null;
  const fourKMatch = quality.match(/^4k(\d+)$/i);
  if (fourKMatch) {
    return `4K · ${fourKMatch[1]} FPS`;
  }
  const standardMatch = quality.match(/^(\d+)p(\d+)$/i);
  if (standardMatch) {
    return `${standardMatch[1]}p · ${standardMatch[2]} FPS`;
  }
  return quality.toUpperCase();
}

interface VoiceDashboardProps {
  serverName: string;
  voiceChannelName?: string;
  onVoiceDisconnect?: () => void;
  onVoiceNavigate?: () => void;
  isScreenSharing?: boolean;
  isStreamingAudio?: boolean;
  screenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  availableQualities?: string[];
  onShareScreen?: () => void;
  onStopStreaming?: () => void;
  onToggleStreamAudio?: () => void;
  onChangeStreamSource?: () => void;
  onStreamQualityChange?: (quality: string) => void;
  isCameraActive?: boolean;
  hasCamera?: boolean;
  hasMicrophone?: boolean;
  onToggleCamera?: () => void;
  sfu?: SFUClient | null;
  voiceChannelId?: string | null;
  gridItems?: GridItem[];
  watchersByStreamer?: StreamWatchersByStreamer;
  spatialAudioState?: SharedSpatialAudioState;
  onUpdateSpatialAudioState?: (state: SharedSpatialAudioState) => void;
  participantCapabilities?: Record<
    string,
    { enabled?: boolean; highFidelity?: boolean }
  >;
  onOpenVoiceSettings?: () => void;
  voiceSettingsUserId?: string;
  localUserId?: string | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  serverId?: string | null;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
  showNoiseReductionShortcut?: boolean;
}

export function VoiceDashboard({
  serverName,
  voiceChannelName,
  onVoiceDisconnect,
  onVoiceNavigate,
  isScreenSharing,
  isStreamingAudio,
  screenQuality,
  currentScreenSource,
  availableQualities = EMPTY_QUALITIES,
  onShareScreen,
  onStopStreaming,
  onToggleStreamAudio,
  onChangeStreamSource,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone: _hasMicrophone,
  onToggleCamera,
  sfu = null,
  voiceChannelId,
  gridItems = EMPTY_GRID_ITEMS,
  watchersByStreamer = EMPTY_WATCHERS_BY_STREAMER,
  spatialAudioState,
  onUpdateSpatialAudioState,
  participantCapabilities,
  onOpenVoiceSettings,
  voiceSettingsUserId,
  localUserId,
  roomSlug,
  voiceSessionId,
  serverId,
  onOpenActivities,
  onOpenSoundboard,
  showNoiseReductionShortcut = true,
}: VoiceDashboardProps) {
  const mounted = useMounted();
  const [isStreamMenuOpen, setIsStreamMenuOpen] = useState(false);
  const shouldRenderStreamMenu = isStreamMenuOpen;
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVoiceDetailsOpen, setIsVoiceDetailsOpen] = useState(false);
  const [isSpatialOpen, setIsSpatialOpen] = useState(false);
  const shouldRenderSpatial = isSpatialOpen;
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const shouldRenderStickerPicker = isStickerPickerOpen;
  const [isSoundboardPickerOpen, setIsSoundboardPickerOpen] = useState(false);
  const [soundboardInitialView, setSoundboardInitialView] = useState<
    "soundboard" | "listenTogether"
  >("soundboard");
  const [isNoiseReductionOpen, setIsNoiseReductionOpen] = useState(false);
  const shouldRenderNoiseReduction = isNoiseReductionOpen;
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);
  const noiseReductionBtnRef = useRef<HTMLButtonElement>(null);
  const noiseReductionPanelRef = useRef<HTMLDivElement>(null);
  const [noiseReductionPanelPosition, setNoiseReductionPanelPosition] =
    useState({
      top: 0,
      left: 0,
      placement: "bottom" as "top" | "bottom",
    });

  const stats = useVoiceStats(sfu, true);
  const signalBtnRef = useRef<HTMLButtonElement>(null);
  const spatialBtnRef = useRef<HTMLButtonElement>(null);
  const settings = useVoiceSettingsStore((s) =>
    s.getSettings(voiceSettingsUserId),
  );
  const updateVoiceSettings = useVoiceSettingsStore(
    (s) => s.updateVoiceSettings,
  );
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const localStreamWatchers = localUserId
    ? (watchersByStreamer[localUserId] ?? [])
    : [];
  const streamQualityBadge = formatScreenQualityBadge(screenQuality);
  const hasSpecificStreamSource = !!(
    currentScreenSource?.sourceName?.trim() ||
    currentScreenSource?.sourceAppName?.trim() ||
    currentScreenSource?.sourceIcon?.trim() ||
    currentScreenSource?.sourceKind
  );
  const streamSourceKind = currentScreenSource?.sourceKind ?? null;
  const streamSourceTitle =
    currentScreenSource?.sourceName?.trim() ||
    (streamSourceKind === "window"
      ? "Streaming an application"
      : streamSourceKind === "device"
        ? "Streaming a capture device"
        : "Streaming your screen");
  const streamSourceLabel =
    streamSourceKind === "window"
      ? "Application"
      : streamSourceKind === "device"
        ? "Capture Device"
        : hasSpecificStreamSource
          ? "Entire Screen"
          : "Screen";
  const streamSourceSubtitle =
    streamSourceKind === "window"
      ? currentScreenSource?.sourceAppName?.trim() ||
        "Selected application window"
      : streamSourceKind === "device"
        ? "Capture device source"
        : hasSpecificStreamSource
          ? "Selected display"
          : "Your screen share is active";
  const streamSourceIcon = currentScreenSource?.sourceIcon?.trim() || null;
  const alwaysShowStreamPreview = !!settings.alwaysShowStreamPreview;
  const gifPickerVoiceMode = useMemo(() => (sfu ? { sfu } : null), [sfu]);
  const toggleSoundboardPicker = () => {
    onOpenSoundboard?.();
    setSoundboardInitialView("soundboard");
    setIsSoundboardPickerOpen((value) => !value);
  };
  const openListenTogetherPicker = () => {
    onOpenSoundboard?.();
    setSoundboardInitialView("listenTogether");
    setIsSoundboardPickerOpen(true);
  };

  useLayoutEffect(() => {
    if (
      !shouldRenderNoiseReduction ||
      !noiseReductionBtnRef.current ||
      !noiseReductionPanelRef.current
    ) {
      return;
    }

    const updateNoiseReductionPosition = () => {
      const anchorRect = noiseReductionBtnRef.current?.getBoundingClientRect();
      const panelRect = noiseReductionPanelRef.current?.getBoundingClientRect();

      if (!anchorRect || !panelRect) return;

      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      let left = anchorCenterX - panelRect.width / 2;
      left = Math.min(
        Math.max(NOISE_REDUCTION_VIEWPORT_PADDING, left),
        window.innerWidth - panelRect.width - NOISE_REDUCTION_VIEWPORT_PADDING,
      );

      const spaceAbove = anchorRect.top - NOISE_REDUCTION_VIEWPORT_PADDING;
      const spaceBelow =
        window.innerHeight -
        anchorRect.bottom -
        NOISE_REDUCTION_VIEWPORT_PADDING;
      const openAbove =
        spaceAbove >= panelRect.height + NOISE_REDUCTION_PANEL_GAP ||
        spaceAbove >= spaceBelow;

      let top = openAbove
        ? anchorRect.top - panelRect.height - NOISE_REDUCTION_PANEL_GAP
        : anchorRect.bottom + NOISE_REDUCTION_PANEL_GAP;

      top = Math.min(
        Math.max(NOISE_REDUCTION_VIEWPORT_PADDING, top),
        window.innerHeight -
          panelRect.height -
          NOISE_REDUCTION_VIEWPORT_PADDING,
      );

      setNoiseReductionPanelPosition({
        top,
        left,
        placement: openAbove ? "top" : "bottom",
      });
    };

    updateNoiseReductionPosition();
    window.addEventListener("resize", updateNoiseReductionPosition);
    window.addEventListener("scroll", updateNoiseReductionPosition, true);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateNoiseReductionPosition())
        : null;
    if (resizeObserver && noiseReductionPanelRef.current) {
      resizeObserver.observe(noiseReductionPanelRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateNoiseReductionPosition);
      window.removeEventListener("scroll", updateNoiseReductionPosition, true);
      resizeObserver?.disconnect();
    };
  }, [shouldRenderNoiseReduction]);

  useEffect(() => {
    if (!shouldRenderNoiseReduction) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNoiseReductionOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [shouldRenderNoiseReduction]);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="animate-in slide-in-from-bottom-5 duration-300 border-b-0 rounded-b-none">
        <FloatingListenTogetherPlayer
          sfu={sfu}
          roomSlug={roomSlug}
          onOpenQueue={openListenTogetherPicker}
        />
        <FloatingSoundboardManager
          serverId={serverId}
          localUserId={localUserId}
          sfu={sfu}
        />

        <div className="p-2 space-y-2">
          {/* VOICE CONNECTED HEADER */}
          <div className="group/voice-status mx-1 flex items-center gap-2 rounded-lg px-1.5 py-1">
            <div className="flex shrink-0 items-center">
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      ref={signalBtnRef}
                      onClick={() => setIsVoiceDetailsOpen(!isVoiceDetailsOpen)}
                      aria-label="Voice connection details"
                      aria-expanded={isVoiceDetailsOpen}
                      className={cn(
                        PRESS,
                        HIT,
                        "flex size-8 shrink-0 items-center justify-center rounded-md bg-rm-tint-1 text-rm-success-ink outline-none",
                      )}
                    >
                      <Icon name="signal" size="md" className="animate-pulse" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12}>
                    <p className="flex items-center gap-1.5">
                      {stats ? (
                        `Latency: ${stats.ping} ms`
                      ) : (
                        <>
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-rm-success animate-pulse" />
                          Connectingâ€¦
                        </>
                      )}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <VoiceDetailsPanel
                  sfu={sfu}
                  isOpen={isVoiceDetailsOpen}
                  onClose={() => setIsVoiceDetailsOpen(false)}
                  triggerRef={signalBtnRef}
                  channelName={voiceChannelName}
                />
              </div>
            </div>
            <button
              type="button"
              className={cn(
                PRESS,
                "min-w-0 flex-1 rounded-md px-1.5 py-1 text-left outline-none [--hover-o:0.05]",
              )}
              onClick={onVoiceNavigate}
              aria-label="Open voice channel details"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-ui-sm font-semibold leading-tight text-rm-success-ink">
                  Voice Connected
                </span>
                <span className="text-ui-xs font-medium text-rm-text-muted truncate max-w-[140px]">
                  <InlineEmojiText
                    text={`${voiceChannelName || "General"} / ${serverName}`}
                  />
                </span>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              {spatialAudioState && onUpdateSpatialAudioState && (
                <div className="relative">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        ref={spatialBtnRef}
                        onClick={() => setIsSpatialOpen((value) => !value)}
                        aria-label="Spatial Audio"
                        aria-expanded={isSpatialOpen}
                        className={cn(
                          HEADER_ICON_BTN,
                          spatialAudioState.enabled &&
                            settings.spatialAudioEnabled &&
                            settings.streamHighFidelity &&
                            "bg-rm-accent-tint text-rm-accent-ink",
                        )}
                      >
                        <Icon name="sparkle" size="md" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={12}>
                      <p>Spatial Audio</p>
                    </TooltipContent>
                  </Tooltip>
                  {shouldRenderSpatial && (
                    <SpatialAudioPanel
                      isOpen={isSpatialOpen}
                      isClosing={!isSpatialOpen}
                      anchorRef={spatialBtnRef}
                      gridItems={gridItems}
                      spatialAudioState={spatialAudioState}
                      onUpdateSpatialAudioState={onUpdateSpatialAudioState}
                      localSpatialEnabled={settings.spatialAudioEnabled}
                      localHighFidelity={settings.streamHighFidelity}
                      localUserId={localUserId}
                      participantCapabilities={participantCapabilities}
                      onLocalSpatialEnabledChange={(enabled) => {
                        updateVoiceSettings(
                          (current) => ({
                            ...current,
                            spatialAudioEnabled: enabled,
                            streamHighFidelity: enabled
                              ? true
                              : current.streamHighFidelity,
                            echoCancellation: enabled
                              ? false
                              : current.echoCancellation,
                            noiseSuppression: enabled
                              ? false
                              : current.noiseSuppression,
                          }),
                          voiceSettingsUserId,
                        );
                      }}
                      onOpenVoiceSettings={() => {
                        setIsSpatialOpen(false);
                        onOpenVoiceSettings?.();
                      }}
                      onClose={() => setIsSpatialOpen(false)}
                    />
                  )}
                </div>
              )}
              {showNoiseReductionShortcut && (
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        ref={noiseReductionBtnRef}
                        onClick={() =>
                          setIsNoiseReductionOpen((value) => !value)
                        }
                        aria-label="Noise Suppression"
                        className={cn(
                          HEADER_ICON_BTN,
                          settings.noiseReductionEnabled &&
                            "bg-rm-accent-tint text-rm-accent-ink",
                        )}
                        aria-expanded={isNoiseReductionOpen}
                        aria-haspopup="dialog"
                      >
                        <span className="relative flex items-center justify-center">
                          <Icon
                            name="speaking"
                            size="md"
                            className="group-hover:animate-wiggle"
                          />
                          {!settings.noiseReductionEnabled && (
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="absolute h-0.5 w-5 -rotate-45 rounded-full bg-current" />
                            </span>
                          )}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={12}>
                      <p>Noise Suppression</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onVoiceDisconnect?.()}
                    aria-label="Disconnect"
                    className={cn(
                      HEADER_ICON_BTN,
                      "pointer-fine:hover:text-rm-danger-ink",
                    )}
                  >
                    <Icon
                      name="disconnect"
                      size="lg"
                      className="group-hover:animate-wiggle"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12}>
                  <p>Disconnect</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {shouldRenderNoiseReduction &&
            mounted &&
            createPortal(
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20"
                  aria-label="Close noise suppression panel"
                  onClick={() => setIsNoiseReductionOpen(false)}
                />
                <div
                  ref={noiseReductionPanelRef}
                  className={cn(
                    "fixed z-30 w-[min(340px,calc(100vw-1.5rem))]",
                    noiseReductionPanelPosition.placement === "top"
                      ? !isNoiseReductionOpen
                        ? "origin-bottom animate-out fade-out slide-out-to-bottom-2 zoom-out-95 duration-200"
                        : "origin-bottom animate-in fade-in slide-in-from-bottom-2 duration-200"
                      : !isNoiseReductionOpen
                        ? "origin-top animate-out fade-out slide-out-to-top-2 zoom-out-95 duration-200"
                        : "origin-top animate-in fade-in slide-in-from-top-2 duration-200",
                  )}
                  style={{
                    top: noiseReductionPanelPosition.top,
                    left: noiseReductionPanelPosition.left,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <NoiseReductionPanel
                    settingsUserId={voiceSettingsUserId}
                    compact
                  />
                </div>
              </>,
              document.body,
            )}

          {/* STREAMING STATUS */}
          {isScreenSharing && (
            <div className="bg-rm-bg-elevated/50 rounded-xl p-2.5 border border-rm-border space-y-3 mx-1 mt-1">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rm-accent-tint text-rm-accent-ink overflow-hidden">
                  {streamSourceIcon ? (
                    <img
                      src={streamSourceIcon}
                      alt=""
                      className="h-5 w-5 object-contain"
                      draggable={false}
                    />
                  ) : streamSourceKind === "window" ? (
                    <Icon name="window" size="md" />
                  ) : streamSourceKind === "device" ? (
                    <Icon name="camera" size="md" />
                  ) : (
                    <Icon name="monitor" size="md" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text">
                      {streamSourceLabel}
                    </span>
                    <span className="bg-rm-danger-tint text-ui-2xs font-semibold px-1 rounded-xs text-rm-danger-ink uppercase leading-tight">
                      Live
                    </span>
                    {streamQualityBadge && (
                      <span className="rounded bg-rm-bg-floating/80 px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wide text-rm-text-muted">
                        {streamQualityBadge}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-ui-xs font-semibold text-rm-text">
                    {streamSourceTitle}
                  </p>
                  <p className="truncate text-ui-2xs text-rm-text-muted">
                    {streamSourceSubtitle}
                  </p>
                </div>
              </div>

              {localStreamWatchers.length > 0 && (
                <StreamWatcherList watchers={localStreamWatchers} />
              )}

              <div className="flex gap-1.5 relative">
                <Button
                  type="button"
                  size="sm"
                  onClick={onStopStreaming}
                  className="flex-1"
                >
                  <Icon name="streamOff" size="sm" /> Stop Streaming
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => setIsStreamMenuOpen(!isStreamMenuOpen)}
                    aria-label="Stream settings"
                    aria-expanded={isStreamMenuOpen}
                    className={cn(isStreamMenuOpen && "bg-rm-tint-3")}
                  >
                    <Icon name="more" size="sm" />
                  </Button>

                  {shouldRenderStreamMenu && (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-[60]"
                        aria-label="Close stream settings"
                        onClick={() => setIsStreamMenuOpen(false)}
                      />
                      <div
                        className={cn(
                          "absolute bottom-full right-0 mb-2 w-48 bg-rm-bg-elevated border border-rm-border rounded-xl shadow-2xl p-1.5 z-[70] backdrop-blur-xl origin-bottom-right",
                          !isStreamMenuOpen
                            ? "animate-out fade-out slide-out-to-bottom-2 zoom-out-95 duration-200"
                            : "animate-in fade-in slide-in-from-bottom-2 duration-200",
                        )}
                      >
                        <div className="px-3 py-1.5 border-b border-rm-border mb-1">
                          <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                            Stream Settings
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeStreamSource?.();
                            setIsStreamMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-ui-xs font-medium text-rm-accent-ink pointer-fine:hover:bg-rm-accent-tint rounded-lg transition-colors flex items-center gap-2"
                        >
                          <Icon name="screenShare" size="sm" /> Change Source
                        </button>
                        <div className="h-[1px] bg-rm-border my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            onToggleStreamAudio?.();
                            setIsStreamMenuOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-ui-xs font-medium rounded-lg transition-colors flex items-center justify-between outline-none",
                            isStreamingAudio
                              ? "text-rm-accent-ink pointer-fine:hover:bg-rm-accent-tint"
                              : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-hover",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="voiceChannel" size="sm" /> Stream Audio
                          </span>
                          <div
                            className={cn(
                              "w-2 h-2 rounded-full",
                              isStreamingAudio
                                ? "bg-primary shadow-[0_0_8px_var(--rm-glow)]"
                                : "bg-rm-bg-active",
                            )}
                          />
                        </button>
                        <div className="h-[1px] bg-rm-border my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            updateUserSettings(
                              (current) => ({
                                ...current,
                                alwaysShowStreamPreview:
                                  !current.alwaysShowStreamPreview,
                              }),
                              voiceSettingsUserId,
                            );
                            setIsStreamMenuOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-ui-xs font-medium rounded-lg transition-colors flex items-center justify-between outline-none",
                            alwaysShowStreamPreview
                              ? "text-rm-accent-ink pointer-fine:hover:bg-rm-accent-tint"
                              : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-hover",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="monitor" size="sm" /> Always Show Stream
                            Preview
                          </span>
                          <div
                            className={cn(
                              "w-2 h-2 rounded-full",
                              alwaysShowStreamPreview
                                ? "bg-primary shadow-[0_0_8px_var(--rm-glow)]"
                                : "bg-rm-bg-active",
                            )}
                          />
                        </button>
                        {availableQualities.length > 0 && (
                          <>
                            <div className="h-[1px] bg-rm-border my-1" />
                            <div className="px-3 py-1.5">
                              <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                                Quality
                              </p>
                            </div>
                            <div className="grid grid-cols-1 gap-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                              {availableQualities.map((q) => (
                                <button
                                  key={q}
                                  type="button"
                                  onClick={() => {
                                    onStreamQualityChange?.(q);
                                    setIsStreamMenuOpen(false);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-1.5 text-ui-2xs font-medium rounded-md transition-ui flex items-center justify-between group/q outline-none",
                                    screenQuality === q
                                      ? "bg-rm-accent-tint text-rm-accent-ink"
                                      : "text-rm-text-muted pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text",
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <Icon
                                      name="monitor"
                                      size="xs"
                                      className={cn(
                                        "transition-opacity",
                                        screenQuality === q
                                          ? "opacity-100"
                                          : "opacity-40",
                                      )}
                                    />
                                    {q.replace("p", "p ")}
                                  </div>
                                  {screenQuality === q && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--rm-glow)]" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ACTION BUTTON GRID */}
          <div className="px-3 pt-1 pb-2">
            <div className="flex items-center justify-between gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      void handleVoiceCameraToggle({
                        hasCamera: !!hasCamera,
                        isCameraActive: !!isCameraActive,
                        alwaysPreviewVideo: settings?.alwaysPreviewVideo,
                        onToggleCamera,
                        onOpenPreviewModal: () => setIsCameraModalOpen(true),
                      });
                    }}
                    disabled={!hasCamera}
                    aria-label={
                      !hasCamera
                        ? "No camera detected"
                        : isCameraActive
                          ? "Turn Off Camera"
                          : "Turn On Camera"
                    }
                    aria-pressed={!!isCameraActive}
                    className={cn(
                      ACTION_BTN,
                      "flex-1",
                      isCameraActive ? ACTION_LIVE : ACTION_REST,
                    )}
                  >
                    {isCameraActive ? (
                      <Icon
                        name="camera"
                        state="active"
                        size="md"
                        className="group-hover:animate-wiggle"
                      />
                    ) : (
                      <Icon
                        name="cameraOff"
                        size="md"
                        className="group-hover:animate-wiggle"
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12}>
                  <p>
                    {!hasCamera
                      ? "No camera detected"
                      : isCameraActive
                        ? "Turn Off Camera"
                        : "Turn On Camera"}
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Screen Share */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (isScreenSharing) {
                        onStopStreaming?.();
                      } else {
                        onShareScreen?.();
                      }
                    }}
                    aria-label={
                      isScreenSharing ? "Stop Streaming" : "Share Your Screen"
                    }
                    aria-pressed={!!isScreenSharing}
                    className={cn(
                      ACTION_BTN,
                      "flex-1",
                      isScreenSharing ? ACTION_LIVE : ACTION_REST,
                    )}
                  >
                    <Icon
                      name="screenShare"
                      state={isScreenSharing ? "active" : "idle"}
                      size="md"
                      className="group-hover:animate-wiggle"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12}>
                  <p>
                    {isScreenSharing ? "Stop Streaming" : "Share Your Screen"}
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Activities */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenActivities?.();
                    }}
                    aria-label="Start an Activity"
                    className={cn(ACTION_BTN, "flex-1", ACTION_REST)}
                  >
                    <Icon
                      name="activities"
                      size="md"
                      className="group-hover:animate-wiggle"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12}>
                  <p>Start an Activity</p>
                </TooltipContent>
              </Tooltip>

              {/* Soundboard */}
              <div className="relative flex-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      ref={soundboardBtnRef}
                      onClick={toggleSoundboardPicker}
                      aria-label="Open Soundboard"
                      aria-expanded={isSoundboardPickerOpen}
                      className={cn(
                        ACTION_BTN,
                        "w-full",
                        isSoundboardPickerOpen ? ACTION_OPEN : ACTION_REST,
                      )}
                    >
                      <Icon
                        name="soundboard"
                        state={isSoundboardPickerOpen ? "active" : "idle"}
                        size="md"
                        className="group-hover:animate-wiggle"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12}>
                    <p>Open Soundboard</p>
                  </TooltipContent>
                </Tooltip>
                <Suspense fallback={null}>
                  <SoundboardPicker
                    open={isSoundboardPickerOpen}
                    onClose={() => setIsSoundboardPickerOpen(false)}
                    placement="top-start"
                    markerRef={soundboardBtnRef}
                    initialView={soundboardInitialView}
                    sfu={sfu}
                    serverId={serverId}
                    channelId={voiceChannelId}
                    roomSlug={roomSlug}
                    voiceSessionId={voiceSessionId}
                    isClosing={!isSoundboardPickerOpen}
                    localUserId={localUserId}
                  />
                </Suspense>
              </div>

              {/* GIF/Sticker Reactions — only shown when connected to voice */}
              {sfu && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="relative flex-1">
                      <button
                        type="button"
                        ref={stickerBtnRef}
                        onClick={() => setIsStickerPickerOpen((v) => !v)}
                        aria-label="GIF & Sticker Reactions"
                        aria-expanded={isStickerPickerOpen}
                        className={cn(
                          ACTION_BTN,
                          "w-full",
                          isStickerPickerOpen ? ACTION_OPEN : ACTION_REST,
                        )}
                      >
                        <Icon
                          name="sticker"
                          state={isStickerPickerOpen ? "active" : "idle"}
                          size="md"
                          className="group-hover:animate-wiggle"
                        />
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12}>
                    <p>GIF &amp; Sticker Reactions</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        <CameraSettingsModal
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          isCameraActive={!!isCameraActive}
          onToggleCamera={onToggleCamera}
          settingsUserId={voiceSettingsUserId}
        />

        {/* GIF Picker in voice reaction mode */}
        {gifPickerVoiceMode && (
          <Suspense fallback={null}>
            <GifPickerModal
              open={shouldRenderStickerPicker}
              onClose={() => setIsStickerPickerOpen(false)}
              onSelect={async () => {
                /* no-op: voice mode handles send */
              }}
              voiceMode={gifPickerVoiceMode}
              markerRef={stickerBtnRef}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}
