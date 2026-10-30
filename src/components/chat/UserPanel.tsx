import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { useVoiceSessionStatus } from "@/components/voice/voice-session-status";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import type { GridItem } from "@/components/voice/types";
import type { SFUClient } from "@/lib/sfu-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DockButton } from "@/components/ui/dock-button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import {
  getCachedCollectiblesCatalog,
  subscribeCollectiblesCatalog,
} from "@/lib/collectibles-catalog-client";
import {
  OPEN_PROFILE_EDITOR_EVENT,
  type OpenProfileEditorEventDetail,
} from "@/lib/profile-editor-events";
import { useUserResolution } from "@/hooks/useUserResolution";
import { openSettings as openSettingsAt } from "@/components/chat/settings/settings-links";
import { getAuthAssetUrl } from "@/lib/platform";
import type {
  ScreenShareOptions,
  ScreenShareSourceState,
} from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { playCallEnd } from "@/lib/sounds";
import type { User } from "@/lib/types";
import { useDeviceAvailability } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import { UserDisplayName } from "./UserDisplayName";
import { UserNameplateLayer } from "./UserNameplateLayer";
import { getUserNameplatePresentation } from "./user-nameplate-presentation";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { normalizeUserStatus, type UserStatus } from "./UserStatusDot";
import { PRESENCE_LED } from "@/components/ui/avatar";
import { Led, LedLabel } from "@/components/ui/led";

const EMPTY_QUALITIES: string[] = [];
const EMPTY_GRID_ITEMS: GridItem[] = [];
const EMPTY_WATCHERS_BY_STREAMER: StreamWatchersByStreamer = {};
const SCREEN_SHARE_QUALITIES = getAvailableStreamQualities();
const TAILWIND_SPACING_UNIT_PX = 4;
const USER_PANEL_USERNAME_HIDE_WIDTH_PX = TAILWIND_SPACING_UNIT_PX * 56;
// Below this the name column can't hold ~4 letters either (the column is the
// sidebar width minus 210px; the identity also hides itself under 48px).
const USER_PANEL_IDENTITY_HIDE_WIDTH_PX = TAILWIND_SPACING_UNIT_PX * 54;
const VoiceDashboard = lazy(() =>
  import("@/components/chat/VoiceDashboard").then((mod) => ({
    default: mod.VoiceDashboard,
  })),
);
const AudioDeviceMenu = lazy(() =>
  import("@/components/chat/AudioDeviceMenu").then((mod) => ({
    default: mod.AudioDeviceMenu,
  })),
);
const ProfileEditorModal = lazy(
  () => import("@/components/chat/ProfileEditorModal"),
);
const UserAccountPopover = lazy(
  () => import("@/components/chat/UserAccountPopover"),
);
const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({
    default: mod.UnifiedScreenShareModal,
  })),
);

interface Props {
  user: User | null;
  serverId?: string | null;
  serverName: string;
  // Voice dashboard
  voiceConnected?: boolean;
  voiceChannelId?: string | null;
  voiceChannelName?: string;
  onVoiceDisconnect?: () => void;
  onVoiceNavigate?: () => void;
  // Streaming state for local user
  isScreenSharing?: boolean;
  isStreamingAudio?: boolean;
  screenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  availableQualities?: string[];
  onStopStreaming?: () => void;
  onToggleStreamAudio?: () => void;
  onChangeStreamSource?: () => void;
  onStartScreenShare?: (options: ScreenShareOptions) => void;
  onStreamQualityChange?: (quality: string) => void;
  isCameraActive?: boolean;
  hasCamera?: boolean;
  hasMicrophone?: boolean;
  onToggleCamera?: () => void;
  onToggleMic?: () => void;
  onToggleDeafen?: () => void;
  sfu?: SFUClient | null;
  gridItems?: GridItem[];
  watchersByStreamer?: StreamWatchersByStreamer;
  spatialAudioState?: SharedSpatialAudioState;
  onUpdateSpatialAudioState?: (state: SharedSpatialAudioState) => void;
  voiceSettingsUserId?: string;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
  sidebarWidthPx?: number;
  /**
   * Override: whether the call's stage is on screen (the call strip then
   * collapses to its status line). Derived from the active channel when
   * omitted.
   */
  stageOnScreen?: boolean;
  /** Override the strip's connection state (fixtures). */
  connectionState?: string;
}

