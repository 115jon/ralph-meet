import { getDesktopToken } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";

export function silentPush(path: string) {
  if (typeof window !== "undefined" && window.location.pathname !== path) {
    window.history.replaceState(null, "", path);
  }
}

export interface UIState {
  sidebarOpen: boolean;
  activeModal: "none" | "invite" | "settings";
  showMembers: boolean;
  showVoiceTextChat: boolean;
  pendingJump: { channelId: string; messageId: string } | null;
}

export type UIAction =
  | { type: "SET_SIDEBAR"; open: boolean }
  | { type: "OPEN_MODAL"; modal: "invite" | "settings" }
  | { type: "CLOSE_MODAL" }
  | { type: "TOGGLE_MEMBERS" }
  | { type: "SET_MEMBERS"; show: boolean }
  | { type: "TOGGLE_VOICE_TEXT" }
  | { type: "SET_VOICE_TEXT"; show: boolean }
  | { type: "SET_PENDING_JUMP"; jump: { channelId: string; messageId: string } | null };

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "SET_SIDEBAR": return { ...state, sidebarOpen: action.open };
    case "OPEN_MODAL": return { ...state, activeModal: action.modal };
    case "CLOSE_MODAL": return { ...state, activeModal: "none" };
    case "TOGGLE_MEMBERS": return { ...state, showMembers: !state.showMembers };
    case "SET_MEMBERS": return { ...state, showMembers: action.show };
    case "TOGGLE_VOICE_TEXT": return { ...state, showVoiceTextChat: !state.showVoiceTextChat };
    case "SET_VOICE_TEXT": return { ...state, showVoiceTextChat: action.show };
    case "SET_PENDING_JUMP": return { ...state, pendingJump: action.jump };
    default: return state;
  }
}

