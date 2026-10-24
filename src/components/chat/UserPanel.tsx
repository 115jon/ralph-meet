import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { AvatarImage } from "@/components/chat/AvatarImage";
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
import { UserStatusDot } from "./UserStatusDot";

const EMPTY_QUALITIES: string[] = [];
const EMPTY_GRID_ITEMS: any[] = [];
const EMPTY_WATCHERS_BY_STREAMER: StreamWatchersByStreamer = {};
const SCREEN_SHARE_QUALITIES = getAvailableStreamQualities();
const TAILWIND_SPACING_UNIT_PX = 4;
const USER_PANEL_USERNAME_HIDE_WIDTH_PX = TAILWIND_SPACING_UNIT_PX * 56;
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
  sfu?: any;
  gridItems?: any[];
  watchersByStreamer?: StreamWatchersByStreamer;
  spatialAudioState?: SharedSpatialAudioState;
  onUpdateSpatialAudioState?: (state: SharedSpatialAudioState) => void;
  voiceSettingsUserId?: string;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
  sidebarWidthPx?: number;
}

/**
 * Device caret beside mic / deafen: a 16px-wide half of a split button. HIT
 * still gives it a 44px target on touch.
 */
const CARET =
  "inline-flex h-8 w-4 shrink-0 items-center justify-center rounded-sm outline-none";

const statusLabels: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Invisible",
};