/**
 * Device caret beside mic / deafen: a 10px-wide half of a split button, as
 * tall as the 40px key. HIT still gives it a 44px target on touch.
 */
const CARET =
  "inline-flex h-10 w-2.5 shrink-0 items-center justify-center rounded-[2px] outline-none [&_svg]:size-2.5";

const statusLabels: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Invisible",
};

/**
 * The status line under the name fits the name column (a container: the
 * column is the sidebar width minus 210px of avatar, keys and padding). A
 * word shows only when it fits whole, never with an ellipsis: the full word,
 * else a short code (DND, INVIS), else no line at all (the avatar's presence
 * LED still shows the state; the row's accessible name and tooltip always
 * carry the full label). Breakpoints are the silkscreen word widths in the
 * light themes (the wider tracking), plus a pixel.
 */
const STATUS_WORD: Record<
  UserStatus,
  { short?: string; full: string; shortAt?: string; line: string }
> = {
  online: { full: "@min-[53px]:inline", line: "@min-[53px]:block" },
  idle: { full: "@min-[36px]:inline", line: "@min-[36px]:block" },
  dnd: {
    short: "DND",
    full: "@min-[124px]:inline",
    shortAt: "@min-[27px]:inline @min-[124px]:hidden",
    line: "@min-[27px]:block",
  },
  offline: {
    short: "Invis",
    full: "@min-[80px]:inline",
    shortAt: "@min-[44px]:inline @min-[80px]:hidden",
    line: "@min-[44px]:block",
  },
};
/** A custom status takes the line from 54px (the default 264px sidebar). */
const CUSTOM_STATUS_SHOWN = "@min-[54px]:block";
const CUSTOM_STATUS_REPLACES = "@min-[54px]:hidden";

function CallDashboardSection({
  onOpenActivities,
  onOpenSoundboard,
  stageOnScreen,
}: {
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
  stageOnScreen?: boolean;
}) {
  const callStatus = useCallStore((s) => s.status);
  const callChannelId = useCallStore((s) => s.channelId);
  const remoteUser = useCallStore((s) => s.remoteUser);
  const callStartedAt = useCallStore((s) => s.startedAt);
  const callConnectionState = useCallVoiceStore((s) => s.connectionState);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const isMobile = useIsMobile();
  const collapsed =
    !isMobile && (stageOnScreen ?? activeChannelId === callChannelId);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);

  // SFU state from the call voice store
  const sfu = useCallVoiceStore((s) => s.sfu);
  const isScreenSharing = useCallVoiceStore((s) => s.isScreenSharing);
  const isStreamingAudio = useCallVoiceStore((s) => s.isStreamingAudio);
  const screenQuality = useCallVoiceStore((s) => s.screenQuality);
  const currentScreenSource = useCallVoiceStore((s) => s.currentScreenSource);
  const isCameraActive = useCallVoiceStore((s) => s.isCameraActive);
  const hasCamera = useCallVoiceStore((s) => s.hasCamera);
  const toggleCamera = useCallVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useCallVoiceStore((s) => s.toggleScreenShare);
  const onToggleStreamAudio = useCallVoiceStore((s) => s.onToggleStreamAudio);
  const gridItems = useCallVoiceStore((s) => s.gridItems);
  const watchersByStreamer = useCallVoiceStore((s) => s.watchersByStreamer);
  const spatialAudioState = useCallVoiceStore((s) => s.spatialAudioState);
  const updateSharedSpatialAudioState = useCallVoiceStore(
    (s) => s.updateSharedSpatialAudioState,
  );
  const callRoomSlug = useCallVoiceStore((s) => s.roomSlug);
  const callVoiceSessionId = useCallVoiceStore((s) => s.voiceSessionId);

  const handleCallLeave = useCallVoiceStore((s) => s.handleLeave);
  const defaultParticipantCapabilities = useMemo(
    () =>
      Object.fromEntries(
        gridItems.map((item) => [
          item.userId,
          { enabled: true, highFidelity: true },
        ]),
      ),
    [gridItems],
  );

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);

  if (callStatus !== "active") return null;

  return (
    <>
      <VoiceDashboard
        kind="dm"
        serverName={
          activeRemoteUser.displayName || activeRemoteUser.username || "Call"
        }
        connectionState={callConnectionState}
        startedAt={callStartedAt}
        collapsed={collapsed}
        onVoiceDisconnect={() => {
          playCallEnd();
          handleCallLeave?.();
          // Fully reset the call store so dashboard, button, and context menu
          // all return to idle. The voice channel continues to exist for others.
          useCallStore.getState().endCall("left");
        }}
        isScreenSharing={isScreenSharing}
        isStreamingAudio={isStreamingAudio}
        screenQuality={screenQuality}
        currentScreenSource={currentScreenSource}
        availableQualities={getAvailableStreamQualities()}
        onStopStreaming={() => toggleScreenShare?.()}
        onToggleStreamAudio={() => onToggleStreamAudio?.()}
        onShareScreen={() => setIsScreenModalOpen(true)}
        onChangeStreamSource={() => setIsScreenModalOpen(true)}
        onStreamQualityChange={(q) => toggleScreenShare?.({ quality: q })}
        isCameraActive={isCameraActive}
        hasCamera={hasCamera}
        onToggleCamera={() => toggleCamera?.()}
        sfu={sfu}
        voiceChannelId={callChannelId}
        gridItems={gridItems}
        watchersByStreamer={watchersByStreamer}
        spatialAudioState={spatialAudioState ?? undefined}
        onUpdateSpatialAudioState={(state) =>
          updateSharedSpatialAudioState?.(state)
        }
        participantCapabilities={defaultParticipantCapabilities}
        localUserId={useChatStore.getState().user?.id}
        voiceSettingsUserId={useChatStore.getState().user?.id}
        roomSlug={callRoomSlug}
        voiceSessionId={callVoiceSessionId}
        serverId={null}
        onOpenActivities={onOpenActivities}
        onOpenSoundboard={onOpenSoundboard}
        showNoiseReductionShortcut
      />
      <UnifiedScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onStart={(options) => {
          toggleScreenShare?.({
            ...options,
            changeSource: isScreenSharing,
          });
          setIsScreenModalOpen(false);
        }}
        availableQualities={getAvailableStreamQualities()}
      />
    </>
  );
}

