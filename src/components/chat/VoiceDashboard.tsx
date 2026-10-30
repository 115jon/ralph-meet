import { TooltipProvider } from "@/components/ui/tooltip";
import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { VoiceDetailsPanel } from "@/components/voice/VoiceDetailsPanel";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import type { GridItem } from "@/components/voice/types";
import { useAppActive } from "@/hooks/useAppActive";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import type { SFUClient } from "@/lib/sfu-client";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { connectionStatus } from "@/lib/voice/connection-status-label";
import { cn } from "@/lib/utils";
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
import { PRESS } from "@/components/ui/interaction";
import { DOCK_LEAVE } from "@/components/ui/dock";
import { DockButton } from "@/components/ui/dock-button";
import { IconButton } from "@/components/ui/IconButton";
import { LedLabel, type LedState } from "@/components/ui/led";
import { Num, NumClock } from "@/components/ui/num";
import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
} from "@/components/ui/menu";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { memo, useMemo, useRef, useState, lazy, Suspense } from "react";
import { FloatingListenTogetherPlayer } from "./FloatingListenTogetherPlayer";
import { FloatingSoundboardManager } from "./FloatingSoundboardManager";
import { Icon } from "@/components/ui/icon";
import { NoiseReductionPanel } from "./NoiseReductionPanel";
import { SpatialAudioPanel } from "./SpatialAudioPanel";

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

/** "1080p60", "4K60": numbers in the mono face, no shouting. */
function formatScreenQualityBadge(quality?: string) {
  if (!quality) return null;
  const fourKMatch = quality.match(/^4k(\d+)$/i);
  if (fourKMatch) return `4K${fourKMatch[1]}`;
  const standardMatch = quality.match(/^(\d+)p(\d+)$/i);
  if (standardMatch) return `${standardMatch[1]}p${standardMatch[2]}`;
  return quality;
}

const LED_FOR_TONE: Record<string, LedState> = {
  good: "talk",
  pending: "off",
  warning: "idle",
  danger: "muted",
};

/**
 * Call keys are 48 square with a 20px glyph (DESIGN.md, call dock; the kit's
 * CallBar). Five of them fill the 264px tree panel edge to edge at a 2px gap.
 */
const KEY = { size: "lg", iconSize: "lg" } as const;
/**
 * The action row steps down so Leave is always whole on screen: five 48px
 * keys from 248px of row (5 x 48 + 4 x 2px gaps), five 40px keys from 208px
 * (the 264px default sidebar has 247), and below that activities and
 * soundboard fold into a "…" menu beside camera, share and Leave.
 */
const NARROW_KEY = "@max-[247px]:size-10";
const WIDE_ONLY_KEY = "hidden @min-[208px]:inline-flex";
const MORE_KEY = "@min-[208px]:hidden";

/**
 * The connection ping, in its own leaf: it subscribes to the SFU stats only
 * while the app is active and the call is connected, so a stats tick
 * re-renders this one number, never the strip.
 */
function PingReadout({ sfu, live }: { sfu: SFUClient | null; live: boolean }) {
  const active = useAppActive();
  const stats = useVoiceStats(sfu, live && active);
  if (!stats) return null;
  return (
    <Num size="sm" className="shrink-0 text-ink-3" title="Round-trip latency">
      {Math.round(stats.ping)} ms
    </Num>
  );
}