function CallDashboardSection({
  onOpenActivities,
  onOpenSoundboard,
}: {
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
}) {
  const callStatus = useCallStore((s) => s.status);
  const callChannelId = useCallStore((s) => s.channelId);
  const remoteUser = useCallStore((s) => s.remoteUser);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);

  // SFU state from the call voice store
  const sfu = useCallVoiceStore((s) => s.sfu);
  const isScreenSharing = useCallVoiceStore((s) => s.isScreenSharing);
  const isStreamingAudio = useCallVoiceStore((s) => s.isStreamingAudio);
  const screenQuality = useCallVoiceStore((s) => s.screenQuality);
  const currentScreenSource = useCallVoiceStore((s) => s.currentScreenSource);
  const isCameraActive = useCallVoiceStore((s) => s.isCameraActive);
  const hasCamera = useCallVoiceStore((s) => s.hasCamera);
  const hasMicrophone = useCallVoiceStore((s) => s.hasMicrophone);
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
        serverName={
          activeRemoteUser.displayName || activeRemoteUser.username || "Call"
        }
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
        hasMicrophone={hasMicrophone}
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
}: Props) {
  const { updateStatus } = useChatActions();
  const speakingUsers = useChatStore((s) => s.speakingUsers);
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

  const settings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(user?.id)),
  );
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const callActive = useCallStore((s) => s.status) === "active";
  const hasVoiceDashboard = voiceConnected || callActive;
  const participantCapabilities = useMemo(() => {
    const vcMembers = voiceChannelId
      ? (useChatStore.getState().voiceChannelStates[voiceChannelId] ?? [])
      : [];
    return Object.fromEntries(
      (gridItems ?? []).map((item: any) => {
        const member = vcMembers.find(
          (m: any) => m.clerk_user_id === item.userId,
        );
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

  /* Over a nameplate image the controls take the nameplate's ink (computed
   * per image for contrast); muted keeps the danger tint with an ink that
   * reads on the nameplate's tone. */
  const nameplateInk = (muted: boolean) =>
    nameplateTheme
      ? {
          color: muted
            ? nameplateTheme.isLightAccent
              ? "var(--rm-danger)"
              : "color-mix(in oklab, var(--rm-danger) 35%, white)"
            : nameplateTheme.buttonText,
        }
      : undefined;
  const caretStyle = (open: boolean) =>
    nameplateTheme
      ? {
          color: open ? nameplateTheme.buttonText : nameplateTheme.buttonMuted,
        }
      : undefined;

  const toggleMic = () => {
    if (!effectiveHasMic) return;
    // In a call, route through the call's toggle (it plays the sounds).
    const callToggle = useCallVoiceStore.getState().toggleMic;
    if (callActive && callToggle) callToggle();
    else setIsMuted(!settings.isMuted);
  };
  const toggleDeafen = () => {
    const callToggle = useCallVoiceStore.getState().toggleDeafen;
    if (callActive && callToggle) callToggle();
    else setIsDeafened(!settings.isDeafened);
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
                  ? "bg-rm-tint-2 text-rm-text"
                  : "text-rm-text-muted pointer-fine:hover:text-rm-text",
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
    <div className="relative mt-auto flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-rm-border bg-rm-bg-elevated">
      {/* Voice channel dashboard (an active call takes precedence) */}
      {voiceConnected && !callActive && (
        <div className="relative z-10">
          <VoiceDashboard
            serverName={serverName}
            voiceChannelName={voiceChannelName}
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
            hasMicrophone={hasMicrophone}
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

      {/* Active DM call dashboard (reuses VoiceDashboard) */}
      <div className="relative z-10">
        <CallDashboardSection
          onOpenActivities={onOpenActivities}
          onOpenSoundboard={onOpenSoundboard}
        />
      </div>

      {/* Identity + controls row */}
      <div
        className={cn(
          "group/user-panel-row relative z-10 flex items-center gap-1 p-1.5",
          hasNameplate && "isolate",
          hasVoiceDashboard && "border-t border-rm-border",
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
                "relative z-10 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left outline-none",
                hasNameplate
                  ? "[--hover-o:0.16]"
                  : "pointer-fine:hover:bg-rm-tint-1 focus-visible:bg-rm-tint-1",
              )}
              onClick={() => setShowMenu((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={showMenu}
              aria-label={`${displayName}, ${userHandle}, ${currentStatusLabel}. View user account`}
            >
              <div
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-rm-tint-2 text-ui-xs font-semibold text-rm-text",
                  speakingUsers[user.id] &&
                    "ring-2 ring-rm-status-online ring-offset-2 ring-offset-rm-bg-elevated",
                )}
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-visible rounded-full">
                  {user.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(user.avatar_url)}
                      alt=""
                      display={user.avatar_display}
                    />
                  ) : (
                    getDisplayInitial(user)
                  )}
                </div>
                <UserStatusDot
                  status={currentStatus}
                  ring="bg-rm-bg-elevated"
                  className="absolute -right-0.5 -bottom-0.5 z-20 size-3.5"
                />
              </div>
              {showIdentity && (
                <div className="relative min-w-0 flex-1">
                  <UserDisplayName
                    user={user}
                    className="block truncate text-ui-sm font-semibold text-rm-text"
                    minContrastRatio={hasNameplate ? 2.8 : undefined}
                  />
                  {showUsername ? (
                    /* Status, swapped for the handle while the row is hovered
                     * or holds focus. A transform, 180ms, ease-out. */
                    <div className="relative h-4 overflow-hidden text-ui-xs text-rm-text-muted">
                      <span className="block truncate transition-transform duration-[180ms] ease-(--rm-ease-out) pointer-fine:group-hover/user-panel-row:-translate-y-full group-focus-within/user-panel-row:-translate-y-full motion-reduce:transition-none">
                        {currentStatusLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-full block truncate transition-transform duration-[180ms] ease-(--rm-ease-out) pointer-fine:group-hover/user-panel-row:-translate-y-full group-focus-within/user-panel-row:-translate-y-full motion-reduce:transition-none"
                      >
                        {userHandle}
                      </span>
                    </div>
                  ) : (
                    <p className="truncate text-ui-xs text-rm-text-muted">
                      {currentStatusLabel}
                    </p>
                  )}
                </div>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">View profile</TooltipContent>
        </Tooltip>

        <div className="relative z-10 flex shrink-0 items-center">
          {/* Mic: a split button (toggle + input device caret) */}
          <DockButton
            size="sm"
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

          {/* Deafen: toggle + output device caret */}
          <DockButton
            size="sm"
            quiet
            state={settings.isDeafened ? "muted" : "rest"}
            icon="deafen"
            tooltip={deafenLabel}
            aria-pressed={settings.isDeafened}
            onClick={toggleDeafen}
            className={cn(
              "ml-0.5",
              nameplateTheme && !settings.isDeafened && "bg-transparent",
            )}
            style={nameplateInk(settings.isDeafened)}
          />
          {caret("output")}

          <IconButton
            icon="settings"
            size="sm"
            variant="ghost"
            tooltip="User settings"
            className="ml-0.5"
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
