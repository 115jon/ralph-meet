import { getDesktopToken } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { useChatActions, useChatState } from "@/stores/chat-store";
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

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
  const state = useChatState();
  const {
    loadServers,
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
    if (!isTauri()) return;
    let unlisten: () => void;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("hardware-back-pressed", () => {
        const currentUi = uiRef.current;
        if (currentUi.activeModal !== "none") {
          uiDispatch({ type: "CLOSE_MODAL" });
          return;
        }
        if (currentUi.sidebarOpen) {
          import("@tauri-apps/plugin-process").then(({ exit }) => exit(0));
          return;
        }

        if (window.innerWidth < 768) {
          uiDispatch({ type: "SET_SIDEBAR", open: true });
        } else {
          import("@tauri-apps/plugin-process").then(({ exit }) => exit(0));
        }
      }).then(u => { unlisten = u; });
    });

    return () => { if (unlisten) unlisten(); };
  }, []);

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

  useEffect(() => {
    if (!user) return;
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
      status: state.user?.status || (typeof window !== "undefined" ? localStorage.getItem("user-status") as any : null) || "online",
      custom_status: state.user?.custom_status,
    };

    if (JSON.stringify(state.user) !== JSON.stringify(newUserState)) {
      dispatch({ type: "SET_USER", user: newUserState });
    }
  }, [user, state.user, dispatch]);

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
    const hasServers = state.servers.length > 0;

    let shouldInit = false;
    if (isDM) shouldInit = true;
    else if (urlServer) { if (hasServers) shouldInit = true; }
    else if (hasServers) shouldInit = true;

    if (!shouldInit) return;

    initializedRef.current = true;

    if (isDM) {
      const cachedId = lastActiveChannels.current["@me"];
      const targetId = urlChannel || (cachedId && state.dmChannels.some((d) => d.id === cachedId) ? cachedId : null);
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetId });
    } else if (urlServer && state.servers.some((s) => s.id === urlServer)) {
      const targetId = urlChannel || lastActiveChannels.current[urlServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: urlServer, channelId: targetId });
    } else if (hasServers) {
      const firstServer = state.servers[0].id;
      const targetId = lastActiveChannels.current[firstServer] || null;
      dispatch({ type: "SWITCH_SERVER", serverId: firstServer, channelId: targetId });
    }
  }, [state.servers, slug, dispatch, state.dmChannels]);

  useEffect(() => {
    if (!state.activeServerId || state.activeServerId === "@me") return;
    loadChannels(state.activeServerId);
    loadMembers(state.activeServerId);
  }, [state.activeServerId, loadChannels, loadMembers]);

  const channelsLoadedForServer = useRef<string | null>(null);
  useEffect(() => {
    if (
      !state.activeServerId ||
      state.activeServerId === "@me" ||
      state.channels.length === 0 ||
      state.activeChannelId
    ) return;
    if (channelsLoadedForServer.current === state.activeServerId) return;
    channelsLoadedForServer.current = state.activeServerId;

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

  useEffect(() => {
    if (state.activeServerId && state.activeChannelId) {
      lastActiveChannels.current[state.activeServerId] = state.activeChannelId;
      localStorage.setItem("lastActiveChannels", JSON.stringify(lastActiveChannels.current));
    }
  }, [state.activeServerId, state.activeChannelId]);

  useEffect(() => {
    if (state.activeServerId && state.activeServerId !== "@me" && state.activeChannelId) {
      if (state.channels.length > 0 && !state.channels.some((c) => c.id === state.activeChannelId)) {
        const firstText = state.channels.find((c) => c.channel_type === "text");
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: firstText ? firstText.id : null });
      }
    }
  }, [state.channels, state.activeServerId, state.activeChannelId, dispatch]);

  useEffect(() => {
    if (!state.activeServerId) return;
    const path = state.activeChannelId
      ? `/chat/${state.activeServerId}/${state.activeChannelId}`
      : `/chat/${state.activeServerId}`;
    silentPush(path);
  }, [state.activeServerId, state.activeChannelId]);

  const isDmMode = state.activeServerId === "@me" || state.activeServerId === "%40me";
  const subscribedChannelsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!state.activeServerId) return;

    const channelsToWatch = isDmMode ? state.dmChannels : state.channels;
    const currentIds = new Set(channelsToWatch.map((c) => c.id));

    for (const id of Array.from(subscribedChannelsRef.current)) {
      if (!currentIds.has(id)) {
        unsubscribeChannel(id);
        subscribedChannelsRef.current.delete(id);
      }
    }

    for (const id of Array.from(currentIds)) {
      if (!subscribedChannelsRef.current.has(id)) {
        subscribeChannel(id);
        subscribedChannelsRef.current.add(id);
      }
    }
  }, [state.activeServerId, state.channels, state.dmChannels, isDmMode, subscribeChannel, unsubscribeChannel]);

  const handleSelectServer = (serverId: string) => {
    if (serverId === state.activeServerId) return;

    if (serverId === "@me") {
      const lastDmId = lastActiveChannels.current["@me"];
      const targetDmId = lastDmId && state.dmChannels.some((d) => d.id === lastDmId)
        ? lastDmId
        : (state.dmChannels.length > 0 ? state.dmChannels[0].id : null);
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: targetDmId });
      return;
    }

    channelsLoadedForServer.current = null;
    const lastId = lastActiveChannels.current[serverId];

    dispatch({ type: "SWITCH_SERVER", serverId, channelId: lastId || null });
  };

  const handleSelectChannel = useCallback((channelId: string, options?: { isJump?: boolean }) => {
    if (channelId === state.activeChannelId) {
      if (!options?.isJump) {
        uiDispatch({ type: "SET_PENDING_JUMP", jump: null });
      }
      return;
    }
    dispatch({ type: "SET_ACTIVE_CHANNEL", channelId });
    markChannelRead(channelId);
    uiDispatch({ type: "SET_SIDEBAR", open: false });

    if (!options?.isJump) {
      uiDispatch({ type: "SET_VOICE_TEXT", show: false });
      uiDispatch({ type: "SET_PENDING_JUMP", jump: null });
    }
  }, [state.activeChannelId, dispatch, markChannelRead]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const channelId = typeof detail === "string" ? detail : detail.channelId;
      const messageId = typeof detail === "object" ? detail.messageId : null;

      if (channelId) {
        const targetChannel = state.channels.find((c) => c.id === channelId);
        const isTargetVoice = targetChannel?.channel_type === "voice";

        if (messageId) {
          uiDispatch({ type: "SET_PENDING_JUMP", jump: { channelId, messageId } });
          if (isTargetVoice) {
            uiDispatch({ type: "SET_VOICE_TEXT", show: true });
          }
        }

        handleSelectChannel(channelId, { isJump: !!messageId });

        if (messageId && channelId === state.activeChannelId) {
          const event = new CustomEvent("jump-to-message", {
            detail: { channelId, messageId }
          });
          window.dispatchEvent(event);
        }
      }
    };
    window.addEventListener("navigate-channel", handler);
    return () => window.removeEventListener("navigate-channel", handler);
  }, [handleSelectChannel, state.channels, state.activeChannelId]);

  const handleToggleVoiceTextChat = useCallback(() => uiDispatch({ type: "TOGGLE_VOICE_TEXT" }), []);

  const onVoiceJoin = useCallback(() => {
    setVoiceState({
      channelId: state.activeChannelId,
      serverId: state.activeServerId,
      joined: true,
    });
  }, [state.activeChannelId, state.activeServerId]);

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
