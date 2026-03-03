

import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import DMSidebar from "@/components/chat/DMSidebar";
import InviteModal from "@/components/chat/InviteModal";
import ServerList from "@/components/chat/ServerList";
import ServerSettingsModal from "@/components/chat/ServerSettingsModal";
import UserPanel from "@/components/chat/UserPanel";
import UserProfileModal from "@/components/chat/UserProfileModal";
import VoiceChannelView from "@/components/chat/VoiceChannelView";
import { getDesktopToken } from "@/lib/desktop-auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { isTauri } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatActions, useChatState } from "@/stores/chat-store";
import { useUser } from "@clerk/tanstack-react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

/**
 * Update the browser URL without triggering Next.js navigation (no re-render).
 */
function silentPush(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(null, "", path);
  }
}


interface UIState {
  sidebarOpen: boolean;
  activeModal: 'none' | 'invite' | 'settings';
  showMembers: boolean;
  showVoiceTextChat: boolean;
  pendingJump: { channelId: string; messageId: string } | null;
}

type UIAction =
  | { type: 'SET_SIDEBAR'; open: boolean }
  | { type: 'OPEN_MODAL'; modal: 'invite' | 'settings' }
  | { type: 'CLOSE_MODAL' }
  | { type: 'TOGGLE_MEMBERS' }
  | { type: 'TOGGLE_VOICE_TEXT' }
  | { type: 'SET_VOICE_TEXT'; show: boolean }
  | { type: 'SET_PENDING_JUMP'; jump: { channelId: string; messageId: string } | null };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_SIDEBAR': return { ...state, sidebarOpen: action.open };
    case 'OPEN_MODAL': return { ...state, activeModal: action.modal };
    case 'CLOSE_MODAL': return { ...state, activeModal: 'none' };
    case 'TOGGLE_MEMBERS': return { ...state, showMembers: !state.showMembers };
    case 'TOGGLE_VOICE_TEXT': return { ...state, showVoiceTextChat: !state.showVoiceTextChat };
    case 'SET_VOICE_TEXT': return { ...state, showVoiceTextChat: action.show };
    case 'SET_PENDING_JUMP': return { ...state, pendingJump: action.jump };
    default: return state;
  }
}

