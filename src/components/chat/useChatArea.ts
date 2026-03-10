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
    jumpAnchors: s.jumpAnchors,
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
      highlightAnchor: false,
      unreadSeparatorId: null as string | null,
      unreadCount: 0,
      unreadSince: null as string | null,
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
    highlightAnchor,
    unreadSeparatorId,
    unreadCount,
    unreadSince,
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
  // Only call markChannelRead when there are actually new unread messages
  const hasUnreadMessages = useCallback(() => {
    if (!channelId) return false;
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return false;
    const lastRead = state.readStates[channelId];
    if (!lastRead) return true; // Never read → has unreads
    return lastMsg.created_at > lastRead;
  }, [channelId, state.messages, state.readStates]);

  const isAtBottomRef = useRef(true);
  const isUnmountingRef = useRef(false);
  const lastStartIndexRef = useRef<number | null>(null);
  const isDocumentHiddenRef = useRef(typeof document !== "undefined" ? (!document.hasFocus() || document.hidden) : false);
  const prevMessageCountRef = useRef(state.messages.length);
  const separatorLockedRef = useRef(false);

  // Track document visibility AND window focus
  useEffect(() => {
    const updateHidden = () => {
      isDocumentHiddenRef.current = document.hidden || !document.hasFocus();
    };

    const onReturn = () => {
      const wasHidden = isDocumentHiddenRef.current;
      updateHidden();

      // Returning to visible + at bottom: clear banner, keep separator,
      // mark as read so new messages will get a fresh separator position.
      if (wasHidden && !isDocumentHiddenRef.current && isAtBottomRef.current && channelId && !isDetached) {
        if (hasUnreadMessages()) markChannelRead(channelId);
        setLocalState({ unreadCount: 0, unreadSince: null });
        // Lock the separator — next unfocused batch will replace it
        separatorLockedRef.current = true;
      }
    };

    const onLeave = () => {
      updateHidden();
    };

    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("blur", onLeave);
    };
  }, [channelId, isDetached, markChannelRead, hasUnreadMessages]);

  // Set unread separator when new messages arrive while tab is hidden
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = state.messages.length;

    if (!isDocumentHiddenRef.current) return;
    if (!channelId) return;
    if (state.messages.length <= prevCount) return;

    // New messages arrived while hidden — find the first new one
    const newMessages = state.messages.slice(prevCount);
    const ownMessages = newMessages.filter(m => m.author_id !== state.user?.id);
    if (ownMessages.length === 0) return;

    setLocalState((prev: any) => {
      // If separator is locked (user already saw previous batch),
      // replace it with the new position
      if (separatorLockedRef.current) {
        separatorLockedRef.current = false;
        return {
          unreadSeparatorId: ownMessages[0].id,
          unreadCount: ownMessages.length,
          unreadSince: ownMessages[0].created_at,
        };
      }
      // Same unfocused session — accumulate count, keep separator at first unread
      if (prev.unreadSeparatorId) {
        return {
          unreadCount: prev.unreadCount + ownMessages.length,
        };
      }
      return {
        unreadSeparatorId: ownMessages[0].id,
        unreadCount: ownMessages.length,
        unreadSince: ownMessages[0].created_at,
      };
    });
  }, [state.messages, state.messages.length, channelId, state.user?.id]);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
    };
  }, []);

  const handleAtBottom = useCallback((isAtBottom: boolean) => {
    if (isUnmountingRef.current) return;

    isAtBottomRef.current = isAtBottom;

    // Only lock scroll position in detached mode with an active jump anchor.
    // Scroll-up detached mode (no jump anchor) saves positions normally.
    const hasJumpAnchor = !!(channelId && state.jumpAnchors[channelId]);
    const lockPosition = isDetached && hasJumpAnchor;

    if (isAtBottom && channelId && !isDetached) {
      // Don't mark as read while tab is hidden — keep readState stale
      // so the separator/banner can identify unreads correctly.
      if (!isDocumentHiddenRef.current) {
        if (hasUnreadMessages()) markChannelRead(channelId);
        // Clear the banner but keep the separator line
        setLocalState({ unreadCount: 0, unreadSince: null });
      }
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg) {
        dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: lastMsg.id });
      }
      dispatch({ type: "CLEAR_JUMP_ANCHOR", channelId });
    } else if (!isAtBottom && channelId && !lockPosition) {
      if (lastStartIndexRef.current !== null) {
        const msg = state.messages[lastStartIndexRef.current];
        if (msg) {
          dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: msg.id });
        }
      }
    }
  }, [channelId, isDetached, markChannelRead, hasUnreadMessages, dispatch, state.messages, state.jumpAnchors]);

  const handleScrollRangeChange = useCallback((startIndex: number) => {
    lastStartIndexRef.current = startIndex;

    if (isUnmountingRef.current) return;
    if (!channelId) return;
    // Only lock in detached mode with a jump anchor
    const hasJumpAnchor = !!(channelId && state.jumpAnchors[channelId]);
    if (isDetached && hasJumpAnchor) return;
    if (isAtBottomRef.current) return;

    const msg = state.messages[startIndex];
    if (msg) {
      dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: msg.id });
    }
  }, [channelId, isDetached, state.messages, state.jumpAnchors, dispatch]);

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

    markChannelRead(channelId);
    // Save the actual last message ID so reload resumes from this exact point
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg) {
      dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId: lastMsg.id });
    }

    setLocalState({ unreadSeparatorId: null, unreadCount: 0, unreadSince: null });
    setTimeout(() => virtualListRef.current?.scrollToBottom("auto"), 50);
  }, [channelId, loadMessages, markChannelRead, dispatch]);

  const handleMarkAsRead = useCallback(() => {
    if (!channelId) return;
    markChannelRead(channelId);
    setLocalState({ unreadSeparatorId: null, unreadCount: 0, unreadSince: null });
  }, [channelId, markChannelRead]);

  const handleLoadAfter = useCallback(async () => {
    if (!channelId || !isDetached) return;
    const newest = state.messages[state.messages.length - 1];
    if (!newest) return;
    const { hasMoreAfter } = await loadMessagesAfter(channelId, newest.created_at);
    setLocalState({ hasMoreAfterAnchor: hasMoreAfter });
    if (!hasMoreAfter) {
      // User has reached the present — exit detached mode.
      // This hides the "Jump to Present" button and enables normal behavior.
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

    // Set align to center so the jumped message is centered visually,
    // matching the reload restore behavior.
    setLocalState({ anchorScrollId: messageId, initialScrollAlign: "center", highlightAnchor: true });
    const { hasMoreBefore, hasMoreAfter } = await loadMessagesAround(channelId, messageId);
    setLocalState({ hasMore: hasMoreBefore });
    setLocalState({ hasMoreAfterAnchor: hasMoreAfter });
    setLocalState({ isDetached: true });
    setLocalState({ loading: false });
    // Save the jump anchor so it survives reload
    dispatch({ type: "SET_SCROLL_POSITION", channelId, messageId });
    dispatch({ type: "SET_JUMP_ANCHOR", channelId, messageId });
  }, [channelId, state.messages, loadMessagesAround, dispatch]);

  const initChannel = useCallback(() => {
    if (!channelId) return;

    setLocalState({
      hasMore: true,
      loading: true,
      showPins: false,
      replyTo: null,
      threadMessageId: null,
      showChannelDetails: false,
      isDetached: false,
      anchorScrollId: null,
      initialScrollAlign: "end",
      highlightAnchor: false,
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

        let targetId: string | null = null;
        let targetAlign = "end";

        // 1. If we have a saved scroll position, find it
        if (lastScrollId && lastScrollId !== "BOTTOM") {
          if (msgs.some(m => m.id === lastScrollId)) {
            // Message is in the initial batch — check if it's the last message
            // (meaning user was at the bottom). If so, scroll to end.
            const isLastMessage = msgs.length > 0 && msgs[msgs.length - 1].id === lastScrollId;
            targetId = lastScrollId;
            targetAlign = isLastMessage ? "end" : "start";
          } else {
            // Saved position is not in the initial messages (historical context).
            // Load messages around that position.
            loadMessagesAround(channelId, lastScrollId).then(({ hasMoreBefore, hasMoreAfter }) => {
              if (isUnmountingRef.current) return;
              // Highlight only if this position was from a manual jump
              const wasJump = state.jumpAnchors[channelId] === lastScrollId;
              setLocalState({
                hasMore: hasMoreBefore,
                hasMoreAfterAnchor: hasMoreAfter,
                loading: false,
                anchorScrollId: lastScrollId,
                initialScrollAlign: "center",
                isDetached: true,
                highlightAnchor: wasJump,
              });
            });
            return; // Don't fall through
          }
        } else if (lastScrollId === "BOTTOM") {
          // Legacy fallback for stored "BOTTOM" values
          targetId = null;
          targetAlign = "end";
        } else if (lastReadTimestamp) {
          // 2. No saved scroll — check for unread messages
          const firstUnread = msgs.find(m => m.created_at > lastReadTimestamp);
          if (firstUnread) {
            targetId = firstUnread.id;
            targetAlign = "start";
          }
        }
        // 3. Default: no target = scroll to end

        // Compute unread separator — only if NOT landing at the bottom
        // while the window is focused (user sees everything immediately)
        const landingAtBottom = !targetId || targetAlign === "end";
        const windowFocused = typeof document !== "undefined" && document.hasFocus() && !document.hidden;
        const lastRead = state.readStates[channelId];
        let separatorId: string | null = null;
        let unreadMsgCount = 0;
        let firstUnreadTime: string | null = null;

        if (lastRead && !(landingAtBottom && windowFocused)) {
          for (const m of msgs) {
            if (m.created_at > lastRead) {
              if (!separatorId) {
                separatorId = m.id;
                firstUnreadTime = m.created_at;
              }
              unreadMsgCount++;
            }
          }
        }

        // If landing at bottom with focus, mark as read immediately
        if (landingAtBottom && windowFocused && channelId) {
          markChannelRead(channelId);
        }

        setLocalState({
          hasMore: msgs.length >= 50,
          loading: false,
          anchorScrollId: targetId || "BOTTOM",
          initialScrollAlign: targetAlign,
          isDetached: false,
          unreadSeparatorId: separatorId,
          unreadCount: unreadMsgCount,
          unreadSince: firstUnreadTime,
        });
      }
    });

    loadPins(channelId);
    prevChannelRef.current = channelId;
  }, [channelId, loadMessages, loadMessagesAround, loadPins, handleJumpToMessage, onJumped]);

  useEffect(() => {
    initChannel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Clear unread banner if showing while at bottom + focused.
  // Covers the case where initChannel computes unreads but the user
  // lands at the bottom — no scroll event fires to clear it.
  useEffect(() => {
    if (unreadCount > 0 && isAtBottomRef.current && !isDocumentHiddenRef.current && channelId && !isDetached) {
      if (hasUnreadMessages()) markChannelRead(channelId);
      setLocalState({ unreadCount: 0, unreadSince: null });
    }
  }, [unreadCount, channelId, isDetached, markChannelRead, hasUnreadMessages]);

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
    highlightAnchor,
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
    handleMarkAsRead,
    onDragOver,
    onDragLeave,
    onDrop,
    typingUsers,
    pinnedCount,
    canSendMessages,
    canPin,
    canBan,
    channelData,
    unreadSeparatorId,
    unreadCount,
    unreadSince,
  };
}