interface VoiceDashboardProps {
  serverName: string;
  voiceChannelName?: string;
  /** "dm": a direct call; the status line reads "Call with Ada". */
  kind?: "channel" | "dm";
  /** Transport state; drives the LED and the readout (spec §3 rule 4). */
  connectionState?: string;
  /** When the call (or your session) started, for the clock. */
  startedAt?: number | null;
  /** Retry after a failed connection. */
  onRetry?: () => void;
  /**
   * The call's stage is on screen, so the stage bar owns the actions and the
   * strip collapses to its status line (spec §3 rule 2).
   */
  collapsed?: boolean;
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

/**
 * The call strip (talk-tree-spec §3 rule 2): shown only during a call, above
 * the account row. A 36px status line (LED, channel · server, ping and clock
 * in mono, voice options) and a 40px action row (camera, share, activities,
 * soundboard, Leave). Mic and deafen live in the account row, never here.
 * While the call's stage is on screen it collapses to its status line.
 * Joining slides it up from the account row (spec §6 focal moment 2).
 */
export const VoiceDashboard = memo(function VoiceDashboard({
  serverName,
  voiceChannelName,
  kind = "channel",
  connectionState = "connected",
  startedAt,
  onRetry,
  collapsed = false,
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
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVoiceDetailsOpen, setIsVoiceDetailsOpen] = useState(false);
  const [isSpatialOpen, setIsSpatialOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [isSoundboardPickerOpen, setIsSoundboardPickerOpen] = useState(false);
  const [soundboardInitialView, setSoundboardInitialView] = useState<
    "soundboard" | "listenTogether"
  >("soundboard");
  const [isNoiseReductionOpen, setIsNoiseReductionOpen] = useState(false);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  // The soundboard picker grows from whichever key opened it: the soundboard
  // key, or the "…" key that holds it on a narrow strip.
  const soundboardMarkerRef = useRef<HTMLElement | null>(null);

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
  const streamSourceKind = currentScreenSource?.sourceKind ?? null;
  const streamSourceTitle =
    currentScreenSource?.sourceName?.trim() ||
    (streamSourceKind === "window"
      ? "An application"
      : streamSourceKind === "device"
        ? "A capture device"
        : "Your screen");
  const streamSourceIcon = currentScreenSource?.sourceIcon?.trim() || null;
  const alwaysShowStreamPreview = !!settings.alwaysShowStreamPreview;
  const gifPickerVoiceMode = useMemo(() => (sfu ? { sfu } : null), [sfu]);
  const spatialOn =
    !!spatialAudioState?.enabled &&
    settings.spatialAudioEnabled &&
    settings.streamHighFidelity;

  const status = connectionStatus(connectionState, true);
  const ledState = LED_FOR_TONE[status.tone] ?? "off";
  const connected = status.tone === "good";
  const placeLabel =
    kind === "dm"
      ? `Call with ${serverName}`
      : `${voiceChannelName || "Voice"} · ${serverName}`;

  const toggleSoundboardPicker = (from: "key" | "more" = "key") => {
    soundboardMarkerRef.current = (
      from === "more" ? moreBtnRef : soundboardBtnRef
    ).current;
    onOpenSoundboard?.();
    setSoundboardInitialView("soundboard");
    setIsSoundboardPickerOpen((value) => !value);
  };
  const openListenTogetherPicker = () => {
    const key = soundboardBtnRef.current;
    soundboardMarkerRef.current =
      key && key.offsetParent !== null ? key : moreBtnRef.current;
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
      label: "Change source",
      icon: <Icon name="screenShare" size="sm" />,
      onClick: () => onChangeStreamSource?.(),
    },
    {
      key: "stream-audio",
      label: "Stream audio",
      icon: <Icon name="speaker" size="sm" />,
      rightIcon: isStreamingAudio ? <Icon name="check" size="xs" /> : undefined,
      onClick: toggleStreamAudio,
    },
    {
      key: "stream-preview",
      label: "Always show stream preview",
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
            icon: <Icon name="sliders" size="sm" />,
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
      label: "Stop streaming",
      icon: <Icon name="streamOff" size="sm" />,
      variant: "danger" as const,
      onClick: () => onStopStreaming?.(),
    },
  ];

  const streamSettingsTrigger = isMobile ? (
    <>
      <IconButton
        icon="more"
        size={28}
        variant="muted"
        aria-label="Stream settings"
        aria-haspopup="dialog"
        aria-expanded={isStreamMenuOpen}
        onClick={() => setIsStreamMenuOpen(true)}
      />
      <ActionSheet
        open={isStreamMenuOpen}
        onOpenChange={setIsStreamMenuOpen}
        items={streamActionItems}
        title="Stream settings"
      />
    </>
  ) : (
    <DropdownMenu open={isStreamMenuOpen} onOpenChange={setIsStreamMenuOpen}>
      <DropdownMenuTrigger
        render={
          <IconButton
            icon="more"
            size={28}
            variant="muted"
            aria-label="Stream settings"
          />
        }
      />
      <DropdownMenuContent side="top" align="end" aria-label="Stream settings">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Stream settings</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<Icon name="screenShare" size="sm" />}
            onClick={() => onChangeStreamSource?.()}
          >
            Change source
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            icon={<Icon name="speaker" size="sm" />}
            checked={!!isStreamingAudio}
            onCheckedChange={toggleStreamAudio}
            closeOnClick
          >
            Stream audio
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            icon={<Icon name="monitor" size="sm" />}
            checked={alwaysShowStreamPreview}
            onCheckedChange={toggleAlwaysShowStreamPreview}
            closeOnClick
          >
            Always show stream preview
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
          Stop streaming
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const hasSpatial = !!(spatialAudioState && onUpdateSpatialAudioState);

  return (
    <TooltipProvider>
      <section
        aria-label="Voice call"
        data-call-strip=""
        data-collapsed={collapsed ? "" : undefined}
        data-floating-avoid=""
        className="border-t-2 border-b border-t-ink-1 border-b-line bg-ply-1 transition-[opacity,translate] duration-(--dur-4) ease-spring starting:translate-y-[calc(var(--motion-shift)*2)] starting:opacity-0"
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

        {/* Status: a lit word (Voice connected), where you are, ping and
            clock, voice options. */}
        <div className="flex items-center gap-1.5 pt-1.5 pr-1.5 pl-2">
          <button
            type="button"
            className={cn(
              PRESS,
              "@container flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[2px] px-1.5 py-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus [--hover-o:0.06]",
            )}
            onClick={onVoiceNavigate}
            aria-label={`${placeLabel}, ${status.label}. Open the call`}
          >
            <LedLabel state={ledState} className="max-w-full">
              {connected ? (
                /* Whole words only: "Voice connected" where it fits (LED +
                 * the light themes' silkscreen width), else "Connected". */
                <>
                  <span
                    className={cn(
                      "hidden",
                      kind === "dm"
                        ? "@min-[139px]:inline"
                        : "@min-[147px]:inline",
                    )}
                  >
                    {kind === "dm" ? "Call connected" : "Voice connected"}
                  </span>
                  <span
                    className={
                      kind === "dm"
                        ? "@min-[139px]:hidden"
                        : "@min-[147px]:hidden"
                    }
                  >
                    Connected
                  </span>
                </>
              ) : status.tone === "danger" ? (
                "Connection lost"
              ) : (
                status.label
              )}
            </LedLabel>
            {kind === "dm" ? (
              <span className="w-full truncate text-[13px] leading-[18px] font-medium text-ink-2">
                <InlineEmojiText text={placeLabel} />
              </span>
            ) : (
              /* Channel, then " · server" only when the server fits whole:
               * otherwise it wraps onto a clipped second line, so the server
               * goes first and the channel truncates last. */
              <span className="flex h-[18px] w-full flex-wrap overflow-hidden text-[13px] leading-[18px] font-medium text-ink-2">
                <span className="max-w-full min-w-0 truncate">
                  <InlineEmojiText text={voiceChannelName || "Voice"} />
                </span>
                <span className="shrink-0 whitespace-pre">
                  {" · "}
                  <InlineEmojiText text={serverName} />
                </span>
              </span>
            )}
          </button>

          {connected ? (
            <PingReadout sfu={sfu} live={connected} />
          ) : status.tone === "danger" && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                PRESS,
                "h-6 shrink-0 rounded-sm px-1.5 text-ui-xs font-medium text-ink-1 outline-none focus-visible:outline-2 focus-visible:outline-focus",
              )}
            >
              Retry
            </button>
          ) : null}
          {startedAt ? (
            <NumClock
              since={startedAt}
              size="sm"
              className="shrink-0 font-semibold text-ink-1"
            />
          ) : null}

