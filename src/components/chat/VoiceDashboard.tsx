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
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import type { SFUClient } from "@/lib/sfu-client";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ActionSheet,
  type ActionSheetItem,
} from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResponsivePopover } from "@/components/ui/popover";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
import { dockIconState, dockState } from "@/components/ui/dock";
import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
} from "@/components/ui/menu";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useMemo, useRef, useState, lazy, Suspense } from "react";
import { FloatingListenTogetherPlayer } from "./FloatingListenTogetherPlayer";
import { FloatingSoundboardManager } from "./FloatingSoundboardManager";
import { Icon } from "@/components/ui/icon";
import { NoiseReductionPanel } from "./NoiseReductionPanel";
import { SpatialAudioPanel } from "./SpatialAudioPanel";

/* Quiet Pro: compact dock row in the sidebar voice panel, painted with the
 * shared dock recipe (`dockState`): rest = neutral tint, open picker =
 * stronger tint, live camera / share = accent tint + Fill glyph. No solids. */
const ACTION_BTN = cn(
  PRESS,
  HIT,
  DISABLED,
  "group flex h-8 items-center justify-center rounded-md outline-none",
);
const ACTION_REST = dockState("rest");
const ACTION_OPEN = dockState("open");
const ACTION_LIVE = dockState("live");
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

