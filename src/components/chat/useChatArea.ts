import { apiPost } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { Attachment, Message } from "@/lib/types";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useShallow } from "zustand/shallow";
import type { VirtualMessageListHandle } from "./VirtualMessageList";

export function useChatArea({
  channelId,
  jumpToMessageId,
  onJumped,
}: {
  channelId: string | null;
  jumpToMessageId?: string | null;
  onJumped?: () => void;
}) {
  const state = useChatStore(useShallow(s => ({
    messages: s.messages,
    pinnedMessages: s.pinnedMessages,
    loadingPins: s.loadingPins,
    user: s.user,
    members: s.members,
    typingUsers: s.typingUsers,
    channels: s.channels,
    activeServerId: s.activeServerId,
    activeChannelId: s.activeChannelId,
    onlineUsers: s.onlineUsers,
    scrollPositions: s.scrollPositions,
    readStates: s.readStates,
  })));
  const {
    loadMessages,
    loadMessagesAround,
    loadMessagesAfter,
    sendMessage,
    sendTyping,
    unpinMessage,
    pinMessage,
    loadPins,
    markChannelRead,
    dispatch,
  } = useChatActions();

  const [localState, setLocalState] = useReducer(
    (state: any, action: any) => ({ ...state, ...(typeof action === "function" ? action(state) : action) }),
    {
      pinModal: { isOpen: false, message: null as Message | null, mode: 'pin' as 'pin' | 'unpin' },
      showPins: false,
      hasMore: true,
      loading: false,
      isDetached: false,
      hasMoreAfterAnchor: false,
      anchorScrollId: null as string | null,
      replyTo: null as Message | null,
      showSearch: false,
      isDragging: false,
      threadMessageId: null as string | null,
      showChannelSettings: false,
      showChannelDetails: false,
    }
  );

  const {
    pinModal,
    showPins,
    hasMore,
    loading,
    isDetached,
    hasMoreAfterAnchor,
    anchorScrollId,
    replyTo,
    showSearch,
    isDragging,
    threadMessageId,
    showChannelSettings,
    showChannelDetails,
  } = localState;

  const pinSidebarRef = useRef<HTMLDivElement>(null);
  const pinButtonRef = useRef<HTMLButtonElement>(null);
  const virtualListRef = useRef<VirtualMessageListHandle>(null);
  const pendingScrollId = useRef<string | null>(null);
  const prevChannelRef = useRef<string | null>(null);
  const shouldScrollRef = useRef(false);
  const internalPendingJumpRef = useRef<string | null>(null);

  const syncJumpToMessageId = useCallback(() => {
    if (jumpToMessageId) {
      internalPendingJumpRef.current = jumpToMessageId;
    }
  }, [jumpToMessageId]);

  useEffect(() => {
    syncJumpToMessageId();
  }, [syncJumpToMessageId]);

  useEffect(function autoScrollOnNewMessage() {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    virtualListRef.current?.scrollToBottom("smooth");
  }, [state.messages]);

  const isAtBottomRef = useRef(true);
  const isUnmountingRef = useRef(false);
  const isRestoringScrollRef = useRef(false);
  const restoreScrollTimeoutRef = useRef<any>(null);
  const restoringTargetRef = useRef<string | null>(null);
  const lastStartIndexRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
    };
  }, []);

  const handleAtBottom = useCallback((isAtBottom: boolean) => {
    if (isUnmountingRef.current) return;

    if (isRestoringScrollRef.current) {
      console.log(`[useChatArea] handleAtBottom: ignored (restoring) for channel ${channelId}`);
      if (restoringTargetRef.current === "BOTTOM") {
        // Force the ref to stay true, neutralizing the false-negative from Virtuoso loading.
        isAtBottomRef.current = true;
      }
      return;
    }

    isAtBottomRef.current = isAtBottom;
    console.log(`[useChatArea] handleAtBottom: ${isAtBottom} for channel ${channelId}`);
    if (isAtBottom && channelId) {
      // User has reached the end of the history; mark channel read!
      markChannelRead(channelId);
      // Track that we are at the bottom so next time we open we go exactly there
      dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: "BOTTOM" });
      console.log(`[useChatArea] Saved scroll position BOTTOM for channel ${channelId}`);
    } else if (!isAtBottom && channelId) {
      // If we are no longer at the bottom, Virtuoso likely fired rangeChanged BEFORE atBottomStateChange.
      // We must immediately apply the last captured index now that we are officially detached from the bottom.
      console.log(`[useChatArea] Detached from bottom. lastStartIndexRef=${lastStartIndexRef.current}, total messages=${state.messages.length}`);
      if (lastStartIndexRef.current !== null) {
        const msg = state.messages[lastStartIndexRef.current];
        if (msg) {
          console.log(`[useChatArea] handleAtBottom: Saved scroll position ${msg.id} (from last range) for channel ${channelId}`);
          dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: msg.id });
        } else {
          console.log(`[useChatArea] handleAtBottom ERROR: No message found at index ${lastStartIndexRef.current}`);
        }
      }
    }
  }, [channelId, markChannelRead, dispatch, state.messages]);

  const handleScrollRangeChange = useCallback((startIndex: number) => {
    console.log(`[useChatArea] handleScrollRangeChange fired with startIndex=${startIndex}`);
    lastStartIndexRef.current = startIndex;

    if (isUnmountingRef.current) return;
    if (!channelId || isDetached) return;
    if (isRestoringScrollRef.current) {
      console.log(`[useChatArea] handleScrollRangeChange: ignored (restoring) for channel ${channelId}`);
      return;
    }
    if (isAtBottomRef.current) {
      console.log(`[useChatArea] handleScrollRangeChange: ignored (at bottom) for channel ${channelId}`);
      return; // Do not record a specific message anchor if we are snapped to bottom
    }
    const msg = state.messages[startIndex];
    if (msg) {
      console.log(`[useChatArea] handleScrollRangeChange: Saved scroll position ${msg.id} for channel ${channelId}`);
      dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: msg.id });
    }
  }, [channelId, isDetached, state.messages, dispatch]);

  const handleLoadMore = useCallback(async () => {
    if (!channelId || !hasMore || loading) return;
    const oldest = state.messages[0];
    if (!oldest) return;
    setLocalState({ loading: true });
    const older = await loadMessages(channelId, oldest.created_at);
    setLocalState({ hasMore: older.length >= 50 });
    setLocalState({ loading: false });
  }, [channelId, hasMore, loading, state.messages, loadMessages]);

  const handleJumpToPresent = useCallback(async () => {
    if (!channelId) return;
    setLocalState({ loading: true });
    setLocalState({ anchorScrollId: null });
    setLocalState({ isDetached: false });
    setLocalState({ hasMoreAfterAnchor: false });
    const msgs = await loadMessages(channelId);
    setLocalState({ hasMore: msgs.length >= 50 });
    setLocalState({ loading: false });
    setTimeout(() => virtualListRef.current?.scrollToBottom("auto"), 50);
  }, [channelId, loadMessages]);

  const handleLoadAfter = useCallback(async () => {
    if (!channelId || !isDetached) return;
    const newest = state.messages[state.messages.length - 1];
    if (!newest) return;
    const { hasMoreAfter } = await loadMessagesAfter(channelId, newest.created_at);
    setLocalState({ hasMoreAfterAnchor: hasMoreAfter });
    if (!hasMoreAfter) {
      setLocalState({ isDetached: false });
    }
  }, [channelId, isDetached, state.messages, loadMessagesAfter]);

  const handleSend = useCallback(
    (content: string, replyToId?: string, attachmentIds?: string[], uploadedFiles?: Array<{ id: string; url: string; filename: string; content_type: string; size: number }>) => {
      if (!channelId) return;
      const replyMsg = replyToId
        ? state.messages.find((m) => m.id === replyToId) ?? replyTo ?? undefined
        : undefined;
      const optimisticAttachments: Attachment[] = (uploadedFiles ?? []).map((f) => ({
        id: f.id,
        filename: f.filename,
        file_key: f.url,
        content_type: f.content_type,
        size_bytes: f.size,
        url: f.url,
      }));
      sendMessage(channelId, content, replyToId, replyMsg, attachmentIds, optimisticAttachments);
      setLocalState({ replyTo: null });
      shouldScrollRef.current = true;
    },
    [channelId, sendMessage, state.messages, replyTo]
  );

  const handleTyping = useCallback(() => {
    if (!channelId) return;
    sendTyping(channelId);
  }, [channelId, sendTyping]);

  const handleTogglePins = useCallback(async () => {
    if (showPins) {
      setLocalState({ showPins: false });
      return;
    }
    if (!channelId) return;
    setLocalState({ showPins: true });
    loadPins(channelId);
  }, [showPins, channelId, loadPins]);

  const handleReply = useCallback((message: Message) => {
    setLocalState({ replyTo: message });
  }, []);

  const pinnedMessagesRef = useRef(state.pinnedMessages);
  useEffect(function syncPinnedMessagesRef() {
    pinnedMessagesRef.current = state.pinnedMessages;
  }, [state.pinnedMessages]);

  const handleUnpin = useCallback((messageId: string, skipConfirm: boolean = false) => {
    if (!channelId) return;

    if (skipConfirm) {
      unpinMessage(channelId, messageId);
      dispatch({ type: 'PIN_MESSAGE', messageId, pinned: false });
      return;
    }

    const msg = pinnedMessagesRef.current.find(m => m.id === messageId);
    if (msg) {
      setLocalState({
        pinModal: {
          isOpen: true,
          message: msg,
          mode: 'unpin'
        }
      });
    }
  }, [channelId, unpinMessage, dispatch]);

  const handlePin = useCallback((message: Message) => {
    if (!channelId) return;
    setLocalState({
      pinModal: {
        isOpen: true,
        message,
        mode: 'pin'
      }
    });
  }, [channelId]);

  const confirmPinAction = useCallback(() => {
    if (!channelId || !pinModal.message) return;

    if (pinModal.mode === 'pin') {
      pinMessage(channelId, pinModal.message.id);
      dispatch({ type: 'PIN_MESSAGE', messageId: pinModal.message.id, pinned: true });
    } else {
      unpinMessage(channelId, pinModal.message.id);
      dispatch({ type: 'PIN_MESSAGE', messageId: pinModal.message.id, pinned: false });
    }
    setLocalState({ pinModal: { ...pinModal, isOpen: false } });
  }, [channelId, pinModal, pinMessage, unpinMessage, dispatch]);

  const handleJumpToMessage = useCallback(async (messageId: string, options?: { closePins?: boolean }) => {
    if (options?.closePins !== false) {
      setLocalState({ showPins: false });
    }

    const inSlice = state.messages.some((m) => m.id === messageId);
    if (inSlice) {
      setTimeout(() => {
        virtualListRef.current?.scrollToMessageId(messageId);
      }, 100);
      return;
    }

    if (!channelId) return;
    setLocalState({ loading: true });
    pendingScrollId.current = messageId;
    setLocalState({ anchorScrollId: messageId });
    const { hasMoreBefore, hasMoreAfter } = await loadMessagesAround(channelId, messageId);
    setLocalState({ hasMore: hasMoreBefore });
    setLocalState({ hasMoreAfterAnchor: hasMoreAfter });
    setLocalState({ isDetached: true });
    setLocalState({ loading: false });
  }, [channelId, state.messages, loadMessagesAround]);

  const initChannel = useCallback(() => {
    if (!channelId) return;

    isRestoringScrollRef.current = true;
    if (restoreScrollTimeoutRef.current) {
      clearTimeout(restoreScrollTimeoutRef.current);
    }

    setLocalState({
      hasMore: true,
      loading: true,
      showPins: false,
      replyTo: null,
      threadMessageId: null,
      showChannelDetails: false,
      isDetached: false,
      anchorScrollId: null,
      initialScrollAlign: "end", // Default to end
    });
    pendingScrollId.current = null;
    loadMessages(channelId).then((msgs) => {
      if (isUnmountingRef.current) return;

      if (internalPendingJumpRef.current) {
        const msgId = internalPendingJumpRef.current;
        internalPendingJumpRef.current = null;
        onJumped?.();
        setLocalState({
          hasMore: msgs.length >= 50,
          loading: false,
          anchorScrollId: msgId,
          initialScrollAlign: "center"
        });
      } else {
        const lastScrollId = state.scrollPositions[channelId];
        const lastReadTimestamp = state.readStates[channelId];

        console.log(`[useChatArea] initChannel for ${channelId}: lastScrollId=${lastScrollId}, lastReadTimestamp=${lastReadTimestamp}`);

        let targetId = "BOTTOM";
        let targetAlign = "end";

        // 1. If we have a saved scroll position, go to it
        if (lastScrollId === "BOTTOM") {
          console.log(`[useChatArea] initChannel: Restoring BOTTOM scroll strategy`);
          targetId = "BOTTOM";
          targetAlign = "end";
        } else if (lastScrollId && msgs.some(m => m.id === lastScrollId)) {
          console.log(`[useChatArea] initChannel: Restoring scroll position ${lastScrollId}`);
          targetId = lastScrollId;
          targetAlign = "start";
        } else if (lastReadTimestamp) {
          // 2. If no saved scroll, but we have unread messages, jump to oldest unread message
          const firstUnread = msgs.find(m => m.created_at > lastReadTimestamp);
          if (firstUnread) {
            console.log(`[useChatArea] initChannel: Jump to first unread message ${firstUnread.id}`);
            targetId = firstUnread.id;
            targetAlign = "start";
          } else {
            console.log(`[useChatArea] initChannel: All messages read, scrolling to bottom`);
            targetId = "BOTTOM";
            targetAlign = "end";
          }
        } else {
          // 3. Just loaded a basic channel with no read state tracking, load bottom
          console.log(`[useChatArea] initChannel: No read state tracking, scrolling to bottom`);
          targetId = "BOTTOM";
          targetAlign = "end";
        }

        setLocalState({
          hasMore: msgs.length >= 50,
          loading: false,
          anchorScrollId: targetId, // Setting to "BOTTOM" forces Virtuoso to cleanly remount AFTER items arrive
          initialScrollAlign: targetAlign,
          isDetached: targetId !== "BOTTOM"
        });

        restoringTargetRef.current = targetId;
        restoreScrollTimeoutRef.current = setTimeout(() => {
          isRestoringScrollRef.current = false;
        }, 800);
      }
    });

    loadPins(channelId);
    prevChannelRef.current = channelId;
  }, [channelId, loadMessages, loadPins, handleJumpToMessage, onJumped]);

  useEffect(() => {
    initChannel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(function fulfillPendingJump() {
    if (!pendingScrollId.current) return;
    const msgId = pendingScrollId.current;
    const found = state.messages.some((m) => m.id === msgId);
    if (!found) return;
    pendingScrollId.current = null;
  }, [state.messages]);

  useEffect(function registerJumpEvents() {
    const handler = (e: Event) => {
      const { channelId: targetChannelId, messageId } = (e as CustomEvent).detail;
      if (targetChannelId === channelId) {
        handleJumpToMessage(messageId);
      } else {
        internalPendingJumpRef.current = messageId;
      }
    };
    window.addEventListener('jump-to-message', handler);
    return () => window.removeEventListener('jump-to-message', handler);
  }, [channelId, handleJumpToMessage]);

  useEffect(function registerEditLastMessage() {
    const handler = () => {
      if (!state.user?.id) return;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (msg.author_id === state.user.id && !msg.pending) {
          window.dispatchEvent(new CustomEvent(`edit-message-${msg.id}`));
          virtualListRef.current?.scrollToMessageId(msg.id);
          return;
        }
      }
    };
    window.addEventListener("edit-last-message", handler);
    return () => window.removeEventListener("edit-last-message", handler);
  }, [state.messages, state.user?.id]);

  const userPermissions = useMemo(() => {
    return state.members.find((m) => m.user.id === state.user?.id)?.roles?.reduce((acc, r) => acc | r.permissions, 0) ?? 0;
  }, [state.members, state.user?.id]);

  const channelData = useMemo(() => {
    return state.channels.find(c => c.id === channelId);
  }, [state.channels, channelId]);

  const effectivePermissions = channelData?.permissions ?? userPermissions;
  const canSendMessages = hasPermission(effectivePermissions, PERMISSIONS.SEND_MESSAGES) || hasPermission(effectivePermissions, PERMISSIONS.ADMINISTRATOR);

  const canPin = useMemo(() => {
    return hasPermission(userPermissions, PERMISSIONS.MANAGE_MESSAGES) ||
      hasPermission(userPermissions, PERMISSIONS.MANAGE_CHANNELS) ||
      hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) ||
      hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  }, [userPermissions]);

  const canBan = useMemo(() => {
    return hasPermission(userPermissions, PERMISSIONS.BAN_MEMBERS) ||
      hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  }, [userPermissions]);

  const handleBan = useCallback(async (targetUserId: string, username: string) => {
    if (!state.activeServerId || state.activeServerId === "@me") return;
    const reason = window.prompt(`Ban ${username}?\n\nOptionally provide a reason:`);
    if (reason === null) return;
    try {
      await apiPost(`/api/servers/${state.activeServerId}/bans`, {
        user_id: targetUserId,
        reason: reason || undefined
      });
    } catch (err: any) {
      alert(err.message || "Failed to ban user");
    }
  }, [state.activeServerId]);

  const handleThread = useCallback((messageId: string) => {
    setLocalState({ threadMessageId: messageId });
  }, []);

  useEffect(function closePinsOnClickOutside() {
    if (!showPins) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (pinSidebarRef.current?.contains(e.target as Node)) return;
      if (pinButtonRef.current?.contains(e.target as Node)) return;
      setLocalState({ showPins: false });
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPins]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setLocalState({ isDragging: true });
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setLocalState({ isDragging: false });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setLocalState({ isDragging: false });
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const event = new CustomEvent('drop-files', { detail: files });
      window.dispatchEvent(event);
    }
  }, []);

  const typingUsers = useMemo(() => {
    if (!channelId) return [];
    return Array.from(state.typingUsers[channelId] ?? [])
      .filter(id => id !== state.user?.id)
      .map(id => {
        const member = state.members.find(m => m.user.id === id);
        return member?.user.username || "Someone";
      });
  }, [channelId, state.typingUsers, state.user?.id, state.members]);

  const pinnedCount = state.pinnedMessages.length;

  return {
    state,
    localState,
    setLocalState,
    pinModal,
    showPins,
    hasMore,
    loading,
    isDetached,
    hasMoreAfterAnchor,
    anchorScrollId,
    replyTo,
    showSearch,
    isDragging,
    threadMessageId,
    showChannelSettings,
    showChannelDetails,
    pinSidebarRef,
    pinButtonRef,
    virtualListRef,
    handleLoadMore,
    handleJumpToPresent,
    handleLoadAfter,
    handleSend,
    handleTyping,
    handleTogglePins,
    handleReply,
    handleUnpin,
    handlePin,
    confirmPinAction,
    handleJumpToMessage,
    handleBan,
    handleThread,
    handleAtBottom,
    handleScrollRangeChange,
    onDragOver,
    onDragLeave,
    onDrop,
    typingUsers,
    pinnedCount,
    canSendMessages,
    canPin,
    canBan,
    channelData,
  };
}