          <DropdownMenu open={isOptionsOpen} onOpenChange={setIsOptionsOpen}>
            <DropdownMenuTrigger
              render={
                <IconButton
                  ref={optionsBtnRef}
                  icon="sliders"
                  size={24}
                  variant="muted"
                  aria-label="Voice options"
                  tone={
                    isVoiceDetailsOpen || isNoiseReductionOpen || isSpatialOpen
                      ? "toggled"
                      : undefined
                  }
                />
              }
            />
            <DropdownMenuContent
              side="top"
              align="end"
              aria-label="Voice options"
            >
              <DropdownMenuItem
                icon={<Icon name="signal" size="sm" />}
                onClick={() => setIsVoiceDetailsOpen(true)}
              >
                Connection details
              </DropdownMenuItem>
              {showNoiseReductionShortcut && (
                <DropdownMenuItem
                  icon={<Icon name="noiseSuppression" size="sm" />}
                  hint={settings.noiseReductionEnabled ? "On" : "Off"}
                  onClick={() => setIsNoiseReductionOpen(true)}
                >
                  Noise suppression…
                </DropdownMenuItem>
              )}
              {hasSpatial && (
                <DropdownMenuItem
                  icon={<Icon name="spatial" size="sm" />}
                  hint={spatialOn ? "On" : "Off"}
                  onClick={() => setIsSpatialOpen(true)}
                >
                  Spatial audio…
                </DropdownMenuItem>
              )}
              {sfu && (
                <DropdownMenuItem
                  icon={<Icon name="sticker" size="sm" />}
                  onClick={() => setIsStickerPickerOpen(true)}
                >
                  GIF &amp; sticker reactions
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <VoiceDetailsPanel
          sfu={sfu}
          isOpen={isVoiceDetailsOpen}
          onClose={() => setIsVoiceDetailsOpen(false)}
          triggerRef={optionsBtnRef}
          channelName={voiceChannelName}
        />
        {showNoiseReductionShortcut && (
          <ResponsivePopover
            open={isNoiseReductionOpen}
            onOpenChange={setIsNoiseReductionOpen}
            title="Noise suppression"
            variant="rich"
            anchor={optionsBtnRef}
            side="top"
          >
            <NoiseReductionPanel settingsUserId={voiceSettingsUserId} compact />
          </ResponsivePopover>
        )}
        {spatialAudioState && onUpdateSpatialAudioState && (
          <SpatialAudioPanel
            isOpen={isSpatialOpen}
            anchorRef={optionsBtnRef}
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
                  echoCancellation: enabled ? false : current.echoCancellation,
                  noiseSuppression: enabled ? false : current.noiseSuppression,
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

        {/* Stream row + actions collapse while the call's stage is on
            screen: the stage bar owns them there. Height-free collapse. */}
        <div className="rm-collapse" data-open={collapsed ? undefined : ""}>
          <div className="rm-collapse-inner" inert={collapsed || undefined}>
            {isScreenSharing && (
              <div className="mx-2 mb-1 rounded-md bg-tint-1 p-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-live-tint text-live-ink">
                    {streamSourceIcon ? (
                      <img
                        src={streamSourceIcon}
                        alt=""
                        className="size-4 object-contain"
                        draggable={false}
                      />
                    ) : (
                      <Icon
                        name={
                          streamSourceKind === "window"
                            ? "window"
                            : streamSourceKind === "device"
                              ? "camera"
                              : "monitor"
                        }
                        state="active"
                        size="sm"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-sm font-medium text-ink-1">
                      {streamSourceTitle}
                    </p>
                    <p className="flex items-center gap-2">
                      <LedLabel state="live">Live</LedLabel>
                      {streamQualityBadge && (
                        <Num className="text-ink-3">{streamQualityBadge}</Num>
                      )}
                    </p>
                  </div>
                  {streamSettingsTrigger}
                </div>
                {localStreamWatchers.length > 0 && (
                  <div className="mt-2">
                    <StreamWatcherList watchers={localStreamWatchers} />
                  </div>
                )}
              </div>
            )}

            {/* Actions: camera, share, activities, soundboard | Leave. The
                row is a container (NARROW_KEY, WIDE_ONLY_KEY, MORE_KEY). */}
            <div className="@container px-2 pt-1.5 pb-2">
              <div className="flex items-center gap-0.5">
                <DockButton
                  {...KEY}
                  className={NARROW_KEY}
                  state={isCameraActive ? "live" : "rest"}
                  icon="camera"
                  tooltip={
                    !hasCamera
                      ? "No camera detected"
                      : isCameraActive
                        ? "Turn off camera"
                        : "Turn on camera"
                  }
                  disabled={!hasCamera}
                  aria-pressed={!!isCameraActive}
                  onClick={() => {
                    void handleVoiceCameraToggle({
                      hasCamera: !!hasCamera,
                      isCameraActive: !!isCameraActive,
                      alwaysPreviewVideo: settings?.alwaysPreviewVideo,
                      onToggleCamera,
                      onOpenPreviewModal: () => setIsCameraModalOpen(true),
                    });
                  }}
                />
                <DockButton
                  {...KEY}
                  className={NARROW_KEY}
                  state={isScreenSharing ? "live" : "rest"}
                  icon="screenShare"
                  tooltip={isScreenSharing ? "Stop sharing" : "Share screen"}
                  aria-pressed={!!isScreenSharing}
                  onClick={() => {
                    if (isScreenSharing) onStopStreaming?.();
                    else onShareScreen?.();
                  }}
                />
                <DockButton
                  {...KEY}
                  className={WIDE_ONLY_KEY}
                  state="rest"
                  icon="activities"
                  tooltip="Activities"
                  onClick={() => onOpenActivities?.()}
                />
                <DockButton
                  ref={soundboardBtnRef}
                  {...KEY}
                  className={WIDE_ONLY_KEY}
                  state={isSoundboardPickerOpen ? "open" : "rest"}
                  icon="soundboard"
                  tooltip="Soundboard"
                  aria-expanded={isSoundboardPickerOpen}
                  onClick={() => toggleSoundboardPicker("key")}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <DockButton
                        ref={moreBtnRef}
                        {...KEY}
                        className={cn(NARROW_KEY, MORE_KEY)}
                        state={isSoundboardPickerOpen ? "open" : "rest"}
                        icon="more"
                        aria-label="More call actions"
                      />
                    }
                  />
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    aria-label="More call actions"
                  >
                    <DropdownMenuItem
                      icon={<Icon name="activities" size="sm" />}
                      onClick={() => onOpenActivities?.()}
                    >
                      Activities
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<Icon name="soundboard" size="sm" />}
                      onClick={() => toggleSoundboardPicker("more")}
                    >
                      Soundboard
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <IconButton
                  variant="plain"
                  {...KEY}
                  icon="disconnect"
                  tooltip="Leave call"
                  className={cn("ml-auto", DOCK_LEAVE, NARROW_KEY)}
                  onClick={() => onVoiceDisconnect?.()}
                />
              </div>
            </div>
          </div>
        </div>

        <Suspense fallback={null}>
          <SoundboardPicker
            open={isSoundboardPickerOpen}
            onClose={() => setIsSoundboardPickerOpen(false)}
            placement="top-start"
            markerRef={soundboardMarkerRef}
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

        <CameraSettingsModal
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          isCameraActive={!!isCameraActive}
          onToggleCamera={onToggleCamera}
          settingsUserId={voiceSettingsUserId}
        />

        {gifPickerVoiceMode && (
          <Suspense fallback={null}>
            <GifPickerModal
              open={isStickerPickerOpen}
              onClose={() => setIsStickerPickerOpen(false)}
              onSelect={async () => {
                /* no-op: voice mode handles send */
              }}
              voiceMode={gifPickerVoiceMode}
              markerRef={optionsBtnRef}
            />
          </Suspense>
        )}
      </section>
    </TooltipProvider>
  );
});