function formatQualityOption(quality: string) {
  return quality.replace("p", "p ");
}

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
  const isMobile = useIsMobile();
  const [isStreamMenuOpen, setIsStreamMenuOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVoiceDetailsOpen, setIsVoiceDetailsOpen] = useState(false);
  const [isSpatialOpen, setIsSpatialOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const shouldRenderStickerPicker = isStickerPickerOpen;
  const [isSoundboardPickerOpen, setIsSoundboardPickerOpen] = useState(false);
  const [soundboardInitialView, setSoundboardInitialView] = useState<
    "soundboard" | "listenTogether"
  >("soundboard");
  const [isNoiseReductionOpen, setIsNoiseReductionOpen] = useState(false);
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);
  const noiseReductionBtnRef = useRef<HTMLButtonElement>(null);

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

  const toggleStreamAudio = () => onToggleStreamAudio?.();
  const toggleAlwaysShowStreamPreview = () =>
    updateUserSettings(
      (current) => ({
        ...current,
        alwaysShowStreamPreview: !current.alwaysShowStreamPreview,
      }),
      voiceSettingsUserId,
    );
  // Phone form of the stream-settings menu (design-system 13.1).
  const streamActionItems: ActionSheetItem[] = [
    {
      key: "change-source",
      label: "Change Source",
      icon: <Icon name="screenShare" size="sm" />,
      onClick: () => onChangeStreamSource?.(),
    },
    {
      key: "stream-audio",
      label: "Stream Audio",
      icon: <Icon name="voiceChannel" size="sm" />,
      rightIcon: isStreamingAudio ? <Icon name="check" size="xs" /> : undefined,
      onClick: toggleStreamAudio,
    },
    {
      key: "stream-preview",
      label: "Always Show Stream Preview",
      icon: <Icon name="monitor" size="sm" />,
      rightIcon: alwaysShowStreamPreview ? (
        <Icon name="check" size="xs" />
      ) : undefined,
      onClick: toggleAlwaysShowStreamPreview,
      divider: true,
    },
    ...(availableQualities.length > 0
      ? [
          {
            key: "quality",
            label: "Quality",
            subtitle: streamQualityBadge ?? undefined,
            icon: <Icon name="settings" size="sm" />,
            onClick: () => {},
            divider: true,
            submenu: (
              <div role="radiogroup" aria-label="Quality">
                {availableQualities.map((quality) => (
                  <button
                    key={quality}
                    type="button"
                    role="radio"
                    aria-checked={screenQuality === quality}
                    onClick={() => {
                      onStreamQualityChange?.(quality);
                      setIsStreamMenuOpen(false);
                    }}
                    className={cn(
                      MENU_ITEM,
                      screenQuality === quality
                        ? MENU_ITEM_DEFAULT_ON
                        : MENU_ITEM_DEFAULT,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {formatQualityOption(quality)}
                    </span>
                    {screenQuality === quality && (
                      <Icon name="check" size="xs" />
                    )}
                  </button>
                ))}
              </div>
            ),
          },
        ]
      : []),
    {
      key: "stop-streaming",
      label: "Stop Streaming",
      icon: <Icon name="streamOff" size="sm" />,
      variant: "danger" as const,
      onClick: () => onStopStreaming?.(),
    },
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <div
        data-floating-avoid=""
        className="animate-in slide-in-from-bottom-5 duration-300 border-b-0 rounded-b-none"
      >
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
                  <SpatialAudioPanel
                    isOpen={isSpatialOpen}
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
                          <Icon name="speaking" size="md" className="" />
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
                  <ResponsivePopover
                    open={isNoiseReductionOpen}
                    onOpenChange={setIsNoiseReductionOpen}
                    title="Noise Suppression"
                    variant="rich"
                    anchor={noiseReductionBtnRef}
                    side="top"
                  >
                    <NoiseReductionPanel
                      settingsUserId={voiceSettingsUserId}
                      compact
                    />
                  </ResponsivePopover>
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
                    <Icon name="disconnect" size="lg" className="" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12}>
                  <p>Disconnect</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

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
                {isMobile ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      onClick={() => setIsStreamMenuOpen(true)}
                      aria-label="Stream settings"
                      aria-haspopup="dialog"
                      aria-expanded={isStreamMenuOpen}
                      className={cn(isStreamMenuOpen && "bg-rm-tint-3")}
                    >
                      <Icon name="more" size="sm" />
                    </Button>
                    <ActionSheet
                      open={isStreamMenuOpen}
                      onOpenChange={setIsStreamMenuOpen}
                      items={streamActionItems}
                      title="Stream Settings"
                    />
                  </>
                ) : (
                  <DropdownMenu
                    open={isStreamMenuOpen}
                    onOpenChange={setIsStreamMenuOpen}
                  >
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon-sm"
                          aria-label="Stream settings"
                          className={cn(isStreamMenuOpen && "bg-rm-tint-3")}
                        />
                      }
                    >
                      <Icon name="more" size="sm" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="end"
                      aria-label="Stream Settings"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Stream Settings</DropdownMenuLabel>
                        <DropdownMenuItem
                          icon={<Icon name="screenShare" size="sm" />}
                          onClick={() => onChangeStreamSource?.()}
                        >
                          Change Source
                        </DropdownMenuItem>
                        <DropdownMenuCheckboxItem
                          icon={<Icon name="voiceChannel" size="sm" />}
                          checked={!!isStreamingAudio}
                          onCheckedChange={toggleStreamAudio}
                          closeOnClick
                        >
                          Stream Audio
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          icon={<Icon name="monitor" size="sm" />}
                          checked={alwaysShowStreamPreview}
                          onCheckedChange={toggleAlwaysShowStreamPreview}
                          closeOnClick
                        >
                          Always Show Stream Preview
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuGroup>
                      {availableQualities.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Quality</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={screenQuality ?? null}
                              onValueChange={(quality: string) =>
                                onStreamQualityChange?.(quality)
                              }
                            >
                              {availableQualities.map((quality) => (
                                <DropdownMenuRadioItem
                                  key={quality}
                                  value={quality}
                                  closeOnClick
                                >
                                  {formatQualityOption(quality)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="danger"
                        icon={<Icon name="streamOff" size="sm" />}
                        onClick={() => onStopStreaming?.()}
                      >
                        Stop Streaming
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
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
                    <Icon
                      name="camera"
                      state={dockIconState(isCameraActive ? "live" : "rest")}
                      size="md"
                    />
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
                      className=""
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
                    <Icon name="activities" size="md" className="" />
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
                        className=""
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
                          className=""
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
