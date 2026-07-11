import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { VoiceDetailsPanel } from "@/components/voice/VoiceDetailsPanel";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import type { GridItem } from "@/components/voice/types";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import type { SFUClient } from "@/lib/sfu-client";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
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
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { ListenTogetherNowPlayingCard } from "./ListenTogetherNowPlayingCard";
import { useListenTogetherPlaybackState } from "./listen-together-playback";
import { ActiveSoundboardEffectList } from "./ActiveSoundboardEffectList";
import { getSoundboardServerKey } from "@/lib/voice/soundboard";
import { AppWindow, AudioWaveform } from "lucide-react";
import {
  Gamepad2,
  Monitor,
  MoreHorizontal,
  Phone,
  Radio,
  Share2,
  SignalHigh,
  Sparkles,
  Sticker,
  Video,
  VideoOff,
  Volume2,
  XCircle,
} from "./Icons";
import { NoiseReductionPanel } from "./NoiseReductionPanel";
import { SpatialAudioPanel } from "./SpatialAudioPanel";

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
  const [isStreamMenuOpen, setIsStreamMenuOpen] = useState(false);
  const shouldRenderStreamMenu = useDelayUnmount(isStreamMenuOpen, 200);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVoiceDetailsOpen, setIsVoiceDetailsOpen] = useState(false);
  const [isSpatialOpen, setIsSpatialOpen] = useState(false);
  const shouldRenderSpatial = useDelayUnmount(isSpatialOpen, 200);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const shouldRenderStickerPicker = useDelayUnmount(isStickerPickerOpen, 200);
  const [isSoundboardPickerOpen, setIsSoundboardPickerOpen] = useState(false);
  const shouldRenderSoundboardPicker = useDelayUnmount(
    isSoundboardPickerOpen,
    200,
  );
  const [soundboardInitialView, setSoundboardInitialView] = useState<
    "soundboard" | "listenTogether"
  >("soundboard");
  const [isNoiseReductionOpen, setIsNoiseReductionOpen] = useState(false);
  const shouldRenderNoiseReduction = useDelayUnmount(isNoiseReductionOpen, 200);
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
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const listenTogetherPlayback = useListenTogetherPlaybackState(roomSlug);
  const localStreamWatchers = localUserId
    ? (watchersByStreamer[localUserId] ?? [])
    : [];
  const streamQualityBadge = formatScreenQualityBadge(screenQuality);
  const soundboardServerKey = getSoundboardServerKey(serverId);
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
      <div className="animate-in slide-in-from-bottom-5 duration-300">
        <ListenTogetherNowPlayingCard
          playback={listenTogetherPlayback}
          sfu={sfu}
          roomSlug={roomSlug}
          variant="mini"
          onOpenQueue={openListenTogetherPicker}
          className="mx-2 mt-2 mb-1"
        />

        <ActiveSoundboardEffectList
          serverKey={soundboardServerKey}
          localUserId={localUserId}
          sfu={sfu}
          variant="compact"
          className="mx-2 mb-1"
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
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#23a559]/10 text-[#23a559] hover:bg-[#23a559]/20 transition-colors outline-none"
                    >
                      <SignalHigh size={18} className="animate-pulse" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={12}
                    className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                  >
                    <p className="flex items-center gap-1.5">
                      {stats ? (
                        `Latency: ${stats.ping} ms`
                      ) : (
                        <>
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#23a559] animate-pulse" />
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
              className="min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left transition-colors outline-none hover:bg-rm-bg-hover/40 focus-visible:ring-2 focus-visible:ring-rm-accent/30"
              onClick={onVoiceNavigate}
              aria-label="Open voice channel details"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[14px] font-bold tracking-tight text-[#23a559] leading-tight">
                  Voice Connected
                </span>
                <span className="text-[12px] font-medium text-rm-text-muted/80 truncate max-w-[140px] group-hover/voice-status:text-rm-text-muted">
                  {voiceChannelName || "General"} / {serverName}
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
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg p-1.5 text-rm-text-muted/60 hover:bg-rm-bg-hover hover:text-rm-text transition-all relative z-10 outline-none group",
                          spatialAudioState.enabled &&
                            settings.spatialAudioEnabled &&
                            settings.streamHighFidelity &&
                            "text-primary bg-primary/10",
                        )}
                      >
                        <Sparkles size={18} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={12}
                      className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                    >
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
                        updateUserSettings(
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
                            autoSensitivity: enabled
                              ? false
                              : current.autoSensitivity,
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
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg p-1.5 text-rm-text-muted/60 hover:bg-rm-bg-hover hover:text-rm-text transition-all relative z-10 outline-none group",
                          settings.noiseReductionEnabled &&
                            "bg-sky-500/10 text-sky-300",
                        )}
                        aria-expanded={isNoiseReductionOpen}
                        aria-haspopup="dialog"
                      >
                        <span className="relative flex items-center justify-center">
                          <AudioWaveform
                            size={18}
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
                    <TooltipContent
                      side="top"
                      sideOffset={12}
                      className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                    >
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg p-1.5 text-rm-text-muted/60 hover:bg-rm-bg-hover hover:text-rm-text transition-all relative z-10 outline-none group"
                  >
                    <Phone
                      size={20}
                      strokeWidth={2.5}
                      className="rotate-[135deg] group-hover:animate-wiggle"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
                  <p>Disconnect</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {shouldRenderNoiseReduction &&
            createPortal(
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-[990]"
                  aria-label="Close noise suppression panel"
                  onClick={() => setIsNoiseReductionOpen(false)}
                />
                <div
                  ref={noiseReductionPanelRef}
                  className={cn(
                    "fixed z-[1000] w-[min(340px,calc(100vw-1.5rem))]",
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
            <div className="bg-rm-bg-elevated/50 rounded-lg p-2.5 border border-rm-border shadow-xl space-y-3 mx-1 mt-1">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/20 overflow-hidden">
                  {streamSourceIcon ? (
                    <img
                      src={streamSourceIcon}
                      alt=""
                      className="h-5 w-5 object-contain"
                      draggable={false}
                    />
                  ) : streamSourceKind === "window" ? (
                    <AppWindow size={18} />
                  ) : streamSourceKind === "device" ? (
                    <Video size={18} />
                  ) : (
                    <Monitor size={18} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black text-rm-text uppercase tracking-wider">
                      {streamSourceLabel}
                    </span>
                    <span className="bg-primary text-[8px] font-black px-1 rounded text-primary-foreground shadow-sm uppercase leading-tight">
                      Live
                    </span>
                    {streamQualityBadge && (
                      <span className="rounded bg-rm-bg-floating/80 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-rm-text-muted">
                        {streamQualityBadge}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[12px] font-bold text-rm-text">
                    {streamSourceTitle}
                  </p>
                  <p className="truncate text-[10px] text-rm-text-muted">
                    {streamSourceSubtitle}
                  </p>
                </div>
              </div>

              {localStreamWatchers.length > 0 && (
                <StreamWatcherList watchers={localStreamWatchers} />
              )}

              <div className="flex gap-1.5 relative">
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="flex-1 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded font-bold text-[10px] transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20"
                >
                  <XCircle size={10} /> Stop Streaming
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsStreamMenuOpen(!isStreamMenuOpen)}
                    className={cn(
                      "p-1.5 h-full rounded transition-all outline-none",
                      isStreamMenuOpen
                        ? "bg-rm-bg-elevated text-rm-text"
                        : "bg-rm-bg-elevated/50 text-rm-text-muted hover:bg-rm-bg-elevated",
                    )}
                  >
                    <MoreHorizontal size={14} />
                  </button>

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
                          <p className="text-[10px] font-bold text-rm-text-muted uppercase tracking-widest">
                            Stream Settings
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeStreamSource?.();
                            setIsStreamMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2"
                        >
                          <Share2 size={14} /> Change Source
                        </button>
                        <div className="h-[1px] bg-rm-border my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            onToggleStreamAudio?.();
                            setIsStreamMenuOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-between outline-none",
                            isStreamingAudio
                              ? "text-primary hover:bg-primary/10"
                              : "text-rm-text-muted hover:bg-rm-bg-hover",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Volume2 size={14} /> Stream Audio
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
                            "w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-between outline-none",
                            alwaysShowStreamPreview
                              ? "text-primary hover:bg-primary/10"
                              : "text-rm-text-muted hover:bg-rm-bg-hover",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Monitor size={14} /> Always Show Stream Preview
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
                              <p className="text-[9px] font-bold text-rm-text-muted/40 uppercase tracking-widest">
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
                                    "w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center justify-between group/q outline-none",
                                    screenQuality === q
                                      ? "bg-primary/10 text-primary"
                                      : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text",
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <Monitor
                                      size={12}
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
                    className={cn(
                      "flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none border border-transparent group",
                      isCameraActive
                        ? "bg-rm-bg-hover text-rm-text"
                        : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                      !hasCamera && "opacity-20 cursor-not-allowed grayscale",
                    )}
                  >
                    {isCameraActive ? (
                      <Video size={18} className="group-hover:animate-wiggle" />
                    ) : (
                      <VideoOff
                        size={18}
                        className="group-hover:animate-wiggle"
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
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
                    className={cn(
                      "flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none border border-transparent group",
                      isScreenSharing
                        ? "bg-[#23a559] text-white hover:bg-[#1f8b4c]"
                        : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                    )}
                  >
                    <Monitor size={18} className="group-hover:animate-wiggle" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
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
                    className="flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none bg-rm-bg-elevated/40 border border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover group"
                  >
                    <Gamepad2
                      size={18}
                      className="group-hover:animate-wiggle"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
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
                      className={cn(
                        "flex w-full h-8 items-center justify-center rounded-[8px] transition-all outline-none border group",
                        isSoundboardPickerOpen
                          ? "bg-[#5865f2]/20 border-[#5865f2]/40 text-[#5865f2]"
                          : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                      )}
                    >
                      <Radio size={18} className="group-hover:animate-wiggle" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={12}
                    className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                  >
                    <p>Open Soundboard</p>
                  </TooltipContent>
                </Tooltip>
                {shouldRenderSoundboardPicker && (
                  <Suspense fallback={null}>
                    <SoundboardPicker
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
                )}
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
                        className={cn(
                          "flex w-full h-8 items-center justify-center rounded-[8px] transition-all outline-none border group",
                          isStickerPickerOpen
                            ? "bg-[#5865f2]/20 border-[#5865f2]/40 text-[#5865f2]"
                            : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                        )}
                      >
                        <Sticker
                          size={18}
                          className="group-hover:animate-wiggle"
                        />
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={12}
                    className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                  >
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
        {gifPickerVoiceMode && shouldRenderStickerPicker && (
          <Suspense fallback={null}>
            <GifPickerModal
              onClose={() => setIsStickerPickerOpen(false)}
              onSelect={async () => {
                /* no-op: voice mode handles send */
              }}
              voiceMode={gifPickerVoiceMode}
              markerRef={stickerBtnRef}
              isClosing={!isStickerPickerOpen}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}
