import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { AvatarImage } from "@/components/chat/AvatarImage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getCachedCollectiblesCatalog,
  subscribeCollectiblesCatalog,
} from "@/lib/collectibles-catalog-client";
import { OPEN_PROFILE_EDITOR_EVENT } from "@/lib/profile-editor-events";
import { useUserResolution } from "@/hooks/useUserResolution";
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
import { ChevronDown, Headphones, Mic, MicOff, Settings } from "./Icons";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { UserDisplayName } from "./UserDisplayName";
import { UserNameplateLayer } from "./UserNameplateLayer";
import { getUserNameplatePresentation } from "./user-nameplate-presentation";

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
const SettingsModal = lazy(() => import("@/components/chat/SettingsModal"));
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

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
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
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    "account" | "voice" | "shares" | "appearance"
  >("account");
  const [settingsStartInProfileEditor, setSettingsStartInProfileEditor] =
    useState(false);
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

  const shouldRenderMenu = useDelayUnmount(showMenu, 200);
  const shouldRenderSettings = useDelayUnmount(showSettings, 200);

  const settings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(user?.id)),
  );
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const callActive = useCallStore((s) => s.status) === "active";
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
    (tab: "account" | "voice" | "shares" | "appearance" = "account") => {
      setSettingsStartInProfileEditor(false);
      setSettingsInitialTab(tab);
      setShowSettings(true);
    },
    [],
  );

  const openProfileEditor = useCallback(() => {
    setSettingsInitialTab("account");
    setSettingsStartInProfileEditor(true);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    const handleOpenShares = () => {
      openSettings("shares");
    };
    window.addEventListener("open-shared-messages-settings", handleOpenShares);
    return () => {
      window.removeEventListener(
        "open-shared-messages-settings",
        handleOpenShares,
      );
    };
  }, [openSettings]);

  useEffect(() => {
    const handleOpenProfileEditor = () => {
      openProfileEditor();
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
  const userHandle = user.username ? `@${user.username}` : displayName;
  const hasNameplate = nameplatePresentation.hasNameplate;
  const nameplateTheme = nameplatePresentation.theme;
  const nameplateDangerColor =
    hasNameplate && nameplateTheme
      ? nameplateTheme.isLightAccent
        ? "#991B1B"
        : "#FECACA"
      : undefined;

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="mt-auto flex shrink-0 flex-col relative overflow-hidden bg-rm-bg-elevated border border-white/5 rounded-lg m-2 shadow-lg"
        style={{ marginBottom: "calc(8px + var(--safe-area-bottom, 0px))" }}
      >
        {/* VOICE CONNECTED dashboard (hidden when active call takes precedence) */}
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

        {/* ACTIVE CALL dashboard (reuses VoiceDashboard) */}
        <div className="relative z-10">
          <CallDashboardSection
            onOpenActivities={onOpenActivities}
            onOpenSoundboard={onOpenSoundboard}
          />
        </div>

        {/* User Info Bar */}
        <div
          className={cn(
            "flex items-center gap-2 p-1.5 relative z-10 overflow-hidden",
            !showIdentity && "gap-1.5",
            hasNameplate && "isolate",
            (voiceConnected || callActive) && "border-t border-white/5",
          )}
          style={
            hasNameplate && nameplateTheme
              ? {
                  boxShadow: `inset 0 1px 0 ${nameplateTheme.rowBorder}, 0 0 0 1px ${nameplateTheme.rowBorder}, 0 14px 28px ${nameplateTheme.rowGlow}`,
                }
              : undefined
          }
        >
          {hasNameplate && (
            <>
              <UserNameplateLayer
                user={user}
                alt={`${displayName} nameplate`}
                className="pointer-events-none z-0 opacity-[0.98]"
              />
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                ref={setUserAvatarEl}
                className="group relative z-10 cursor-pointer border-0 bg-transparent p-0 pl-0.5 outline-none"
                onClick={() => setShowMenu((v) => !v)}
                aria-label="View user account"
              >
                <div
                  className={cn(
                    "relative z-10 flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground transition-all opacity-90 group-hover:opacity-100",
                    speakingUsers[user.id] &&
                      cn(
                        "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] ring-offset-2",
                        hasNameplate
                          ? "ring-offset-black"
                          : "ring-offset-rm-bg-elevated",
                      ),
                  )}
                >
                  <div className="absolute inset-0 overflow-visible rounded-full flex items-center justify-center">
                    {user.avatar_url ? (
                      <AvatarImage
                        src={getAuthAssetUrl(user.avatar_url)}
                        alt={displayName}
                        display={user.avatar_display}
                      />
                    ) : (
                      getDisplayInitial(user)
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 z-20 h-3.5 w-3.5 rounded-full border-2 transition-colors",
                    statusColors[currentStatus],
                    "border-rm-bg-elevated",
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={12}
              className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
            >
              <p>View Profile</p>
            </TooltipContent>
          </Tooltip>

          {showIdentity ? (
            <div
              className={cn(
                "relative z-10 min-w-0 flex-1 py-1 cursor-pointer group/name rounded-[12px] px-2 -ml-1 transition-colors",
                hasNameplate ? "hover:bg-white/10" : "hover:bg-rm-bg-hover/50",
              )}
            >
              <div className="relative min-w-0">
                <UserDisplayName
                  user={user}
                  className="block truncate text-[13px] font-bold leading-tight text-rm-text-primary"
                  minContrastRatio={hasNameplate ? 2.8 : undefined}
                />
                {showUsername && (
                  <p className="truncate text-[11px] leading-tight text-rm-text-muted">
                    {userHandle}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1" aria-hidden="true" />
          )}

          <div className="relative z-10 flex items-center -mr-1">
            {/* Mic Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (effectiveHasMic) {
                        // Route through callVoice.toggleMic when in a call (includes sound effects)
                        const callToggle =
                          useCallVoiceStore.getState().toggleMic;
                        if (callActive && callToggle) {
                          callToggle();
                        } else {
                          setIsMuted(!settings.isMuted);
                        }
                      }
                    }}
                    disabled={!effectiveHasMic}
                    className={cn(
                      "rounded-[10px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      settings.isMuted || !effectiveHasMic
                        ? hasNameplate
                          ? "text-red-300 hover:text-red-200"
                          : "text-destructive hover:bg-rm-bg-hover"
                        : hasNameplate
                          ? "text-rm-text-primary/85 hover:text-rm-text-primary"
                          : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                      !effectiveHasMic && "cursor-not-allowed",
                    )}
                    style={
                      hasNameplate && nameplateTheme
                        ? {
                            color:
                              settings.isMuted || !effectiveHasMic
                                ? nameplateDangerColor
                                : nameplateTheme.buttonText,
                          }
                        : undefined
                    }
                  >
                    {settings.isMuted || !effectiveHasMic ? (
                      <MicOff size={18} />
                    ) : (
                      <Mic size={18} className="group-hover:animate-wiggle" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
                  <p>
                    {!effectiveHasMic
                      ? "No microphone detected"
                      : settings.isMuted
                        ? "Unmute"
                        : "Mute"}
                  </p>
                </TooltipContent>
              </Tooltip>

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={micCaretRef}
                      onClick={() =>
                        setActiveDeviceMenu(
                          activeDeviceMenu === "input" ? null : "input",
                        )
                      }
                      className={cn(
                        "rounded-[10px] p-0.5 transition-all outline-none mr-0.5 group",
                        activeDeviceMenu === "input"
                          ? hasNameplate
                            ? "text-rm-text-primary"
                            : "text-rm-text-muted bg-rm-bg-hover"
                          : hasNameplate
                            ? "text-rm-text-muted hover:text-rm-text-primary"
                            : "text-rm-text-muted/80 dark:text-rm-text-muted/60 hover:text-rm-text",
                      )}
                      style={
                        hasNameplate && nameplateTheme
                          ? {
                              color:
                                activeDeviceMenu === "input"
                                  ? nameplateTheme.buttonText
                                  : nameplateTheme.buttonMuted,
                            }
                          : undefined
                      }
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={12}
                    className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                  >
                    <p>Input Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === "input" && (
                  <Suspense fallback={null}>
                    <AudioDeviceMenu
                      mode="input"
                      anchorRef={micCaretRef}
                      onClose={() => setActiveDeviceMenu(null)}
                      onOpenVoiceSettings={() => {
                        openSettings("voice");
                      }}
                    />
                  </Suspense>
                )}
              </div>
            </div>

            {/* Headphones Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      // Route through callVoice.toggleDeafen when in a call (includes sound effects)
                      const callToggle =
                        useCallVoiceStore.getState().toggleDeafen;
                      if (callActive && callToggle) {
                        callToggle();
                      } else {
                        setIsDeafened(!settings.isDeafened);
                      }
                    }}
                    className={cn(
                      "rounded-[10px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      settings.isDeafened
                        ? hasNameplate
                          ? "text-red-300 hover:text-red-200"
                          : "text-destructive hover:bg-rm-bg-hover"
                        : hasNameplate
                          ? "text-rm-text-primary/85 hover:text-rm-text-primary"
                          : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                    )}
                    style={
                      hasNameplate && nameplateTheme
                        ? {
                            color: settings.isDeafened
                              ? nameplateDangerColor
                              : nameplateTheme.buttonText,
                          }
                        : undefined
                    }
                  >
                    <Headphones
                      size={18}
                      className="group-hover:animate-clack"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={12}
                  className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                >
                  <p>{settings.isDeafened ? "Undeafen" : "Deafen"}</p>
                </TooltipContent>
              </Tooltip>

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={headphoneCaretRef}
                      onClick={() =>
                        setActiveDeviceMenu(
                          activeDeviceMenu === "output" ? null : "output",
                        )
                      }
                      className={cn(
                        "rounded-[10px] p-0.5 transition-all outline-none mr-0.5 group",
                        activeDeviceMenu === "output"
                          ? hasNameplate
                            ? "text-rm-text-primary"
                            : "text-rm-text-muted bg-rm-bg-hover"
                          : hasNameplate
                            ? "text-rm-text-muted hover:text-rm-text-primary"
                            : "text-rm-text-muted/80 dark:text-rm-text-muted/60 hover:text-rm-text",
                      )}
                      style={
                        hasNameplate && nameplateTheme
                          ? {
                              color:
                                activeDeviceMenu === "output"
                                  ? nameplateTheme.buttonText
                                  : nameplateTheme.buttonMuted,
                            }
                          : undefined
                      }
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={12}
                    className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
                  >
                    <p>Output Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === "output" && (
                  <Suspense fallback={null}>
                    <AudioDeviceMenu
                      mode="output"
                      anchorRef={headphoneCaretRef}
                      onClose={() => setActiveDeviceMenu(null)}
                      onOpenVoiceSettings={() => {
                        openSettings("voice");
                      }}
                    />
                  </Suspense>
                )}
              </div>
            </div>

            {/* Settings */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    openSettings("account");
                  }}
                  className={cn(
                    "rounded-[8px] p-1.5 transition-all outline-none flex items-center justify-center group",
                    hasNameplate
                      ? "text-rm-text-primary/85 hover:text-rm-text-primary"
                      : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                  )}
                  style={
                    hasNameplate && nameplateTheme
                      ? {
                          color: nameplateTheme.buttonText,
                        }
                      : undefined
                  }
                >
                  <Settings
                    size={18}
                    className="transition-transform duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] group-hover:rotate-90"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={12}
                className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
              >
                <p>User Settings</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* User Account Popover */}
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
        {/* Settings Modal */}
        {shouldRenderSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              initialTab={settingsInitialTab}
              initialProfileEditorOpen={settingsStartInProfileEditor}
              onClose={() => {
                setShowSettings(false);
                setSettingsStartInProfileEditor(false);
                setSettingsInitialTab("account"); // reset for next open
              }}
              isClosing={!showSettings}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}
