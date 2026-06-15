import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import DMSidebar from "@/components/chat/DMSidebar";
import FriendsView from "@/components/chat/FriendsView";
import ServerList from "@/components/chat/ServerList";
import UserPanel from "@/components/chat/UserPanel";
import { silentPush, useChatPageLogic } from "@/components/chat/useChatPageLogic";
import { shouldShowStartCallModal, shouldShowVoiceSwitchModal } from "@/components/chat/voice-confirmation-preferences";
import { useBackButton } from "@/hooks/useBackButton";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAuthAssetUrl } from "@/lib/platform";
import { onSoundInteractionNeeded, resumeSoundContext } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { syncDesktopNotificationState } from "@/lib/desktop-native-sync";
import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

const AudioInteractionModal = lazy(() =>
  import("@/components/voice/AudioInteractionModal").then((mod) => ({ default: mod.AudioInteractionModal }))
);
const CallVoiceManager = lazy(() =>
  import("@/components/chat/CallVoiceManager").then((mod) => ({ default: mod.CallVoiceManager }))
);
const IncomingCallModal = lazy(() =>
  import("@/components/chat/IncomingCallModal").then((mod) => ({ default: mod.IncomingCallModal }))
);
const InviteModal = lazy(() => import("@/components/chat/InviteModal"));
const ServerSettingsModal = lazy(() => import("@/components/chat/ServerSettingsModal"));
const StartCallModal = lazy(() =>
  import("@/components/chat/StartCallModal").then((mod) => ({ default: mod.StartCallModal }))
);
const UserProfileModal = lazy(() => import("@/components/chat/UserProfileModal"));
const VoiceChannelView = lazy(() => import("@/components/chat/VoiceChannelView"));
const VoiceSwitchModal = lazy(() =>
  import("@/components/chat/VoiceSwitchModal").then((mod) => ({ default: mod.VoiceSwitchModal }))
);
const VoiceAppsModal = lazy(() =>
  import("@/components/chat/VoiceAppsModal").then((mod) => ({ default: mod.VoiceAppsModal }))
);
const VoiceSoundboardManager = lazy(() =>
  import("@/components/chat/VoiceSoundboardManager").then((mod) => ({ default: mod.VoiceSoundboardManager }))
);