export default function UserPanel({
  user,
  serverId,
  serverName,
  voiceConnected,
  voiceChannelId,
  voiceChannelName,
  onVoiceDisconnect,
  onVoiceNavigate,
  isScreenSharing,
  isStreamingAudio,
  screenQuality,
  currentScreenSource,
  availableQualities = EMPTY_QUALITIES,
  onStopStreaming,
  onToggleStreamAudio,
  onChangeStreamSource,
  onStartScreenShare,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone,
  onToggleCamera,
  onToggleMic,
  onToggleDeafen,
  sfu,
  gridItems = EMPTY_GRID_ITEMS,
  watchersByStreamer = EMPTY_WATCHERS_BY_STREAMER,
  spatialAudioState,
  onUpdateSpatialAudioState,
  voiceSettingsUserId,
  roomSlug,
  voiceSessionId,
  onOpenActivities,
  onOpenSoundboard,
  sidebarWidthPx,
  stageOnScreen,
  connectionState: connectionStateOverride,
}: Props) {
  const { updateStatus } = useChatActions();
  const speakingAttr = useSpeakingAttr(user?.id);
  const isMobile = useIsMobile();
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channelStartedAt = useChatStore((s) =>
    voiceChannelId ? s.voiceChannelStartedAt?.[voiceChannelId] : undefined,
  );
  const session = useVoiceSessionStatus(
    useShallow((s) =>
      s.channelId && s.channelId === voiceChannelId
        ? {
            connectionState: s.connectionState,
            joinedAt: s.joinedAt,
            retry: s.retry,
          }
        : { connectionState: null, joinedAt: null, retry: null },
    ),
  );
  const [collectiblesCatalog, setCollectiblesCatalog] = useState(() =>
    getCachedCollectiblesCatalog(),
  );
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const profileEditorTriggerRef = useRef<HTMLElement | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [userAvatarEl, setUserAvatarEl] = useState<HTMLButtonElement | null>(
    null,
  );
  const [activeDeviceMenu, setActiveDeviceMenu] = useState<
    "input" | "output" | null
  >(null);
  const [isVcScreenModalOpen, setIsVcScreenModalOpen] = useState(false);
  const micCaretRef = useRef<HTMLButtonElement>(null);
  const headphoneCaretRef = useRef<HTMLButtonElement>(null);

  const shouldRenderMenu = showMenu;

  // The same settings row the voice session reads (useVoiceChannel keys it
  // by the signed-in user), so the account row and the stage bar agree.
  const settings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(voiceSettingsUserId ?? user?.id)),
  );
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const callActive = useCallStore((s) => s.status) === "active";
  const channelStageOnScreen =
    !isMobile &&
    (stageOnScreen ?? (!!voiceChannelId && activeChannelId === voiceChannelId));
  // Retry is leave-then-rejoin (useVoiceChannel has no in-place reconnect),
  // run by the call's VoiceChannelView. The shell keeps that view mounted
  // only while it is joined or on screen, and records the rejoined channel
  // from the active one, so Retry from the strip first brings the stage on
  // screen. Mute and deafen live in the settings store and survive it.
  const sessionRetry = session.retry;
  const stageShowing =
    stageOnScreen ?? (!!voiceChannelId && activeChannelId === voiceChannelId);
  const retryFromStrip = useMemo(
    () =>
      sessionRetry
        ? () => {
            if (!stageShowing) onVoiceNavigate?.();
            sessionRetry();
          }
        : undefined,
    [sessionRetry, stageShowing, onVoiceNavigate],
  );
  const participantCapabilities = useMemo(() => {
    const vcMembers = voiceChannelId
      ? (useChatStore.getState().voiceChannelStates[voiceChannelId] ?? [])
      : [];
    return Object.fromEntries(
      (gridItems ?? []).map((item) => {
        const member = vcMembers.find((m) => m.clerk_user_id === item.userId);
        return [
          item.userId,
          {
            enabled: member?.spatial_audio_enabled ?? true,
            highFidelity: member?.spatial_audio_high_fidelity ?? true,
          },
        ];
      }),
    );
  }, [gridItems, voiceChannelId]);
  const nameplatePresentation = useMemo(
    () => getUserNameplatePresentation(user, collectiblesCatalog),
    [collectiblesCatalog, user],
  );

  const openSettings = useCallback(
    (tab: "account" | "voice" | "shares" | "appearance" = "account") =>
      openSettingsAt({ panel: tab }),
    [],
  );

  const openProfileEditor = useCallback((trigger?: HTMLElement) => {
    profileEditorTriggerRef.current = trigger ?? null;
    setShowProfileEditor(true);
  }, []);

  useEffect(() => {
    if (showProfileEditor) return;

    const trigger = profileEditorTriggerRef.current;
    profileEditorTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [showProfileEditor]);

  useEffect(() => {
    const handleOpenProfileEditor = (event: Event) => {
      const detail = (event as CustomEvent<OpenProfileEditorEventDetail>)
        .detail;
      openProfileEditor(detail?.trigger ?? undefined);
    };
    window.addEventListener(OPEN_PROFILE_EDITOR_EVENT, handleOpenProfileEditor);
    return () => {
      window.removeEventListener(
        OPEN_PROFILE_EDITOR_EVENT,
        handleOpenProfileEditor,
      );
    };
  }, [openProfileEditor]);

  useEffect(
    () =>
      subscribeCollectiblesCatalog((catalog) =>
        setCollectiblesCatalog(catalog),
      ),
    [],
  );

  // Global device availability from the shared store — used for the bottom-bar
  // mute button so it stays accurate even when no VC/call is active.
  // When a VC IS active, the prop overrides (it comes from the same store anyway).
  const globalDevices = useDeviceAvailability();
  const effectiveHasMic = hasMicrophone ?? globalDevices.hasMicrophone;
  const showIdentity =
    !sidebarWidthPx || sidebarWidthPx > USER_PANEL_IDENTITY_HIDE_WIDTH_PX;
  const showUsername =
    !sidebarWidthPx || sidebarWidthPx > USER_PANEL_USERNAME_HIDE_WIDTH_PX;

  if (!user) return null;

  const currentStatus = user.status ?? "online";
  const displayName = getDisplayName(user);
  const userHandle = user.username || displayName;
  const currentStatusLabel = statusLabels[currentStatus] ?? "Online";
  const hasNameplate = nameplatePresentation.hasNameplate;
  const nameplateTheme = hasNameplate ? nameplatePresentation.theme : null;
  const isMicMuted = settings.isMuted || !effectiveHasMic;
  const presenceStatus = normalizeUserStatus(currentStatus);
  const customStatus = user.custom_status?.trim() ?? "";
  const statusWord = STATUS_WORD[presenceStatus];
  const statusSummary = customStatus
    ? `${currentStatusLabel}: ${customStatus}`
    : currentStatusLabel;
  /* The line under the name (STATUS_WORD): a custom status when one is set
   * and the column has room (Geist, it is a sentence: it ellipsizes), else the
   * state as an LED label that only shows whole words. Its own LED is dropped:
   * the avatar's presence notch sits right beside it. */
  const statusLine = (
    <>
      {customStatus ? (
        <span
          className={cn(
            "hidden min-w-0 truncate font-sans leading-4 text-ink-2",
            CUSTOM_STATUS_SHOWN,
          )}
          style={
            nameplateTheme ? { color: nameplateTheme.buttonText } : undefined
          }
        >
          <InlineEmojiText text={customStatus} />
        </span>
      ) : null}
      <LedLabel
        state={PRESENCE_LED[presenceStatus]}
        led={false}
        className={cn("max-w-full", customStatus && CUSTOM_STATUS_REPLACES)}
        style={
          nameplateTheme ? { color: nameplateTheme.buttonText } : undefined
        }
      >
        <span className={cn("hidden", statusWord.full)}>
          {currentStatusLabel}
        </span>
        {statusWord.short ? (
          <span className={cn("hidden", statusWord.shortAt)}>
            {statusWord.short}
          </span>
        ) : null}
      </LedLabel>
    </>
  );
  /* The line shows from the width its shortest content fits; below that the
   * name sits alone, centred on the avatar. */
  const statusLineShown = customStatus
    ? cn(statusWord.line, "@min-[54px]:block")
    : statusWord.line;

  /* Over a nameplate image the controls take the nameplate's ink (computed
   * per image for contrast); muted keeps the danger tint with an ink that
   * reads on the nameplate's tone. */
  const nameplateInk = (muted: boolean) =>
    nameplateTheme
      ? {
          color: muted
            ? nameplateTheme.isLightAccent
              ? "var(--muted-state)"
              : "color-mix(in oklab, var(--muted-state) 35%, white)"
            : nameplateTheme.buttonText,
        }
      : undefined;
  const caretStyle = (open: boolean) =>
    nameplateTheme
      ? {
          color: open ? nameplateTheme.buttonText : nameplateTheme.buttonMuted,
        }
      : undefined;

  const settingsUserId = voiceSettingsUserId ?? user?.id;
  const toggleMic = () => {
    if (!effectiveHasMic) return;
    // In a call, route through the call's toggle (it plays the sounds).
    const callToggle = useCallVoiceStore.getState().toggleMic;
    if (callActive && callToggle) callToggle();
    // In a voice channel, the session's toggle keeps the live track in step.
    else if (voiceConnected && onToggleMic) onToggleMic();
    else setIsMuted(!settings.isMuted, settingsUserId);
  };
  const toggleDeafen = () => {
    const callToggle = useCallVoiceStore.getState().toggleDeafen;
    if (callActive && callToggle) callToggle();
    else if (voiceConnected && onToggleDeafen) onToggleDeafen();
    else setIsDeafened(!settings.isDeafened, settingsUserId);
  };

  const micLabel = !effectiveHasMic
    ? "No microphone detected"
    : settings.isMuted
      ? "Unmute"
      : "Mute";
  const deafenLabel = settings.isDeafened ? "Undeafen" : "Deafen";

  const caret = (mode: "input" | "output") => {
    const open = activeDeviceMenu === mode;
    const label = mode === "input" ? "Input device" : "Output device";
    return (
      <div className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              ref={mode === "input" ? micCaretRef : headphoneCaretRef}
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setActiveDeviceMenu(open ? null : mode)}
              className={cn(
                PRESS,
                HIT,
                CARET,
                open
                  ? "bg-tint-2 text-ink-1"
                  : "text-ink-3 pointer-fine:hover:text-ink-1",
              )}
              style={caretStyle(open)}
            >
              <Icon name="chevronDown" size="xs" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
        {open && (
          <Suspense fallback={null}>
            <AudioDeviceMenu
              mode={mode}
              anchorRef={mode === "input" ? micCaretRef : headphoneCaretRef}
              onClose={() => setActiveDeviceMenu(null)}
              onOpenVoiceSettings={() => {
                openSettings("voice");
              }}
            />
          </Suspense>
        )}
      </div>
    );
  };

  return (
    <div
      data-account-panel=""
      className="relative mt-auto flex w-full shrink-0 flex-col border-t border-line bg-ply-1"
    >
      {/* Call strip: only during a call, above the account row (an active
          DM call takes precedence over a channel). */}
      {voiceConnected && !callActive && (
        <div className="relative z-10">
          <VoiceDashboard
            serverName={serverName}
            voiceChannelName={voiceChannelName}
            connectionState={
              connectionStateOverride ?? session.connectionState ?? "connected"
            }
            startedAt={channelStartedAt ?? session.joinedAt}
            onRetry={retryFromStrip}
            collapsed={channelStageOnScreen}
            onVoiceDisconnect={onVoiceDisconnect}
            onVoiceNavigate={onVoiceNavigate}
            isScreenSharing={isScreenSharing}
            isStreamingAudio={isStreamingAudio}
            screenQuality={screenQuality}
            currentScreenSource={currentScreenSource}
            availableQualities={availableQualities}
            onShareScreen={() => setIsVcScreenModalOpen(true)}
            onStopStreaming={onStopStreaming}
            onToggleStreamAudio={onToggleStreamAudio}
            onChangeStreamSource={onChangeStreamSource}
            onStreamQualityChange={onStreamQualityChange}
            isCameraActive={isCameraActive}
            hasCamera={hasCamera}
            onToggleCamera={onToggleCamera}
            sfu={sfu}
            voiceChannelId={voiceChannelId}
            gridItems={gridItems}
            watchersByStreamer={watchersByStreamer}
            spatialAudioState={spatialAudioState}
            onUpdateSpatialAudioState={onUpdateSpatialAudioState}
            voiceSettingsUserId={voiceSettingsUserId}
            localUserId={user.id}
            roomSlug={roomSlug}
            voiceSessionId={voiceSessionId}
            serverId={serverId}
            participantCapabilities={participantCapabilities}
            onOpenVoiceSettings={() => {
              openSettings("voice");
            }}
            onOpenActivities={onOpenActivities}
            onOpenSoundboard={onOpenSoundboard}
            showNoiseReductionShortcut
          />
          <UnifiedScreenShareModal
            isOpen={isVcScreenModalOpen}
            onClose={() => setIsVcScreenModalOpen(false)}
            onStart={(options) => {
              onStartScreenShare?.({
                ...options,
                changeSource: isScreenSharing,
              });
              setIsVcScreenModalOpen(false);
            }}
            availableQualities={availableQualities ?? SCREEN_SHARE_QUALITIES}
          />
        </div>
      )}

      {/* Active DM call strip (the same VoiceDashboard) */}
      <div className="relative z-10">
        <CallDashboardSection
          onOpenActivities={onOpenActivities}
          onOpenSoundboard={onOpenSoundboard}
          stageOnScreen={stageOnScreen}
        />
      </div>

      {/* Account row (spec §3 rule 1): identity, mic, deafen, settings. Always
          here, before and during a call, for muscle memory. 64px: a 40px
          square avatar, a Bricolage name over an LED status, 40px keys. */}
      <div
        className={cn(
          "group/user-panel-row relative z-10 flex h-16 items-center gap-1 pr-1 pl-3",
          hasNameplate && "isolate",
        )}
      >
        {hasNameplate && (
          <UserNameplateLayer
            user={user}
            alt={`${displayName} nameplate`}
            className="pointer-events-none z-0 opacity-[0.98]"
          />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              ref={setUserAvatarEl}
              className={cn(
                PRESS,
                "relative z-10 flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[2px] text-left outline-none focus-visible:outline-2 focus-visible:outline-focus",
                hasNameplate ? "[--hover-o:0.16]" : "[--hover-o:0.06]",
              )}
              onClick={() => setShowMenu((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={showMenu}
              aria-label={`${displayName}, ${userHandle}, ${statusSummary}. View user account`}
            >
              <span
                {...speakingAttr}
                className={cn(
                  "rm-speak relative z-10 flex size-10 shrink-0 items-center justify-center bg-tint-3 font-display-tuned text-[18px] leading-none font-extrabold text-ink-1",
                  // No clip: the presence notch hangs past the corner.
                  avatarShape(user.avatar_url && user.avatar_display, {
                    clip: false,
                  }),
                )}
              >
                <span className="absolute inset-0 flex items-center justify-center overflow-visible rounded-[inherit]">
                  {user.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(user.avatar_url)}
                      alt=""
                      display={user.avatar_display}
                    />
                  ) : (
                    getDisplayInitial(user)
                  )}
                </span>
                {/* Presence: an LED in a square cut out of the panel ply. */}
                <span
                  aria-hidden="true"
                  data-presence={presenceStatus}
                  className="absolute -right-0.5 -bottom-0.5 z-20 flex size-3.5 items-center justify-center rounded-[2px] bg-ply-1"
                >
                  <Led state={PRESENCE_LED[presenceStatus]} size={8} />
                </span>
              </span>
              {showIdentity && (
                <span className="@container relative block min-w-0 flex-1">
                  {/* The name only shows where ~4 letters and an ellipsis fit
                   * (a 48px column, sidebar 258+); narrower, the row is the
                   * avatar and keys, as at the 208px minimum. Never "J.". */}
                  <span className="hidden @min-[48px]:block">
                    <UserDisplayName
                      user={user}
                      className="block truncate font-display-tuned text-[15px] leading-5 font-bold text-ink-1"
                      minContrastRatio={hasNameplate ? 2.8 : undefined}
                    />
                    {showUsername ? (
                      /* Status, swapped for the handle while the row is hovered
                       * or holds focus: a transform, --dur-3, ease-out. */
                      <span
                        className={cn(
                          "relative hidden h-4 min-w-0 overflow-hidden text-ui-xs text-ink-3",
                          statusLineShown,
                        )}
                      >
                        <span className="flex h-4 min-w-0 items-center transition-transform duration-(--dur-3) ease-out pointer-fine:group-hover/user-panel-row:-translate-y-full group-focus-within/user-panel-row:-translate-y-full">
                          {statusLine}
                        </span>
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-full block truncate leading-4 transition-transform duration-(--dur-3) ease-out pointer-fine:group-hover/user-panel-row:-translate-y-full group-focus-within/user-panel-row:-translate-y-full"
                        >
                          {userHandle}
                        </span>
                      </span>
                    ) : (
                      <span className={cn("hidden", statusLineShown)}>
                        <span className="flex h-4 min-w-0 items-center text-ui-xs text-ink-3">
                          {statusLine}
                        </span>
                      </span>
                    )}
                  </span>
                </span>
              )}
            </button>
          </TooltipTrigger>
          {/* The full state (and custom status) the narrow line may drop. */}
          <TooltipContent side="top">
            View profile · <InlineEmojiText text={statusSummary} />
          </TooltipContent>
        </Tooltip>

        <div className="relative z-10 flex shrink-0 items-center">
          {/* Mic: a split button (toggle + input device caret) */}
          <div className="flex items-center">
            <DockButton
              size={40}
              quiet
              state={isMicMuted ? "muted" : "rest"}
              icon="mic"
              tooltip={micLabel}
              aria-pressed={isMicMuted}
              disabled={!effectiveHasMic}
              onClick={toggleMic}
              className={cn(nameplateTheme && !isMicMuted && "bg-transparent")}
              style={nameplateInk(isMicMuted)}
            />
            {caret("input")}
          </div>

          {/* Deafen: toggle + output device caret */}
          <div className="flex items-center">
            <DockButton
              size={40}
              quiet
              state={settings.isDeafened ? "muted" : "rest"}
              icon="deafen"
              tooltip={deafenLabel}
              aria-pressed={settings.isDeafened}
              onClick={toggleDeafen}
              className={cn(
                nameplateTheme && !settings.isDeafened && "bg-transparent",
              )}
              style={nameplateInk(settings.isDeafened)}
            />
            {caret("output")}
          </div>

          <IconButton
            icon="settings"
            size={40}
            variant="ghost"
            tooltip="User settings"
            style={nameplateInk(false)}
            onClick={() => {
              openSettings("account");
            }}
          />
        </div>
      </div>

      {/* User account popover */}
      {shouldRenderMenu && userAvatarEl && (
        <Suspense fallback={null}>
          <UserAccountPopover
            user={user}
            onClose={() => setShowMenu(false)}
            updateStatus={updateStatus}
            anchorEl={userAvatarEl}
            onOpenProfileEditor={openProfileEditor}
            isClosing={!showMenu}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <ProfileEditorModal
          open={showProfileEditor}
          onClose={() => setShowProfileEditor(false)}
        />
      </Suspense>
    </div>
  );
}