export function useChatPageLogic() {
  const { chatUser, servers, activeServerId, activeChannelId, channels: stateChannels, dmChannels } = useChatStore(useShallow(s => ({
    chatUser: s.user,
    servers: s.servers,
    activeServerId: s.activeServerId,
    activeChannelId: s.activeChannelId,
    channels: s.channels,
    dmChannels: s.dmChannels,
  })));
  const {
    loadServers,
    loadProfile,
    loadCurrentUser,
    loadChannels,
    loadMembers,
    loadReadStates,
    loadDmChannels,
    loadRelationships,
    loadNotifications,
    markChannelRead,
    subscribeChannel,
    unsubscribeChannel,
    subscribeServer,
    setProfileUser,
    dispatch,
  } = useChatActions();
  const { user } = useUser();

  const [ui, uiDispatch] = useReducer(uiReducer, {
    sidebarOpen: false,
    activeModal: "none",
    showMembers: true,
    showVoiceTextChat: false,
    pendingJump: null,
  });

  const [voiceState, setVoiceState] = useState({
    channelId: null as string | null,
    serverId: null as string | null,
    joined: false,
  });
  const lastActiveChannels = useRef<Record<string, string>>({});

  const [localStreamState, setLocalStreamState] = useState<any>(null);

  const slug = typeof window !== "undefined"
    ? window.location.pathname.split("/").filter(Boolean).slice(1)
    : [];
  const initializedRef = useRef(false);

  // Disable context menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", handleContextMenu);

    if (window.innerWidth < 1024) {
      uiDispatch({ type: "SET_MEMBERS", show: false });
    }

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

  const uiRef = useRef(ui);
  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

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
    loadNotifications();
  }, [desktopReady, loadProfile, loadCurrentUser, loadServers, loadReadStates, loadDmChannels, loadRelationships, loadNotifications]);

  useEffect(() => {
    if (!user) return;
    const existingAvatar = chatUser?.avatar_url;
    const isR2Avatar = existingAvatar?.startsWith("/api/avatars/");

    const newUserState = {
      id: user.id,
      username:
        (user.unsafeMetadata?.displayName as string) ||
        user.fullName ||
        user.username ||
        "Guest",
      avatar_url: isR2Avatar ? existingAvatar : (existingAvatar ?? user.imageUrl),
      status: chatUser?.status || (typeof window !== "undefined" ? localStorage.getItem("user-status") as any : null) || "online",
      custom_status: chatUser?.custom_status,
    };

    if (JSON.stringify(chatUser) !== JSON.stringify(newUserState)) {
      dispatch({ type: "SET_USER", user: newUserState });
    }
  }, [user, chatUser, dispatch]);

  useEffect(() => {
    if (initializedRef.current) return;

    let currentSlug = slug;
    if (currentSlug.length === 0 && typeof window !== "undefined") {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts[0] === "chat" && parts.length > 1) {
        currentSlug = parts.slice(1);
      }
    }

    const urlServer = currentSlug[0] ? decodeURIComponent(currentSlug[0]) : null;
    const urlChannel = currentSlug[1] ? decodeURIComponent(currentSlug[1]) : null;
    const isDM = urlServer === "@me" || urlServer === "%40me";
    const hasServers = servers.length > 0;

    let shouldInit = false;
    if (isDM) shouldInit = true;
    else if (urlServer) { if (hasServers) shouldInit = true; }
    else if (hasServers) shouldInit = true;

    if (!shouldInit) return;

    initializedRef.current = true;

    if (isDM) {
      const cachedId = lastActiveChannels.current["@me"];
      const targetId = urlChannel || (cachedId && dmChannels.some((d) => d.id === cachedId) ? cachedId : null);
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetId });
    } else if (urlServer && servers.some((s) => s.id === urlServer)) {
      const targetId = urlChannel || lastActiveChannels.current[urlServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: urlServer, channelId: targetId });
    } else if (hasServers) {
      const firstServer = servers[0].id;
      const targetId = lastActiveChannels.current[firstServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: firstServer, channelId: targetId });
    }
  }, [servers, slug, dispatch, dmChannels]);

  useEffect(() => {
    if (!activeServerId || activeServerId === "@me") return;
    loadChannels(activeServerId);
    loadMembers(activeServerId);
  }, [activeServerId, loadChannels, loadMembers]);

  const channelsLoadedForServer = useRef<string | null>(null);
  useEffect(() => {
    if (
      !activeServerId ||
      activeServerId === "@me" ||
      stateChannels.length === 0 ||
      activeChannelId
    ) return;
    if (channelsLoadedForServer.current === activeServerId) return;
    channelsLoadedForServer.current = activeServerId;

    const lastId = lastActiveChannels.current[activeServerId];
    if (lastId && stateChannels.some((c) => c.id === lastId)) {
      dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: lastId });
      return;
    }

    const firstText = stateChannels.find((c) => c.channel_type === "text");
    if (firstText) {
      dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: firstText.id });
    }
  }, [stateChannels, activeServerId, activeChannelId, dispatch]);

  useEffect(() => {
    if (activeServerId && activeChannelId) {
      lastActiveChannels.current[activeServerId] = activeChannelId;
      localStorage.setItem("lastActiveChannels", JSON.stringify(lastActiveChannels.current));
    }
  }, [activeServerId, activeChannelId]);

  useEffect(() => {
    if (activeServerId && activeServerId !== "@me" && activeChannelId) {
      if (stateChannels.length > 0 && !stateChannels.some((c) => c.id === activeChannelId)) {
        const firstText = stateChannels.find((c) => c.channel_type === "text");
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: firstText ? firstText.id : null });
      }
    }
  }, [stateChannels, activeServerId, activeChannelId, dispatch]);

  useEffect(() => {
    if (!activeServerId) return;
    const path = activeChannelId
      ? `/chat/${activeServerId}/${activeChannelId}`
      : `/chat/${activeServerId}`;
    silentPush(path);
  }, [activeServerId, activeChannelId]);

  const isDmMode = activeServerId === "@me" || activeServerId === "%40me";

  // Subscribe to all servers for message delivery (Op 35)
  // This runs when the server list changes (e.g. after initial load or joining a new server)
  const subscribedServersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (servers.length === 0) return;
    for (const server of servers) {
      if (!subscribedServersRef.current.has(server.id)) {
        subscribeServer(server.id);
        subscribedServersRef.current.add(server.id);
      }
    }
  }, [servers, subscribeServer]);

  // Subscribe to the active channel only (for typing indicators & presence)
  const activeChannelSubRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeChannelId) return;

    // Unsub from previous active channel
    if (activeChannelSubRef.current && activeChannelSubRef.current !== activeChannelId) {
      unsubscribeChannel(activeChannelSubRef.current);
    }

    // Sub to new active channel
    subscribeChannel(activeChannelId);
    activeChannelSubRef.current = activeChannelId;
  }, [activeChannelId, subscribeChannel, unsubscribeChannel]);

  const handleSelectServer = (serverId: string) => {
    if (serverId === activeServerId) return;

    if (serverId === "@me") {
      const lastDmId = lastActiveChannels.current["@me"];
      const targetDmId = lastDmId && dmChannels.some((d) => d.id === lastDmId)
        ? lastDmId
        : null;
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetDmId });
      return;
    }

    channelsLoadedForServer.current = null;
    const lastId = lastActiveChannels.current[serverId];

    dispatch({ type: "SWITCH_SERVER", serverId, channelId: lastId || null });
  };

  const handleSelectChannel = useCallback((channelId: string, options?: { isJump?: boolean }) => {
    if (channelId === activeChannelId) {
      if (!options?.isJump) {
        uiDispatch({ type: "SET_PENDING_JUMP", jump: null });
      }
      return;
    }
    dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
    uiDispatch({ type: "SET_SIDEBAR", open: false });

    if (!options?.isJump) {
      uiDispatch({ type: "SET_VOICE_TEXT", show: false });
      uiDispatch({ type: "SET_PENDING_JUMP", jump: null });
    }
  }, [activeChannelId, dispatch]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const channelId = typeof detail === "string" ? detail : detail.channelId;
      const messageId = typeof detail === "object" ? detail.messageId : null;

      if (channelId) {
        const targetChannel = stateChannels.find((c) => c.id === channelId);
        const isTargetVoice = targetChannel?.channel_type === "voice";

        if (messageId) {
          uiDispatch({ type: "SET_PENDING_JUMP", jump: { channelId, messageId } });
          if (isTargetVoice) {
            uiDispatch({ type: "SET_VOICE_TEXT", show: true });
          }
        }

        handleSelectChannel(channelId, { isJump: !!messageId });

        if (messageId && channelId === activeChannelId) {
          const event = new CustomEvent("jump-to-message", {
            detail: { channelId, messageId }
          });
          window.dispatchEvent(event);
        }
      }
    };
    window.addEventListener("navigate-channel", handler);
    return () => window.removeEventListener("navigate-channel", handler);
  }, [handleSelectChannel, stateChannels, activeChannelId]);

  const handleToggleVoiceTextChat = useCallback(() => uiDispatch({ type: "TOGGLE_VOICE_TEXT" }), []);

  const onVoiceJoin = useCallback(() => {
    // End any active call when user explicitly joins a voice channel
    const { status, callId } = useCallStore.getState();
    if (status === "active" && callId) {
      const gateway = useChatStore.getState().gateway;
      gateway?.sendCallEnd(callId);
      useCallStore.getState().endCall("local");
    }
    setVoiceState({
      channelId: activeChannelId,
      serverId: activeServerId,
      joined: true,
    });
  }, [activeChannelId, activeServerId]);

  const onVoiceLeave = useCallback(() => {
    setVoiceState({ channelId: null, serverId: null, joined: false });
    setLocalStreamState(null);
  }, []);

  return {
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
  };
}