export default function ChatPage() {
  const {
    servers, activeServerId, activeChannelId, channels, categories,
    members, user, readStates, lastMessageAt, voiceChannelStates,
    dmChannels, profileUser, serverMentionCounts, channelMentionCounts, relationships, notifications,
  } = useChatStore(useShallow(s => ({
    servers: s.servers,
    activeServerId: s.activeServerId,
    activeChannelId: s.activeChannelId,
    channels: s.channels,
    categories: s.categories,
    members: s.members,
    user: s.user,
    readStates: s.readStates,
    lastMessageAt: s.lastMessageAt,
    voiceChannelStates: s.voiceChannelStates,
    dmChannels: s.dmChannels,
    profileUser: s.profileUser,
    serverMentionCounts: s.serverMentionCounts,
    channelMentionCounts: s.channelMentionCounts,
    relationships: s.relationships,
    notifications: s.notifications,
  })));
  const { dispatch, markChannelRead, markNotificationsRead } = useChatActions();

  const {
    ui,
    uiDispatch,
    voiceState,
    setVoiceState,
    localStreamState,
    setLocalStreamState,
    handleSelectServer,
    handleSelectChannel,
    handleToggleVoiceTextChat,
    onVoiceJoin,
    onVoiceLeave,
    isDmMode,
    setProfileUser,
  } = useChatPageLogic();

  // ── Unified audio interaction modal ──────────────────────────────────────
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [voiceAppsModal, setVoiceAppsModal] = useState<null | "activities" | "soundboard">(null);
  useEffect(() => {
    onSoundInteractionNeeded(() => setShowAudioModal(true));
    return () => onSoundInteractionNeeded(null);
  }, []);

  const { sidebarOpen, activeModal, showMembers, showVoiceTextChat, voiceJoinOnSelectChannelId, pendingJump } = ui;

  const activeServer = useMemo(() => servers.find((s) => s.id === activeServerId), [servers, activeServerId]);
  const activeChannel = useMemo(
    () => isDmMode ? null : channels.find((c) => c.id === activeChannelId),
    [isDmMode, channels, activeChannelId]
  );
  const isVoiceChannel = activeChannel?.channel_type === "voice";

  const activeDm = useMemo(
    () => isDmMode ? dmChannels.find((d) => d.id === activeChannelId) : null,
    [isDmMode, dmChannels, activeChannelId]
  );
  const channelDisplayName = isDmMode
    ? (activeDm?.recipient?.display_name ?? activeDm?.recipient?.username ?? activeDm?.name ?? "")
    : (activeChannel?.name ?? "");
  const channelUsername = isDmMode
    ? (activeDm?.recipient?.username ?? "")
    : undefined;

  const currentUserPermissions = useMemo(
    () => members.find((m) => m.user.id === user?.id)?.roles?.reduce((total, r) => total | r.permissions, 0) ?? 0,
    [members, user?.id]
  );

  const voiceChannelName = voiceState.channelName ?? "Voice";
  const voiceServerName = useMemo(
    () => servers.find((s) => s.id === voiceState.serverId)?.name ?? "Server",
    [servers, voiceState.serverId]
  );

  const callActive = useCallStore((s) => s.status === "active");
  const isViewingCurrentVoiceChannel = voiceState.joined && voiceState.channelId === activeChannelId;
  const showVoiceAsMain = !!(isVoiceChannel && activeChannelId && activeServerId && !callActive) &&
    (!voiceState.joined || isViewingCurrentVoiceChannel);
  const shouldAutoJoinVoice = !!showVoiceAsMain && voiceJoinOnSelectChannelId === activeChannelId;

  // ── Voice Switch Confirmation ─────────────────────────────────────────────
  // When a user is already in a voice channel or call and tries to join/switch
  // to another, we show a confirmation modal before proceeding.
  type PendingSwitch =
    | { type: "voice"; channelId: string; channelName: string; doJoin: () => void }
    | { type: "call"; action: () => void };
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const pendingSwitchRef = useRef(pendingSwitch);
  useEffect(() => {
    pendingSwitchRef.current = pendingSwitch;
  }, [pendingSwitch]);

  /** True when the user is currently in an active voice session (VC or call) */
  const isInVoiceSession = voiceState.joined || callActive;

  const leaveCurrentVoiceSession = useCallback(() => {
    if (callActive) {
      useCallStore.getState().endCall("switched");
    }

    if (voiceState.joined && localStreamState) {
      localStreamState.handleLeave();
    }
  }, [callActive, localStreamState, voiceState.joined]);

  /**
   * Wraps `handleSelectChannel` — if the target is a voice channel and we are
   * already in a voice session, shows a confirmation modal first.
   */
  const guardedSelectChannel = useCallback((channelId: string) => {
    const targetChannel = channels.find((c) => c.id === channelId);
    const isTargetVoice = targetChannel?.channel_type === "voice";

    // Only guard voice-channel targets while already in a voice session
    if (isTargetVoice && isInVoiceSession) {
      // Don't prompt if switching to the same channel we're already in
      if (voiceState.channelId === channelId) {
        handleSelectChannel(channelId);
        return;
      }

      if (shouldShowVoiceSwitchModal()) {
        setPendingSwitch({
          type: "voice",
          channelId,
          channelName: targetChannel?.name ?? "Voice",
          doJoin: () => handleSelectChannel(channelId),
        });
      } else {
        leaveCurrentVoiceSession();
        handleSelectChannel(channelId);
      }
      return;
    }

    handleSelectChannel(channelId);
  }, [channels, isInVoiceSession, voiceState.channelId, handleSelectChannel, leaveCurrentVoiceSession]);

  /**
   * Wraps the call initiation — if the user is in a voice session, shows
   * a confirmation modal first.
   */
  const guardedCallInitiate = useCallback((action: () => void) => {
    if (isInVoiceSession && shouldShowVoiceSwitchModal()) {
      setPendingSwitch({ type: "call", action });
      return;
    }
    action();
  }, [isInVoiceSession]);

  const handleSwitchConfirm = useCallback(() => {
    const ps = pendingSwitchRef.current;
    if (!ps) return;
    setPendingSwitch(null);

    if (ps.type === "voice") {
      leaveCurrentVoiceSession();
      ps.doJoin();
    } else {
      ps.action();
    }
  }, [leaveCurrentVoiceSession]);

  const handleSwitchCancel = useCallback(() => {
    setPendingSwitch(null);
  }, []);

  // ── Start Call confirmation modal ─────────────────────────────────────────
  // Context menus fire `request-start-call` events → we show a confirmation.
  type PendingCallTarget = { userId: string; displayName: string; channelId: string };
  const [pendingCallTarget, setPendingCallTarget] = useState<PendingCallTarget | null>(null);

  const executeStartCall = useCallback((target: PendingCallTarget) => {
    const doCall = () => {
      prewarmAudioContext();
      resumeSoundContext();
      // Leave current voice channel if needed
      if (voiceState.joined && localStreamState) {
        localStreamState.handleLeave();
      }
      const gateway = useChatStore.getState().gateway;
      gateway?.sendCallInitiate(target.userId, target.channelId);
    };

    // If already in a voice session, use the switch guard
    if (isInVoiceSession && shouldShowVoiceSwitchModal()) {
      setPendingSwitch({ type: "call", action: doCall });
    } else {
      doCall();
    }
  }, [voiceState.joined, localStreamState, isInVoiceSession]);

  const executeStartCallRef = useRef(executeStartCall);
  useEffect(() => {
    executeStartCallRef.current = executeStartCall;
  }, [executeStartCall]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PendingCallTarget;
      if (!detail) return;

      // Check for skip-confirmation preference
      if (!shouldShowStartCallModal()) {
        // Execute immediately (still guard voice session)
        executeStartCallRef.current(detail);
        return;
      }
      setPendingCallTarget(detail);
    };
    window.addEventListener("request-start-call", handler);
    return () => window.removeEventListener("request-start-call", handler);
  }, []);

  const handleCallConfirm = useCallback(() => {
    const target = pendingCallTarget;
    setPendingCallTarget(null);
    if (target) executeStartCall(target);
  }, [pendingCallTarget, executeStartCall]);

  const handleCallCancel = useCallback(() => {
    setPendingCallTarget(null);
  }, []);

  // Compute homepage badge: unread DMs + pending friend requests
  const unreadDms = useMemo(() => {
    // Build per-DM unread notification counts
    const dmNotifCounts: Record<string, number> = {};
    for (const n of notifications) {
      if (n.is_read) continue;
      if (!n.server_id) {
        dmNotifCounts[n.channel_id] = (dmNotifCounts[n.channel_id] ?? 0) + 1;
      }
    }
    const dms: Array<{ channelId: string; recipient: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }; unreadCount: number }> = [];
    for (const dm of dmChannels) {
      const lastMsg = lastMessageAt[dm.id];
      if (!lastMsg) continue;
      const lastRead = readStates[dm.id];
      if (!lastRead || lastMsg > lastRead) {
        dms.push({
          channelId: dm.id,
          recipient: dm.recipient,
          unreadCount: dmNotifCounts[dm.id] ?? 1,
        });
      }
    }
    return dms;
  }, [dmChannels, readStates, lastMessageAt, notifications]);

  const pendingFriendCount = useMemo(() => relationships.filter((r) => r.type === 2).length, [relationships]);
  // Home badge: only count overflow DMs (beyond the 3 visible avatars) + pending friend requests
  const homeBadgeCount = Math.max(0, unreadDms.length - 3) + pendingFriendCount;

  useEffect(() => {
    const unreadServerChannelIds = channels
      .filter((channel) => channel.channel_type !== "dm")
      .filter((channel) => {
        const lastMsg = lastMessageAt[channel.id];
        const lastRead = readStates[channel.id];
        return !!lastMsg && (!lastRead || lastMsg > lastRead);
      })
      .map((channel) => channel.id);

    void syncDesktopNotificationState({
      notifications,
      unreadDmChannelIds: unreadDms.map((dm) => dm.channelId),
      unreadServerChannelIds,
    });
  }, [channels, lastMessageAt, notifications, readStates, unreadDms]);

  const onSelectDm = useCallback((channelId: string) => {
    // Switch to @me mode first if not already there, then select the DM channel
    if (activeServerId !== "@me") {
      handleSelectServer("@me");
    }
    dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
    // Mark any notifications for this DM channel as read
    const dmNotifIds = notifications
      .filter((n) => n.channel_id === channelId && !n.is_read)
      .map((n) => n.id);
    if (dmNotifIds.length > 0) {
      markNotificationsRead(dmNotifIds);
    }
    uiDispatch({ type: 'SET_SIDEBAR', open: false });
  }, [activeServerId, handleSelectServer, dispatch, uiDispatch, markChannelRead, markNotificationsRead, notifications]);
  useBackButton(
    useCallback(() => {
      // Hardware back button behavior for the base layer (behind all modals/panels).
      // If we are on desktop, don't intercept standard back behavior (browser back).
      if (window.innerWidth >= 768) {
        return false;
      }

      if (sidebarOpen) {
        // If we are ON the sidebar, we want the back button to exit the application.
        // Return false to NOT consume the event, letting Tauri (or the browser) exit.
        return false;
      } else {
        // If we are in the main chat area (sidebar closed), pressing back should open the sidebar.
        uiDispatch({ type: 'SET_SIDEBAR', open: true });
        return true; // Consume event
      }
    }, [sidebarOpen, uiDispatch]),
    true // Always register this base handler
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-rm-bg-primary">
      {/* OS-level Title Bar (Mock Discord Topbar) */}
      <div
        className="hidden md:flex w-full shrink-0 flex-row items-center justify-between bg-rm-bg-secondary px-2 border-b border-rm-border/30 drag-region"
        style={{ height: 'calc(24px + var(--safe-area-top, 0px))', paddingTop: 'var(--safe-area-top, 0px)' }}
      >
        <div className="flex items-center gap-2 no-drag ml-1">
          <button
            onClick={() => window.history.back()}
            className="hidden md:flex h-4 w-4 items-center justify-center rounded-sm text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="hidden md:flex h-4 w-4 items-center justify-center rounded-sm text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="flex text-[12px] font-bold tracking-wider text-rm-text-muted select-none items-center gap-1.5 justify-center flex-1">
          {activeServer && (
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rm-bg-elevated text-[9px] font-bold text-rm-text overflow-hidden">
              {activeServer.icon_url ? (
                <img src={getAuthAssetUrl(activeServer.icon_url)} alt="" className="h-full w-full object-cover" />
              ) : (
                activeServer.name.charAt(0).toUpperCase()
              )}
            </div>
          )}
          {activeServer?.name ?? "Ralph Meet"}
        </div>
        <div className="flex w-12" /> {/* Spacer for symmetry */}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Server icon strip */}
        <div className={`z-50 flex w-[72px] shrink-0 flex-col items-center overflow-y-auto bg-rm-bg-floating scrollbar-none max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[110] max-md:transition-transform max-md:duration-300 ${sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}>
          <ServerList
            servers={servers}
            activeServerId={activeServerId}
            activeChannelId={activeChannelId}
            onSelect={handleSelectServer}
            channels={channels}
            readStates={readStates}
            lastMessageAt={lastMessageAt}
            serverMentionCounts={serverMentionCounts}
            homeBadgeCount={homeBadgeCount}
            unreadDms={unreadDms}
            onSelectDm={onSelectDm}
            onMarkServerRead={(serverId) => {
              // Mark all channels in this server as read
              const serverChannels = channels.filter((c) => c.server_id === serverId);
              for (const ch of serverChannels) {
                const lastMsg = lastMessageAt[ch.id];
                const lastRead = readStates[ch.id];
                if (lastMsg && (!lastRead || lastMsg > lastRead)) {
                  markChannelRead(ch.id);
                }
              }
              // Mark server notifications as read
              const serverNotifIds = notifications
                .filter((n) => n.server_id === serverId && !n.is_read)
                .map((n) => n.id);
              if (serverNotifIds.length > 0) {
                markNotificationsRead(serverNotifIds);
              }
            }}
            onMarkAllRead={() => {
              markNotificationsRead();
              // Mark all channels as read
              for (const ch of channels) {
                const lastMsg = lastMessageAt[ch.id];
                const lastRead = readStates[ch.id];
                if (lastMsg && (!lastRead || lastMsg > lastRead)) {
                  markChannelRead(ch.id);
                }
              }
              for (const dm of dmChannels) {
                const lastMsg = lastMessageAt[dm.id];
                const lastRead = readStates[dm.id];
                if (lastMsg && (!lastRead || lastMsg > lastRead)) {
                  markChannelRead(dm.id);
                }
              }
            }}
          />
        </div>

        {/* Mobile overlay */}
        <div
          className={`fixed inset-0 z-[104] bg-black/50 transition-opacity duration-300 ${sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            } md:hidden`}
          onClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: false })}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") uiDispatch({ type: 'SET_SIDEBAR', open: false }); }}
          role="presentation"
          aria-hidden="true"
        />

        {/* Channel sidebar */}
        <div
          className={`flex w-60 h-full shrink-0 flex-col overflow-hidden bg-rm-sidebar font-sans max-md:fixed max-md:inset-y-0 max-md:left-[72px] max-md:z-[105] max-md:w-[calc(100vw-72px)] max-md:max-w-72 max-md:shadow-2xl max-md:transition-transform max-md:duration-300 ${sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-[calc(100%+72px)]"
            }`}
        >
          {isDmMode ? (
            <DMSidebar
              activeChannelId={activeChannelId}
              onSelectDm={(channelId) => {
                dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
                uiDispatch({ type: 'SET_SIDEBAR', open: false });
              }}
              onShowFriends={() => {
                dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: null });
              }}
            />
          ) : activeServerId ? (
            <ChannelSidebar
              channels={channels}
              categories={categories}
              activeChannelId={activeChannelId}
              serverId={activeServerId}
              serverName={activeServer?.name ?? "Server"}
              currentUserId={user?.id ?? null}
              onSelect={guardedSelectChannel}
              onInviteClick={() => uiDispatch({ type: 'OPEN_MODAL', modal: 'invite' })}
              onSettingsClick={() => uiDispatch({ type: 'OPEN_MODAL', modal: 'settings' })}
              readStates={readStates}
              lastMessageAt={lastMessageAt}
              voiceChannelStates={voiceChannelStates}
              localVoiceChannelId={voiceState.channelId}
              localVoiceConnected={voiceState.joined}
              channelMentionCounts={channelMentionCounts}
              canReorder={hasPermission(currentUserPermissions, PERMISSIONS.MANAGE_CHANNELS) || hasPermission(currentUserPermissions, PERMISSIONS.ADMINISTRATOR)}
              canManageChannels={hasPermission(currentUserPermissions, PERMISSIONS.MANAGE_CHANNELS) || hasPermission(currentUserPermissions, PERMISSIONS.ADMINISTRATOR)}
            />
          ) : (
            <div className="flex w-60 flex-1 flex-col border-r border-rm-border bg-rm-sidebar">
              <div className="p-4 text-[13px] text-white/40">
                Select a server to get started
              </div>
            </div>
          )}

        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 bg-rm-bg-primary overflow-hidden relative">
          {/* Unified Voice Session: survives navigation by staying mounted (hidden when not active) */}
          {(voiceState.joined || showVoiceAsMain) && (
            <div className={cn("flex min-h-0 flex-1", !showVoiceAsMain && "hidden")}>
              <Suspense fallback={null}>
                <VoiceChannelView
                  key={`persistent-voice-session-${showVoiceAsMain ? activeServerId : voiceState.serverId}-${showVoiceAsMain ? activeChannelId : voiceState.channelId}`}
                  channelId={(showVoiceAsMain ? activeChannelId : voiceState.channelId)!}
                  channelName={showVoiceAsMain ? channelDisplayName : voiceChannelName}
                  serverId={(showVoiceAsMain ? activeServerId : voiceState.serverId)!}
                  onToggleTextChat={handleToggleVoiceTextChat}
                  showTextChat={showVoiceTextChat}
                  onOpenActivities={() => setVoiceAppsModal("activities")}
                  onJoined={onVoiceJoin}
                  onLeft={onVoiceLeave}
                  onStreamStateUpdate={setLocalStreamState}
                  autoJoin={shouldAutoJoinVoice}
                  onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                />
              </Suspense>
              {showVoiceAsMain && showVoiceTextChat && (
                <div className="relative flex min-w-[320px] max-w-[40%] basis-[420px] flex-col border-l border-white/6">
                  <ChatArea
                    key={`voice-${activeChannelId}`}
                    channelId={activeChannelId!}
                    channelName={channelDisplayName}
                    onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                    showMembers={false}
                    isDM={isDmMode}
                    jumpToMessageId={pendingJump?.channelId === activeChannelId ? pendingJump.messageId : null}
                    onJumped={() => uiDispatch({ type: 'SET_PENDING_JUMP', jump: null })}
                    onClose={handleToggleVoiceTextChat}
                  />
                </div>
              )}
            </div>
          )}

          {/* Regular Chat/Friends Area: shown when not in full-screen voice */}
          {!showVoiceAsMain && (
            isDmMode && !activeChannelId ? (
              <FriendsView
                onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                onSelectDm={onSelectDm}
              />
            ) : isVoiceChannel && activeChannelId && activeServerId ? (
              /* Voice channel selected but not the "main" view (e.g. already in another VC or in a call) */
              <Suspense fallback={null}>
                <VoiceChannelView
                  key={`ephemeral-vc-${activeChannelId}`}
                  channelId={activeChannelId}
                  channelName={channelDisplayName}
                  serverId={activeServerId}
                  onToggleTextChat={handleToggleVoiceTextChat}
                  showTextChat={showVoiceTextChat}
                  onOpenActivities={() => setVoiceAppsModal("activities")}
                  onJoined={onVoiceJoin}
                  onLeft={onVoiceLeave}
                  onStreamStateUpdate={setLocalStreamState}
                  autoJoin={false}
                  onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                  onBeforeJoin={isInVoiceSession ? (doJoin) => {
                    if (shouldShowVoiceSwitchModal()) {
                      setPendingSwitch({
                        type: "voice",
                        channelId: activeChannelId!,
                        channelName: channelDisplayName,
                        doJoin,
                      });
                      return;
                    }

                    const leaveThenJoin = () => {
                      if (callActive) {
                        const cs = useCallStore.getState();
                        cs.endCall("switched");
                      }

                      if (voiceState.joined && localStreamState) {
                        localStreamState.handleLeave();
                      }

                      doJoin();
                    };

                    leaveThenJoin();
                  } : undefined}
                />
              </Suspense>
            ) : (
              <ChatArea
                key={activeChannelId}
                channelId={activeChannelId}
                channelName={channelDisplayName}
                onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                onMembersClick={() => uiDispatch({ type: 'TOGGLE_MEMBERS' })}
                showMembers={showMembers}
                isDM={isDmMode}
                jumpToMessageId={pendingJump?.channelId === activeChannelId ? pendingJump.messageId : null}
                onJumped={() => uiDispatch({ type: 'SET_PENDING_JUMP', jump: null })}
                onInviteClick={activeServerId && !isDmMode ? () => uiDispatch({ type: 'OPEN_MODAL', modal: 'invite' }) : undefined}
                serverId={activeServerId}
                onCall={isDmMode && activeDm?.recipient?.id && activeChannelId ? () => {
                  // Prewarm AudioContext during this user gesture
                  prewarmAudioContext();
                  resumeSoundContext();

                  // If there's already an active call for this DM channel, rejoin instead of starting a new one
                  const callState = useCallStore.getState();
                  if (callState.status === "active" && callState.channelId === activeChannelId) {
                    // Rejoin the existing call SFU
                    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
                    callState.joinSFU();
                    return;
                  }

                  const doCall = () => {
                    // Mutual exclusion: leave voice channel before calling
                    if (voiceState.joined && localStreamState) {
                      localStreamState.handleLeave();
                    }
                    const gateway = useChatStore.getState().gateway;
                    if (gateway && activeDm?.recipient?.id && activeChannelId) {
                      gateway.sendCallInitiate(activeDm.recipient.id, activeChannelId);
                    }
                  };

                  // Guard with confirmation if already in a voice session
                  guardedCallInitiate(doCall);
                } : undefined}
                dmUsername={isDmMode ? channelUsername : undefined}
              />
            )
          )}
        </div>


        {/* Floating UI anchoring over the navbars */}
        <div className={`absolute bottom-0 left-0 z-[120] w-[312px] pointer-events-none p-0 flex justify-start items-end max-md:fixed max-md:w-[min(calc(100vw),360px)] max-md:transition-transform max-md:duration-300 ${sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}>
          <div className="pointer-events-auto w-full">
            <UserPanel
              user={user}
              serverId={voiceState.serverId ?? activeServerId}
              serverName={voiceServerName}
              voiceConnected={voiceState.joined}
              voiceChannelId={voiceState.channelId}
              voiceChannelName={voiceChannelName}
              onVoiceDisconnect={() => {
                if (localStreamState) {
                  localStreamState.handleLeave();
                } else {
                  // SFU/hook not fully initialized yet — dispatch the same
                  // event that useVoiceChannel listens for so it can clean up
                  // the gateway presence + any partial SFU state.
                  window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
                  // Also reset local UI state in case the hook wasn't mounted
                  onVoiceLeave();
                }
              }}
              onVoiceNavigate={() => {
                if (voiceState.channelId && voiceState.serverId) {
                  // Switch to the voice channel's server first (handles being on @me/DM page)
                  if (activeServerId !== voiceState.serverId) {
                    dispatch({ type: "SWITCH_SERVER", serverId: voiceState.serverId, channelId: voiceState.channelId });
                  } else {
                    handleSelectChannel(voiceState.channelId);
                  }
                }
              }}
              // Streaming props
              isScreenSharing={localStreamState?.isScreenSharing}
              isStreamingAudio={localStreamState?.isStreamingAudio}
              screenQuality={localStreamState?.screenQuality}
              currentScreenSource={localStreamState?.currentScreenSource}
              availableQualities={localStreamState?.availableQualities}
              onStopStreaming={() => localStreamState?.toggleScreenShare()}
              onToggleStreamAudio={() => localStreamState?.toggleStreamAudio()}
              onChangeStreamSource={() => {
                localStreamState?.openScreenShareModal();
              }}
              onStartScreenShare={({ quality, withAudio, sourceId, captureId, sourceName, sourceKind }) =>
                localStreamState?.toggleScreenShare({ quality, withAudio, sourceId, captureId, sourceName, sourceKind, changeSource: true })
              }
              onStreamQualityChange={(q: string) => localStreamState?.toggleScreenShare({ quality: q })}
              isCameraActive={localStreamState?.isCameraActive}
              hasCamera={localStreamState?.hasCamera}
              hasMicrophone={localStreamState?.hasMicrophone}
              onToggleCamera={() => localStreamState?.toggleCamera()}
              sfu={localStreamState?.sfu ?? null}
              gridItems={localStreamState?.gridItems ?? []}
              spatialAudioState={localStreamState?.spatialAudioState}
              onUpdateSpatialAudioState={localStreamState?.updateSharedSpatialAudioState}
              voiceSettingsUserId={localStreamState?.settingsUserId}
              onOpenActivities={() => setVoiceAppsModal("activities")}
              onOpenSoundboard={() => setVoiceAppsModal("soundboard")}
            />
          </div>
        </div>

        {(localStreamState?.sfu ?? null) && (
          <Suspense fallback={null}>
            <VoiceSoundboardManager
              sfu={localStreamState?.sfu ?? null}
              serverId={voiceState.serverId ?? activeServerId}
              localUserId={user?.id}
            />
          </Suspense>
        )}

        {voiceAppsModal && (
          <Suspense fallback={null}>
            <VoiceAppsModal
              key={voiceAppsModal}
              isOpen={!!voiceAppsModal}
              initialTab={voiceAppsModal}
              onClose={() => setVoiceAppsModal(null)}
              sfu={localStreamState?.sfu ?? null}
              serverId={voiceState.serverId ?? activeServerId}
              channelId={localStreamState?.channelId ?? voiceState.channelId}
              localUserId={user?.id}
              gridItems={localStreamState?.gridItems ?? []}
            />
          </Suspense>
        )}

        {activeModal === 'invite' && activeServerId && activeServer && (
          <Suspense fallback={null}>
            <InviteModal
              serverId={activeServerId}
              serverName={activeServer.name}
              onClose={() => uiDispatch({ type: 'CLOSE_MODAL' })}
            />
          </Suspense>
        )}

        {activeModal === 'settings' && activeServerId && activeServer && (
          <Suspense fallback={null}>
            <ServerSettingsModal
              key={activeServer.name}
              serverId={activeServerId}
              ownerId={activeServer.owner_id}
              serverName={activeServer.name}
              iconUrl={activeServer.icon_url ?? null}
              allowPublicShares={activeServer.allow_public_shares ?? true}
              showSourceInShares={activeServer.show_source_in_shares ?? false}
              allowShareIndexing={activeServer.allow_share_indexing ?? false}
              userPermissions={currentUserPermissions}
              onClose={() => uiDispatch({ type: 'CLOSE_MODAL' })}
              onUpdated={(updates) => {
                dispatch({
                  type: "UPDATE_SERVER",
                  serverId: activeServerId!,
                  updates,
                });
              }}
              onDeleted={() => {
                dispatch({
                  type: "REMOVE_SERVER",
                  serverId: activeServerId!,
                });
                uiDispatch({ type: 'CLOSE_MODAL' });
                silentPush("/chat");
              }}
            />
          </Suspense>
        )}

        {profileUser && (
          <Suspense fallback={null}>
            <UserProfileModal
              user={profileUser}
              onClose={() => setProfileUser(null)}
            />
          </Suspense>
        )}

        {showAudioModal && (
          <Suspense fallback={null}>
            <AudioInteractionModal
              onInteract={() => {
                prewarmAudioContext();
                resumeSoundContext();
                setShowAudioModal(false);
              }}
              onClose={() => setShowAudioModal(false)}
            />
          </Suspense>
        )}

        {/* Call Modals + SFU Manager */}
        <Suspense fallback={null}>
          <CallVoiceManager />
          <IncomingCallModal />
        </Suspense>


        {/* Voice Switch Confirmation */}
        {!!pendingSwitch && (
          <Suspense fallback={null}>
            <VoiceSwitchModal
              open
              targetName={
                pendingSwitch.type === "voice"
                  ? pendingSwitch.channelName
                  : activeDm?.recipient?.display_name ?? activeDm?.recipient?.username ?? "call"
              }
              currentType={callActive ? "call" : "voice"}
              onConfirm={handleSwitchConfirm}
              onCancel={handleSwitchCancel}
            />
          </Suspense>
        )}

        {/* Start Call Confirmation */}
        {!!pendingCallTarget && (
          <Suspense fallback={null}>
            <StartCallModal
              open
              targetName={pendingCallTarget.displayName}
              onConfirm={handleCallConfirm}
              onCancel={handleCallCancel}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
