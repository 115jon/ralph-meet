import { apiPost } from "@/lib/api-client";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { Attachment, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatState } from "@/stores/chat-store";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Download, Hash, Menu, MessageSquare, Pin, Search, Users, X } from "./Icons";
import MemberList from "./MemberList";
import MessageInput from "./MessageInput";
import { NotificationBell } from "./NotificationBell";
import { PinModal } from "./PinModal";
import { PinnedMessagesSidebar } from "./PinnedMessagesSidebar";
import SearchPanel from "./SearchPanel";
import ThreadSidebar from "./ThreadSidebar";
import VirtualMessageList, { type VirtualMessageListHandle } from "./VirtualMessageList";

interface Props {
  channelId: string | null;
  channelName: string;
  onMenuClick: () => void;
  onMembersClick?: () => void;
  showMembers?: boolean;
  isDM?: boolean;
  jumpToMessageId?: string | null;
  onJumped?: () => void;
  onClose?: () => void;
}

export default function ChatArea({
  channelId,
  channelName,
  onMenuClick,
  onMembersClick,
  showMembers,
  isDM,
  jumpToMessageId,
  onJumped,
  onClose
}: Props) {
  const state = useChatState();
  const {
    loadMessages,
    loadMessagesAround,
    loadMessagesAfter,
    sendMessage,
    sendTyping,
    unpinMessage,
    pinMessage,
    loadPins,
    dispatch,
  } = useChatActions();

  const [pinModal, setPinModal] = useState<{
    isOpen: boolean;
    message: Message | null;
    mode: 'pin' | 'unpin';
  }>({
    isOpen: false,
    message: null,
    mode: 'pin'
  });

  const [showPins, setShowPins] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const pinSidebarRef = useRef<HTMLDivElement>(null);
  const pinButtonRef = useRef<HTMLButtonElement>(null);
  const virtualListRef = useRef<VirtualMessageListHandle>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  // Track detached mode state
  const [isDetached, setIsDetached] = useState(false);
  /** Whether the anchor window has more messages AFTER it (toward present) */
  const [hasMoreAfterAnchor, setHasMoreAfterAnchor] = useState(false);
  // Keeps track of the anchor target for Virtuoso remounts
  const [anchorScrollId, setAnchorScrollId] = useState<string | null>(null);

  // Ref used simply to trigger the visual DOM highlight pulse
  const pendingScrollId = useRef<string | null>(null);
  const prevChannelRef = useRef<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const shouldScrollRef = useRef(false);
  const internalPendingJumpRef = useRef<string | null>(null);

  // Sync prop to ref
  useEffect(() => {
    if (jumpToMessageId) {
      internalPendingJumpRef.current = jumpToMessageId;
    }
  }, [jumpToMessageId]);

  // Channel change: load messages + reset local state
  useEffect(() => {
    if (!channelId) return;

    setHasMore(true);
    setLoading(true);
    setShowPins(false);
    setReplyTo(null);
    setThreadMessageId(null);
    setIsDetached(false);
    setAnchorScrollId(null); // Clear anchorScrollId on channel change
    pendingScrollId.current = null;
    loadMessages(channelId).then((msgs) => {
      setHasMore(msgs.length >= 50);
      setLoading(false);

      if (internalPendingJumpRef.current) {
        const msgId = internalPendingJumpRef.current;
        internalPendingJumpRef.current = null;
        onJumped?.();
        setTimeout(() => handleJumpToMessage(msgId), 100);
      } else {
        // Force scroll to bottom on initial load
        setTimeout(() => {
          virtualListRef.current?.scrollToBottom("auto");
        }, 50);
      }
    });

    // Proactively load pins for the channel
    loadPins(channelId);

    prevChannelRef.current = channelId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, loadMessages, loadPins]);

  // Auto-scroll on new messages handled by VirtualMessageList followOutput.
  // We only need to explicitly scroll when the user sends a message (shouldScrollRef).
  useEffect(() => {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    virtualListRef.current?.scrollToBottom("smooth");
  }, [state.messages]);

  const handleLoadMore = useCallback(async () => {
    if (!channelId || !hasMore || loading) return;
    const oldest = state.messages[0];
    if (!oldest) return;
    setLoading(true);
    const older = await loadMessages(channelId, oldest.created_at);
    setHasMore(older.length >= 50);
    setLoading(false);
  }, [channelId, hasMore, loading, state.messages, loadMessages]);

  /**
   * Jump to Present — exits detached mode and reloads the live tail.
   */
  const handleJumpToPresent = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    setAnchorScrollId(null);
    setIsDetached(false);
    setHasMoreAfterAnchor(false);
    const msgs = await loadMessages(channelId);
    setHasMore(msgs.length >= 50);
    setLoading(false);
    setTimeout(() => virtualListRef.current?.scrollToBottom("auto"), 50);
  }, [channelId, loadMessages]);

  /**
   * Forward pagination — load the next page of messages after the current tail.
   * When the fetch returns hasMoreAfter=false, we've caught up to the live tail
   * and can exit detached mode automatically.
   */
  const handleLoadAfter = useCallback(async () => {
    if (!channelId || !isDetached) return;
    const newest = state.messages[state.messages.length - 1];
    if (!newest) return;
    const { hasMoreAfter } = await loadMessagesAfter(channelId, newest.created_at);
    setHasMoreAfterAnchor(hasMoreAfter);
    if (!hasMoreAfter) {
      // We've caught up to the live tail — exit detached mode seamlessly.
      setIsDetached(false);
    }
  }, [channelId, isDetached, state.messages, loadMessagesAfter]);

  const handleSend = useCallback(
    (content: string, replyToId?: string, attachmentIds?: string[], uploadedFiles?: Array<{ id: string; url: string; filename: string; content_type: string; size: number }>) => {
      if (!channelId) return;
      // Find the reply message to include its data in the optimistic message
      const replyMsg = replyToId
        ? state.messages.find((m) => m.id === replyToId) ?? replyTo ?? undefined
        : undefined;
      // Build optimistic attachment objects from uploaded file metadata
      const optimisticAttachments: Attachment[] = (uploadedFiles ?? []).map((f) => ({
        id: f.id,
        filename: f.filename,
        file_key: f.url,
        content_type: f.content_type,
        size_bytes: f.size,
        url: f.url,
      }));
      sendMessage(channelId, content, replyToId, replyMsg, attachmentIds, optimisticAttachments);
      setReplyTo(null);
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
      setShowPins(false);
      return;
    }
    if (!channelId) return;
    setShowPins(true);
    loadPins(channelId);
  }, [showPins, channelId, loadPins]);

  const handleReply = useCallback((message: Message) => {
    setReplyTo(message);
  }, []);

  const pinnedMessagesRef = useRef(state.pinnedMessages);
  useEffect(() => {
    pinnedMessagesRef.current = state.pinnedMessages;
  }, [state.pinnedMessages]);

  const handleUnpin = useCallback((messageId: string, skipConfirm: boolean = false) => {
    if (!channelId) return;

    // Check for shift key if bypass is desired, but since skipConfirm is passed from child
    if (skipConfirm) {
      unpinMessage(channelId, messageId);
      dispatch({ type: 'PIN_MESSAGE', messageId, pinned: false });
      return;
    }

    const msg = pinnedMessagesRef.current.find(m => m.id === messageId);
    if (msg) {
      setPinModal({
        isOpen: true,
        message: msg,
        mode: 'unpin'
      });
    }
  }, [channelId, unpinMessage]);

  const handlePin = useCallback((message: Message) => {
    if (!channelId) return;
    setPinModal({
      isOpen: true,
      message,
      mode: 'pin'
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
    setPinModal({ ...pinModal, isOpen: false }); // Close modal but keep message for animation
  }, [channelId, pinModal, pinMessage, unpinMessage, dispatch]);

  const handleJumpToMessage = useCallback(async (messageId: string, options?: { closePins?: boolean }) => {
    if (options?.closePins !== false) {
      setShowPins(false);
    }

    // Fast path: message is already in the loaded slice
    // Fast path: message is already in the loaded slice
    const inSlice = state.messages.some((m) => m.id === messageId);
    if (inSlice) {
      // Delay scrolling slightly to allow UI (like setShowPins) causing layout shifts to settle
      setTimeout(() => {
        virtualListRef.current?.scrollToMessageId(messageId);
      }, 100);
      return;
    }

    // Slow path: anchor fetch — message is not loaded yet
    if (!channelId) return;
    setLoading(true);
    pendingScrollId.current = messageId;
    setAnchorScrollId(messageId);
    const { hasMoreBefore, hasMoreAfter } = await loadMessagesAround(channelId, messageId);
    setHasMore(hasMoreBefore);
    setHasMoreAfterAnchor(hasMoreAfter);
    setIsDetached(true);
    setLoading(false);
    // The pending scroll will be fulfilled by the useEffect below once messages update
  }, [channelId, state.messages, loadMessagesAround]);

  // Fulfill pending jump highlight after anchor fetch replaces the message slice
  useEffect(() => {
    if (!pendingScrollId.current) return;
    const msgId = pendingScrollId.current;
    const found = state.messages.some((m) => m.id === msgId);
    if (!found) return;

    // We keep the ID just long enough to pass it as initialScrollMessageId
    // on the render that has 'found = true'. But we must clear the ref so
    // it doesn't fire again on subsequent message loads.
    pendingScrollId.current = null;

    // The actual scroll is now handled natively via initialTopMostItemIndex in
    // VirtualMessageList (which completely remounts on anchor fetch).
    // The highlight is also handled by VML's useLayoutEffect, so this is
    // just a secondary backup. No separate highlight needed here.

  }, [state.messages]);

  useEffect(() => {
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

  // ↑ Arrow key: find the user's last message and trigger editing
  useEffect(() => {
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
    if (reason === null) return; // User cancelled
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
    setThreadMessageId(messageId);
  }, []);

  // Close pins on click outside
  useEffect(() => {
    if (!showPins) return;

    const handleClickOutside = (e: MouseEvent) => {
      // Don't close if clicking the sidebar itself
      if (pinSidebarRef.current?.contains(e.target as Node)) return;
      // Don't close if clicking the toggle button
      if (pinButtonRef.current?.contains(e.target as Node)) return;

      setShowPins(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPins]);

  // Drag and drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Drag-and-drop files are handled by the MessageInput component
    // We dispatch a custom event that MessageInput can listen to
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const event = new CustomEvent('drop-files', { detail: files });
      window.dispatchEvent(event);
    }
  }, []);


  // Typing users for current channel (exclude self)
  const typingUsers = useMemo(() => {
    if (!channelId) return [];
    return Array.from(state.typingUsers[channelId] ?? [])
      .filter(id => id !== state.user?.id)
      .map(id => {
        const member = state.members.find(m => m.user.id === id);
        return member?.user.username || "Someone";
      });
  }, [channelId, channelId ? state.typingUsers[channelId] : undefined, state.user?.id, state.members]);

  // Count pinned messages in current view
  const pinnedCount = useMemo(() => {
    return state.pinnedMessages.length;
  }, [state.pinnedMessages.length]);

  // No channel selected
  if (!channelId) {
    return (
      <div className="flex flex-1 flex-col bg-rm-bg-primary relative overflow-hidden">
        <header className="h-12 flex shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary/60 px-4 z-10 backdrop-blur-md">
          <button
            className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium text-rm-text-muted">Select a channel</span>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <MessageSquare className="h-12 w-12 text-rm-text-muted border-rm-border" />
          <span className="text-base font-semibold text-rm-text-muted">No channel selected</span>
          <span className="text-xs text-rm-text-muted opacity-70">
            Pick a server and channel to start chatting
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col min-h-0 min-w-0 relative bg-rm-bg-primary"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none border-2 border-dashed border-indigo-500/50 m-4 rounded-xl transition-all animate-in fade-in zoom-in duration-200">
          <div className="flex flex-col items-center gap-4 bg-rm-bg-elevated p-12 rounded-3xl shadow-2xl border border-rm-border">
            <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <Download size={40} className="animate-bounce" />
            </div>
            <p className="text-xl font-bold text-rm-text-primary">Drop to upload</p>
            <p className="text-sm text-rm-text-muted">You can upload files up to 25MB</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-rm-border bg-rm-bg-primary/60 backdrop-blur-md px-4 z-20 relative">
        <div className="flex items-center gap-1 group">
          <button
            className="cursor-pointer border-none bg-transparent p-1.5 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
            onClick={onMenuClick}
            title="Servers"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>

          {/* Mobile Channel Name (Clickable to open members/details) */}
          <button
            className="md:hidden flex items-center gap-1.5 group/mobiletext text-left max-w-[180px] hover:opacity-80 transition-opacity"
            onClick={onMembersClick}
          >
            {isDM ? <AtSign className="h-[22px] w-[22px] text-rm-text-muted shrink-0" /> : <Hash className="h-[22px] w-[22px] text-rm-text-muted shrink-0" />}
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-0.5 text-[17px] font-extrabold text-rm-text tracking-tight leading-none truncate">
                <span className="truncate">{channelName}</span>
                <ChevronRight className="h-[14px] w-[14px] text-rm-text-muted shrink-0" />
              </div>
              <span className="text-[11px] text-rm-text-muted font-semibold flex items-center gap-1 mt-0.5 leading-none">
                <div className="w-1.5 h-1.5 rounded-full bg-rm-text-muted/60" />
                {state.members?.length || 0} Members
              </span>
            </div>
          </button>

          {/* Desktop Channel Name (Static) */}
          <div className="hidden items-center gap-2 md:flex pl-1">
            {isDM ? (
              <AtSign className="h-5 w-5 text-rm-text-muted transition-colors group-hover:text-rm-text-secondary" />
            ) : (
              <Hash className="h-5 w-5 text-rm-text-muted transition-colors group-hover:text-rm-text-secondary" />
            )}
            <h2 className="text-[15px] font-semibold text-rm-text-primary tracking-tight leading-none">{channelName}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 text-rm-text-muted">
          <div className="hidden md:flex items-center gap-2 md:gap-4 border-r border-rm-border pr-2 md:pr-4">
            <button
              className="group relative flex h-6 w-6 cursor-pointer items-center justify-center transition-all hover:bg-rm-bg-hover rounded-md"
              title="Pinned Messages"
              onClick={handleTogglePins}
              ref={pinButtonRef}
            >
              <Pin className={cn(
                "h-[14px] w-[14px] transition-colors",
                showPins ? "text-indigo-400 rotate-45" : "text-rm-text-muted group-hover:text-rm-text"
              )} />
              {pinnedCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-primary-foreground">
                  {pinnedCount}
                </span>
              )}
            </button>
            <NotificationBell />
            {onMembersClick && (
              <Users
                className={cn(
                  "h-[18px] w-[18px] cursor-pointer transition-all hover:text-rm-text",
                  showMembers ? "text-indigo-400" : "text-rm-text-muted"
                )}
                onClick={onMembersClick}
              />
            )}
          </div>
          <div className="flex items-center">
            <div className="hidden md:flex relative items-center w-36 overflow-hidden rounded-[3px] bg-rm-bg-elevated border border-rm-border hover:w-56 transition-all duration-300">
              <input type="text" placeholder={`Search ${channelName}`} className="w-full bg-transparent px-2 py-1 flex-1 text-[13px] text-rm-text outline-none placeholder:text-rm-text-muted" onClick={() => setShowSearch(true)} />
              <Search className="absolute right-2 h-4 w-4 text-rm-text-muted pointer-events-none" />
            </div>
            <button className="md:hidden flex items-center justify-center p-1.5 text-rm-text-muted hover:text-rm-text" onClick={() => setShowSearch(true)}>
              <Search className="h-5 w-5" />
            </button>
          </div>
          {onClose && (
            <button
              className="flex items-center ml-4 outline-none group"
              onClick={onClose}
              title="Close Chat"
            >
              <X className="h-4 w-4 text-rm-text-muted hover:text-rm-text cursor-pointer transition-all" />
            </button>
          )}
        </div>
      </header>

      <PinModal
        isOpen={pinModal.isOpen}
        onClose={() => setPinModal({ isOpen: false, message: null, mode: 'pin' })}
        onConfirm={confirmPinAction}
        message={pinModal.message}
        mode={pinModal.mode}
        channelName={channelName}
      />

      {/* Pinned messages panel */}
      {showPins && (
        <div
          className="absolute inset-0 z-50 md:inset-auto md:right-4 md:top-14"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPins(false);
          }}
        >
          <div ref={pinSidebarRef} className="h-full w-full bg-rm-bg-primary/50 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none flex sm:justify-end items-start pointer-events-auto">
            <PinnedMessagesSidebar
              messages={state.pinnedMessages}
              isLoading={state.loadingPins}
              onClose={() => setShowPins(false)}
              onJumpToMessage={handleJumpToMessage}
              onUnpin={handleUnpin}
              canUnpin={canPin}
            />
          </div>
        </div>
      )}

      {/* Search overlay */}
      {showSearch && state.activeServerId && (
        <SearchPanel
          serverId={state.activeServerId}
          onClose={() => setShowSearch(false)}
          onJump={(targetChannelId, messageId) => {
            if (targetChannelId === channelId) {
              handleJumpToMessage(messageId);
            } else {
              const event = new CustomEvent('navigate-channel', {
                detail: { channelId: targetChannelId, messageId }
              });
              window.dispatchEvent(event);
            }
          }}
          onNavigate={(targetChannelId) => {
            const event = new CustomEvent('navigate-channel', {
              detail: { channelId: targetChannelId }
            });
            window.dispatchEvent(event);
          }}
        />
      )}

      {/* Main Content Area (Messages+Input on left, MemberList on right) */}
      <div className="flex flex-1 min-h-0 min-w-0 flex-row">

        {/* Left Column: Messages & Input */}
        <div className="flex flex-1 flex-col min-w-0 bg-rm-bg-primary relative border-r border-white/5">
          {/* Messages */}
          <div className="flex flex-1 min-h-0 flex-col">
            <VirtualMessageList
              ref={virtualListRef}
              messages={state.messages}
              currentUserId={state.user?.id}
              canPin={canPin}
              hasMore={hasMore}
              loading={loading}
              isDetached={isDetached}
              initialScrollMessageId={anchorScrollId}
              onLoadMore={handleLoadMore}
              onLoadAfter={isDetached && hasMoreAfterAnchor ? handleLoadAfter : undefined}
              onReply={handleReply}
              onPin={handlePin}
              onUnpin={handleUnpin}
              onJump={handleJumpToMessage}
              onBan={canBan ? handleBan : undefined}
              onThread={handleThread}
              welcomeContent={
                channelId ? (
                  <div className="flex flex-col items-start px-4 text-left">
                    {isDM ? (
                      <>
                        <div className="mb-6 flex overflow-hidden rounded-full ring-2 ring-rm-border shadow-2xl transition-transform duration-500 hover:scale-105">
                          {state.dmChannels.find(c => c.id === channelId)?.recipient?.avatar_url ? (
                            <img
                              src={state.dmChannels.find(c => c.id === channelId)!.recipient.avatar_url!}
                              alt=""
                              className="h-24 w-24 object-cover"
                            />
                          ) : (
                            <div className="flex h-24 w-24 items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl font-bold text-primary-foreground">
                              {channelName?.[0]?.toUpperCase() ?? "?"}
                            </div>
                          )}
                        </div>
                        <h1 className="mb-0 text-3xl font-black tracking-tight text-rm-text-primary">
                          {state.dmChannels.find(c => c.id === channelId)?.recipient?.username ?? channelName}
                        </h1>
                        <h2 className="mb-4 text-xl font-bold text-rm-text-muted tracking-tight">
                          @{state.dmChannels.find(c => c.id === channelId)?.recipient?.username ?? channelName.toLowerCase()}
                        </h2>
                        <p className="max-w-md text-[14px] font-medium leading-relaxed text-rm-text-muted">
                          This is the absolute beginning of your direct message history with{" "}
                          <span className="text-rm-text-secondary font-semibold">{channelName}</span>. Be kind, be bold, and let the conversation flow.
                        </p>
                        <div className="flex gap-3 mt-6">
                          <button className="rounded-lg bg-rm-bg-hover border border-rm-border px-4 py-2 text-[12px] font-bold text-rm-text transition-all hover:bg-rm-bg-active active:scale-95">
                            View Profile
                          </button>
                          <button className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-2 text-[12px] font-bold text-rose-400 transition-all hover:bg-rose-500/20 active:scale-95">
                            Block User
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-6 flex h-20 w-20 rotate-6 items-center justify-center rounded-3xl border border-indigo-500/20 bg-indigo-500/10 shadow-2xl transition-transform duration-500 hover:rotate-0">
                          <Hash className="h-10 w-10 text-indigo-400 opacity-80" />
                        </div>
                        <h3 className="mb-2 text-3xl font-semibold tracking-tight text-rm-text-primary">
                          Welcome to #{channelName}
                        </h3>
                        <p className="max-w-lg text-sm font-medium leading-relaxed text-rm-text-muted">
                          This is the absolute beginning of the #{channelName} channel. Start a conversation, forge new paths, and let your frequencies align.
                        </p>
                      </>
                    )}
                    <div className="mt-8 h-px w-full bg-gradient-to-r from-rm-border to-transparent" />
                  </div>
                ) : undefined
              }
            />
          </div>

          {/* Jump to Present — shown when viewing an anchor context window */}
          {isDetached && (
            <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
              <button
                onClick={handleJumpToPresent}
                className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-600/90 px-4 py-2 text-[12px] font-bold text-white shadow-lg shadow-indigo-900/40 backdrop-blur-sm transition-all hover:bg-indigo-500 hover:shadow-indigo-700/50 hover:scale-105 active:scale-95"
              >
                <span>Jump to Present</span>
                <span className="text-[14px] leading-none">↓</span>
              </button>
            </div>
          )}

          {/* Input Area */}
          <div className="shrink-0 relative">
            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="pointer-events-none absolute bottom-full mb-2 left-6 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-rm-bg-elevated/90 backdrop-blur-md border border-rm-border shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-in fade-in slide-in-from-bottom-1 duration-300">
                <div className="flex gap-1 pb-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-400" />
                </div>
                <p className="text-[11px] font-bold tracking-tight text-rm-text-muted leading-none">
                  <span className="text-indigo-400">
                    {typingUsers.length <= 3
                      ? typingUsers.join(", ")
                      : `${typingUsers.length} people`}
                  </span>
                  {typingUsers.length === 1 ? " is typing..." : " are typing..."}
                </p>
              </div>
            )}

            {canSendMessages || isDM ? (
              <MessageInput
                channelId={channelId}
                channelName={channelName}
                onSend={handleSend}
                onTyping={handleTyping}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
              />
            ) : (
              <div className="z-10 px-2 md:px-4 pb-2 md:pb-6 pt-0">
                <div className="flex h-[44px] items-center justify-center rounded-xl bg-rm-bg-elevated text-[13px] font-medium text-rm-text-muted border border-white/5 opacity-80 select-none cursor-not-allowed mx-2 md:mx-0">
                  You do not have permission to send messages in this channel.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Member list — only when a server is selected, not in voice, and not in DM mode */}
        {/* Member list — hidden when thread sidebar is open */}
        {showMembers && !isDM && state.activeServerId && !threadMessageId && (
          <>
            {onMembersClick && (
              <div
                className="lg:hidden fixed inset-0 z-[99] bg-black/50 animate-in fade-in duration-300"
                onClick={onMembersClick}
                aria-hidden="true"
              />
            )}
            <MemberList
              members={state.members}
              onlineUsers={state.onlineUsers}
              typingUsers={state.activeChannelId ? state.typingUsers[state.activeChannelId] : undefined}
              currentUserId={state.user?.id}
              onBan={canBan ? handleBan : undefined}
              onClose={onMembersClick}
              channelName={channelName}
            />
          </>
        )}

        {/* Thread sidebar — replaces member list when open */}
        {threadMessageId && channelId && (
          <ThreadSidebar
            channelId={channelId}
            rootMessageId={threadMessageId}
            currentUserId={state.user?.id}
            canPin={canPin}
            onReply={handleReply}
            onPin={handlePin}
            onUnpin={handleUnpin}
            onJump={handleJumpToMessage}
            onBan={canBan ? handleBan : undefined}
            onClose={() => setThreadMessageId(null)}
          />
        )}
      </div>
    </div>
  );
}