export default function ChatPage() {
  const state = useChatState();
  const {
    loadServers,
    deleteMessage,
    editMessage,
    loadProfile,
    loadCurrentUser,
    loadChannels,
    loadMembers,
    loadReadStates,
    loadDmChannels,
    loadRelationships,
    markChannelRead,
    subscribeChannel,
    unsubscribeChannel,
    setProfileUser,
    dispatch,
  } = useChatActions();
  const { user } = useUser();


  const [ui, uiDispatch] = useReducer(uiReducer, {
    sidebarOpen: false,
    activeModal: 'none',
    showMembers: true,
    showVoiceTextChat: false,
    pendingJump: null
  });
  const { sidebarOpen, activeModal, showMembers, showVoiceTextChat, pendingJump } = ui;

  // ── Voice session persistence ────────────────────────────────────────
  // Track the voice channel the user actually joined (survives text navigation)
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voiceServerId, setVoiceServerId] = useState<string | null>(null);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const lastActiveChannels = useRef<Record<string, string>>({});

  // Disable native context menu globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("lastActiveChannels");
    if (saved) {
      try {
        lastActiveChannels.current = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse lastActiveChannels", e);
      }
    }
  }, []);

  // Streaming state (piped from VoiceChannelView to ChannelSidebar)
  const [localStreamState, setLocalStreamState] = useState<{
    isScreenSharing: boolean;
    isStreamingAudio: boolean;
    screenQuality: string;
    availableQualities: string[];
    toggleScreenShare: (options?: { quality?: string; withAudio?: boolean; changeSource?: boolean }) => void;
    toggleStreamAudio: () => void;
    isCameraActive: boolean;
    hasCamera: boolean;
    hasMicrophone: boolean;
    toggleCamera: () => void;
    handleLeave: () => void;
    openScreenShareModal: () => void;
    sfu: any;
  } | null>(null);

  // Parse URL slug once on mount — /chat, /chat/serverId, /chat/serverId/channelId
  const slug = typeof window !== 'undefined'
    ? window.location.pathname.split('/').filter(Boolean).slice(1)
    : [];
  const initializedRef = useRef(false);

  const activeServer = state.servers.find((s) => s.id === state.activeServerId);
  const isDmMode = state.activeServerId === "@me" || state.activeServerId === "%40me";
  const activeChannel = isDmMode
    ? null
    : state.channels.find((c) => c.id === state.activeChannelId);
  const isVoiceChannel = activeChannel?.channel_type === "voice";
  // For DMs, find the recipient name
  const activeDm = isDmMode
    ? state.dmChannels.find((d) => d.id === state.activeChannelId)
    : null;
  const channelDisplayName = isDmMode
    ? (activeDm?.recipient?.username ?? activeDm?.name ?? "")
    : (activeChannel?.name ?? "");

  // Calculate current user's total permissions for the active server
  const currentUserPermissions =
    state.members.find((m) => m.user.id === state.user?.id)?.roles?.reduce((total, r) => total | r.permissions, 0) ?? 0;
  const isOwnerOrAdmin = hasPermission(currentUserPermissions, PERMISSIONS.ADMINISTRATOR) || hasPermission(currentUserPermissions, PERMISSIONS.MANAGE_SERVER);

  // Resolve voice channel name for the dashboard
  const voiceChannelName = state.channels.find((c) => c.id === voiceChannelId)?.name ?? "Voice";
  const voiceServerName = state.servers.find((s) => s.id === voiceServerId)?.name ?? "Server";

  // ── 1. Load servers on mount ─────────────────────────────────────────
  // On desktop, wait for the Clerk token to be synced to localStorage
  // before making API calls (useClerkTokenSync runs in ChatGateway).
  const [desktopReady, setDesktopReady] = useState(!isTauri() || !!getDesktopToken());

  useEffect(() => {
    if (!isTauri() || desktopReady) return;
    const check = () => {
      if (getDesktopToken()) setDesktopReady(true);
    };
    const interval = setInterval(check, 200);
    return () => clearInterval(interval);
  }, [desktopReady]);

  useEffect(() => {
    if (!desktopReady) return;
    loadProfile();
    loadCurrentUser();
    loadServers();
    loadReadStates();
    loadDmChannels();
    loadRelationships();
  }, [desktopReady, loadProfile, loadCurrentUser, loadServers, loadReadStates, loadDmChannels, loadRelationships]);

  // ── 2. Sync Clerk user identity (avatar managed by loadCurrentUser) ──
  useEffect(() => {
    if (!user) return;
    // Only set avatar_url from Clerk if the store doesn't already have one
    // (i.e. before loadCurrentUser has resolved). Once loadCurrentUser sets the
    // D1 avatar, subsequent re-runs of this effect won't overwrite it.
    const existingAvatar = state.user?.avatar_url;
    const isR2Avatar = existingAvatar?.startsWith("/api/avatars/");

    const newUserState = {
      id: user.id,
      username:
        (user.unsafeMetadata?.displayName as string) ||
        user.fullName ||
        user.username ||
        "Guest",
      avatar_url: isR2Avatar ? existingAvatar : (existingAvatar ?? user.imageUrl),
      status: state.user?.status || (typeof window !== 'undefined' ? localStorage.getItem('user-status') as any : null) || "online",
      custom_status: state.user?.custom_status,
    };

    // Deep equality check to prevent infinite re-renders
    if (JSON.stringify(state.user) !== JSON.stringify(newUserState)) {
      dispatch({ type: "SET_USER", user: newUserState });
    }
  }, [user, state.user, dispatch]);

  // ── 3. Pick active server (from URL or fallback to first) ──────────
  useEffect(() => {
    if (initializedRef.current) return;

    // 1. Resolve intended server/channel from Slug OR Window Location
    let currentSlug = slug;
    if (currentSlug.length === 0 && typeof window !== 'undefined') {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts[0] === 'chat' && parts.length > 1) {
        currentSlug = parts.slice(1);
      }
    }

    const urlServer = currentSlug[0] ? decodeURIComponent(currentSlug[0]) : null;
    const urlChannel = currentSlug[1] ? decodeURIComponent(currentSlug[1]) : null;
    const isDM = urlServer === "@me" || urlServer === "%40me";
    const hasServers = state.servers.length > 0;

    // 2. Decide if we are ready to initialize
    let shouldInit = false;
    if (isDM) {
      // If we're on a DM route, we can init immediately (we don't strictly need servers list)
      shouldInit = true;
    } else if (urlServer) {
      // If we're on a specific server route, wait for that server to be in the list
      if (hasServers) shouldInit = true;
    } else {
      // We are on root /chat, wait for servers to load so we can pick the first one
      if (hasServers) shouldInit = true;
    }

    if (!shouldInit) return;

    // 3. Perform initialization
    initializedRef.current = true;
    console.log("[Chat:Init] Initializing with", { urlServer, urlChannel, isDM, hasServers });

    if (isDM) {
      const cachedId = lastActiveChannels.current["@me"];
      const targetId = urlChannel || (cachedId && state.dmChannels.some(d => d.id === cachedId) ? cachedId : null);
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetId });
    } else if (urlServer && state.servers.some(s => s.id === urlServer)) {
      const targetId = urlChannel || lastActiveChannels.current[urlServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: urlServer, channelId: targetId });
    } else if (hasServers) {
      const firstServer = state.servers[0].id;
      const targetId = lastActiveChannels.current[firstServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: firstServer, channelId: targetId });
    }
  }, [state.servers, slug, dispatch]);

  // ── 4. Load channels + members when server changes ──────────────────
  useEffect(() => {
    if (!state.activeServerId || state.activeServerId === "@me") return;
    loadChannels(state.activeServerId);
    loadMembers(state.activeServerId);
  }, [state.activeServerId, loadChannels, loadMembers]);

  // 5. Auto-select channel once channels load ───────────────────────
  const channelsLoadedForServer = useRef<string | null>(null);
  useEffect(() => {
    if (
      !state.activeServerId ||
      state.activeServerId === "@me" || // NEVER auto-select server channels in DM mode
      state.channels.length === 0 ||
      state.activeChannelId // already have one
    ) return;
    // Guard: only do this once per server
    if (channelsLoadedForServer.current === state.activeServerId) return;
    channelsLoadedForServer.current = state.activeServerId;

    // If hint exists, try to use it
    const lastId = lastActiveChannels.current[state.activeServerId];
    if (lastId && state.channels.some((c) => c.id === lastId)) {
      dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: lastId });
      return;
    }

    const firstText = state.channels.find((c) => c.channel_type === "text");
    if (firstText) {
      dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: firstText.id });
    }
  }, [state.channels, state.activeServerId, state.activeChannelId, dispatch]);

  // Sync last active channel ref
  useEffect(() => {
    if (state.activeServerId && state.activeChannelId) {
      lastActiveChannels.current[state.activeServerId] = state.activeChannelId;
      localStorage.setItem("lastActiveChannels", JSON.stringify(lastActiveChannels.current));
    }
  }, [state.activeServerId, state.activeChannelId]);

  // Fallback if active channel disappears (e.g., VIEW_CHANNELS permission revoked)
  useEffect(() => {
    if (state.activeServerId && state.activeServerId !== "@me" && state.activeChannelId) {
      if (state.channels.length > 0 && !state.channels.some(c => c.id === state.activeChannelId)) {
        const firstText = state.channels.find(c => c.channel_type === "text");
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: firstText ? firstText.id : null });
      }
    }
  }, [state.channels, state.activeServerId, state.activeChannelId, dispatch]);

  // ── 6. Sync URL silently when state changes ─────────────────────────
  useEffect(() => {
    if (!state.activeServerId) return;
    const path = state.activeChannelId
      ? `/chat/${state.activeServerId}/${state.activeChannelId}`
      : `/chat/${state.activeServerId}`;
    silentPush(path);
  }, [state.activeServerId, state.activeChannelId]);

  // ── 7. Subscribe to all channels in the active server for unread indicators ──
  // ── 7. Subscribe to all visible channels for real-time unread indicators ──
  const subscribedChannelsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state.activeServerId) return;

    // Channels we should be listening to: either server channels or DM channels
    const channelsToWatch = isDmMode ? state.dmChannels : state.channels;
    const currentIds = new Set(channelsToWatch.map((c) => c.id));

    // 1. Unsubscribe from channels no longer in view
    for (const id of Array.from(subscribedChannelsRef.current)) {
      if (!currentIds.has(id)) {
        unsubscribeChannel(id);
        subscribedChannelsRef.current.delete(id);
      }
    }

    // 2. Subscribe to new channels
    for (const id of Array.from(currentIds)) {
      if (!subscribedChannelsRef.current.has(id)) {
        subscribeChannel(id);
        subscribedChannelsRef.current.add(id);
      }
    }
  }, [state.activeServerId, state.channels, state.dmChannels, isDmMode, subscribeChannel, unsubscribeChannel]);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleSelectServer = (serverId: string) => {
    if (serverId === state.activeServerId) return;

    if (serverId === "@me") {
      const lastDmId = lastActiveChannels.current["@me"];
      const targetDmId = lastDmId && state.dmChannels.some(d => d.id === lastDmId)
        ? lastDmId
        : (state.dmChannels.length > 0 ? state.dmChannels[0].id : null);
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetDmId });
      return;
    }

    channelsLoadedForServer.current = null;
    const lastId = lastActiveChannels.current[serverId];

    // Switch both atomically to prevent URL flickering
    dispatch({ type: "SWITCH_SERVER", serverId, channelId: lastId || null });
  };

  const handleSelectChannel = useCallback((channelId: string, options?: { isJump?: boolean }) => {
    if (channelId === state.activeChannelId) {
      if (!options?.isJump) {
        uiDispatch({ type: 'SET_PENDING_JUMP', jump: null });
      }
      return;
    }
    dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
    markChannelRead(channelId);
    uiDispatch({ type: 'SET_SIDEBAR', open: false });

    if (!options?.isJump) {
      uiDispatch({ type: 'SET_VOICE_TEXT', show: false });
      uiDispatch({ type: 'SET_PENDING_JUMP', jump: null });
    }
  }, [state.activeChannelId, dispatch, markChannelRead]);

  // Listen for navigate-channel events from SearchPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const channelId = typeof detail === 'string' ? detail : detail.channelId;
      const messageId = typeof detail === 'object' ? detail.messageId : null;

      if (channelId) {
        const targetChannel = state.channels.find(c => c.id === channelId);
        const isTargetVoice = targetChannel?.channel_type === 'voice';

        if (messageId) {
          uiDispatch({ type: 'SET_PENDING_JUMP', jump: { channelId, messageId } });
          if (isTargetVoice) {
            uiDispatch({ type: 'SET_VOICE_TEXT', show: true });
          }
        }

        handleSelectChannel(channelId, { isJump: !!messageId });

        // If same channel and jumping, trigger immediate jump event
        if (messageId && channelId === state.activeChannelId) {
          const event = new CustomEvent('jump-to-message', {
            detail: { channelId, messageId }
          });
          window.dispatchEvent(event);
        }
      }
    };
    window.addEventListener('navigate-channel', handler);
    return () => window.removeEventListener('navigate-channel', handler);
  }, [handleSelectChannel, state.channels, state.activeChannelId]);

  const handleToggleVoiceTextChat = useCallback(() => uiDispatch({ type: 'TOGGLE_VOICE_TEXT' }), []);

  const onVoiceJoin = useCallback(() => {
    // When we join, record WHICH channel we are in so we can persist it
    setVoiceChannelId(state.activeChannelId);
    setVoiceServerId(state.activeServerId);
    setVoiceJoined(true);
  }, [state.activeChannelId, state.activeServerId]);

  const onVoiceLeave = useCallback(() => {
    setVoiceJoined(false);
    setVoiceChannelId(null);
    setVoiceServerId(null);
    setLocalStreamState(null);
  }, []);

  // Determine if we should show the voice view as the active content
  const showVoiceAsMain = !!(isVoiceChannel && state.activeChannelId && state.activeServerId);
  // Determine if we should keep voice alive in the background (user navigated away to text but still in call)
  const voiceInBackground = voiceJoined && voiceChannelId && voiceServerId && !showVoiceAsMain;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-rm-bg-primary">
      {/* OS-level Title Bar (Mock Discord Topbar) */}
      <div className="flex h-6 w-full shrink-0 flex-row items-center justify-between bg-rm-bg-secondary px-2 border-b border-rm-border/30 drag-region">
        <div className="flex items-center gap-2 no-drag ml-1">
          <button
            onClick={() => window.history.back()}
            className="flex h-4 w-4 items-center justify-center rounded-sm text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="flex h-4 w-4 items-center justify-center rounded-sm text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="flex text-[12px] font-bold tracking-wider text-rm-text-muted select-none items-center gap-1.5 justify-center flex-1">
          {activeServer && (
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rm-bg-elevated text-[9px] font-bold text-rm-text overflow-hidden">
              {activeServer.icon_url ? (
                <img src={activeServer.icon_url} alt="" className="h-full w-full object-cover" />
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
        <div className="z-50 flex w-[72px] shrink-0 flex-col items-center overflow-y-auto bg-rm-bg-floating scrollbar-none">
          <ServerList
            servers={state.servers}
            activeServerId={state.activeServerId}
            onSelect={handleSelectServer}
            channels={state.channels}
            readStates={state.readStates}
            lastMessageAt={state.lastMessageAt}
          />
        </div>

        {/* Mobile overlay */}
        <div
          className={`fixed inset-0 z-[99] bg-black/50 transition-opacity duration-300 ${sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            } md:hidden`}
          onClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: false })}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") uiDispatch({ type: 'SET_SIDEBAR', open: false }); }}
          role="presentation"
          aria-hidden="true"
        />

        {/* Channel sidebar */}
        <div
          className={`flex w-60 h-full shrink-0 flex-col overflow-hidden bg-rm-sidebar font-sans max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[100] max-md:w-60 max-md:shadow-2xl max-md:transition-transform max-md:duration-300 ${sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
            }`}
        >
          {isDmMode ? (
            <DMSidebar
              activeChannelId={state.activeChannelId}
              onSelectDm={(channelId) => {
                dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
                uiDispatch({ type: 'SET_SIDEBAR', open: false });
              }}
            />
          ) : state.activeServerId ? (
            <ChannelSidebar
              channels={state.channels}
              categories={state.categories}
              activeChannelId={state.activeChannelId}
              serverId={state.activeServerId}
              serverName={activeServer?.name ?? "Server"}
              onSelect={handleSelectChannel}
              onInviteClick={() => uiDispatch({ type: 'OPEN_MODAL', modal: 'invite' })}
              onSettingsClick={() => uiDispatch({ type: 'OPEN_MODAL', modal: 'settings' })}
              readStates={state.readStates}
              lastMessageAt={state.lastMessageAt}
              voiceChannelStates={state.voiceChannelStates}
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
          {(voiceJoined || showVoiceAsMain) && (
            <div className={cn("flex min-h-0 flex-1", !showVoiceAsMain && "hidden")}>
              <VoiceChannelView
                channelId={(showVoiceAsMain ? state.activeChannelId : voiceChannelId)!}
                channelName={showVoiceAsMain ? channelDisplayName : voiceChannelName}
                serverId={(showVoiceAsMain ? state.activeServerId : voiceServerId)!}
                onToggleTextChat={handleToggleVoiceTextChat}
                showTextChat={showVoiceTextChat}
                onJoined={onVoiceJoin}
                onLeft={onVoiceLeave}
                onStreamStateUpdate={setLocalStreamState}
                autoJoin={showVoiceAsMain}
              />
              {showVoiceAsMain && showVoiceTextChat && (
                <div className="flex min-w-[320px] max-w-[40%] basis-[420px] flex-col border-l border-white/[0.06]">
                  <ChatArea
                    channelId={state.activeChannelId!}
                    channelName={channelDisplayName}
                    onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
                    showMembers={false}
                    isDM={isDmMode}
                    jumpToMessageId={pendingJump?.channelId === state.activeChannelId ? pendingJump.messageId : null}
                    onJumped={() => uiDispatch({ type: 'SET_PENDING_JUMP', jump: null })}
                    onClose={handleToggleVoiceTextChat}
                  />
                </div>
              )}
            </div>
          )}

          {/* Regular Chat Area: shown when not in full-screen voice, or as a sibling to voice if logic permits */}
          {!showVoiceAsMain && (
            <ChatArea
              channelId={state.activeChannelId}
              channelName={channelDisplayName}
              onMenuClick={() => uiDispatch({ type: 'SET_SIDEBAR', open: true })}
              onMembersClick={state.activeServerId && !isDmMode ? () => uiDispatch({ type: 'TOGGLE_MEMBERS' }) : undefined}
              showMembers={showMembers}
              isDM={isDmMode}
              jumpToMessageId={pendingJump?.channelId === state.activeChannelId ? pendingJump.messageId : null}
              onJumped={() => uiDispatch({ type: 'SET_PENDING_JUMP', jump: null })}
            />
          )}
        </div>


        {/* Floating UI anchoring over the navbars */}
        <div className="absolute bottom-0 left-0 z-[120] w-[312px] pointer-events-none p-0 flex justify-start items-end">
          <div className="pointer-events-auto w-full">
            <UserPanel
              user={state.user}
              serverName={voiceServerName}
              voiceConnected={voiceJoined}
              voiceChannelId={voiceChannelId}
              voiceChannelName={voiceChannelName}
              onVoiceDisconnect={() => {
                if (localStreamState) {
                  localStreamState.handleLeave();
                } else {
                  // Fallback if component is already unmounted
                  setVoiceJoined(false);
                  setVoiceChannelId(null);
                  setVoiceServerId(null);
                }
              }}
              onVoiceNavigate={() => {
                if (voiceChannelId) {
                  handleSelectChannel(voiceChannelId);
                }
              }}
              // Streaming props
              isScreenSharing={localStreamState?.isScreenSharing}
              isStreamingAudio={localStreamState?.isStreamingAudio}
              screenQuality={localStreamState?.screenQuality}
              availableQualities={localStreamState?.availableQualities}
              onStopStreaming={() => localStreamState?.toggleScreenShare()}
              onToggleStreamAudio={() => localStreamState?.toggleStreamAudio()}
              onChangeStreamSource={() => {
                if (localStreamState?.isScreenSharing) {
                  localStreamState.toggleScreenShare({ changeSource: true });
                } else {
                  localStreamState?.openScreenShareModal();
                }
              }}
              onStreamQualityChange={(q: string) => localStreamState?.toggleScreenShare({ quality: q })}
              isCameraActive={localStreamState?.isCameraActive}
              hasCamera={localStreamState?.hasCamera}
              hasMicrophone={localStreamState?.hasMicrophone}
              onToggleCamera={() => localStreamState?.toggleCamera()}
              sfu={localStreamState?.sfu ?? null}
            />
          </div>
        </div>

        {activeModal === 'invite' && state.activeServerId && activeServer && (
          <InviteModal
            serverId={state.activeServerId}
            serverName={activeServer.name}
            onClose={() => uiDispatch({ type: 'CLOSE_MODAL' })}
          />
        )}

        {activeModal === 'settings' && state.activeServerId && activeServer && (
          <ServerSettingsModal
            key={activeServer.name}
            serverId={state.activeServerId}
            serverName={activeServer.name}
            iconUrl={activeServer.icon_url ?? null}
            userPermissions={currentUserPermissions}
            onClose={() => uiDispatch({ type: 'CLOSE_MODAL' })}
            onUpdated={(updates) => {
              dispatch({
                type: "UPDATE_SERVER",
                serverId: state.activeServerId!,
                updates,
              });
            }}
            onDeleted={() => {
              dispatch({
                type: "REMOVE_SERVER",
                serverId: state.activeServerId!,
              });
              uiDispatch({ type: 'CLOSE_MODAL' });
              silentPush("/chat");
            }}
          />
        )}

        {state.profileUser && (
          <UserProfileModal
            user={state.profileUser}
            onClose={() => setProfileUser(null)}
          />
        )}
      </div>
    </div>
  );
}
