import { SidePanel, useSidePanelLayout } from "@/components/ui/side-panel";
import { useBackButton } from "@/hooks/useBackButton";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/types";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ChannelSettingsModal from "./ChannelSettingsModal";
import MemberList from "./MemberList";
import MessageInput, { ComposerReadOnly } from "./MessageInput";
import { PinModal } from "./PinModal";
import { PinnedMessagesSidebar } from "./PinnedMessagesSidebar";
import SearchPanel, { type SearchScope } from "./SearchPanel";
import { OPEN_MESSAGE_SEARCH_EVENT } from "./search/open-message-search";
import { useChatStore } from "@/stores/chat-store";
import ThreadSidebar from "./ThreadSidebar";
import { UnreadBanner } from "./UnreadBanner";
import VirtualMessageList from "./VirtualMessageList";

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
  onInviteClick?: () => void;
  serverId?: string | null;
  onCall?: () => void;
  dmUsername?: string;
}

import { ChatHeader } from "./ChatHeader";
import { ColumnConnectionSlot } from "./ConnectionBanner";
import { ChatJumpToPresent } from "./ChatJumpToPresent";
import { ChatTypingIndicator } from "./ChatTypingIndicator";
import { ChatWelcomeContent } from "./ChatWelcomeContent";
import { DMCallRegion } from "./DMCallRegion";
import { BanMemberDialog } from "./BanMemberDialog";
import { DragDropOverlay } from "./DragDropOverlay";
import { EmptyChatArea } from "./EmptyChatArea";

// --- Main Component ---

import { useChatArea } from "./useChatArea";

const MemoizedChatWelcomeContent = memo(ChatWelcomeContent);

export default function ChatArea({
  channelId,
  channelName,
  onMenuClick,
  onMembersClick,
  showMembers,
  isDM,
  jumpToMessageId,
  onJumped,
  onClose,
  onInviteClick,
  serverId,
  onCall,
  dmUsername,
}: Props) {
  const {
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
    restoreInProgress,
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
    banTarget,
    closeBan,
    confirmBan,
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
    canDeleteMessages,
    canBan,
    canManageChannel,
    channelData,
    dispatch,
    unreadSeparatorId,
    unreadCount,
    unreadSince,
    handleInitialScrollSettled,
    handleMessageVisible,
  } = useChatArea({ channelId, jumpToMessageId, onJumped });
  const [renderedPinMessage, setRenderedPinMessage] = useState(
    pinModal.message ?? null,
  );
  useEffect(() => {
    if (pinModal.message) {
      // Retain the confirmation payload while Radix runs the close animation.
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setRenderedPinMessage(pinModal.message);
    }
  }, [pinModal.message]);
  const pinMessage = pinModal.message ?? renderedPinMessage;
  const [renderedChannelSettings, setRenderedChannelSettings] =
    useState<Channel | null>(channelData ?? null);
  useEffect(() => {
    if (channelData) {
      // Retain the channel payload while Radix runs the close animation.
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setRenderedChannelSettings(channelData);
    }
  }, [channelData]);
  const channelSettingsPayload = channelData ?? renderedChannelSettings;

  // Search is a docked column / phone page of its own; the other panels
  // (thread, pins, members) are SidePanels that answer the back button.
  useBackButton(
    useCallback(() => {
      setLocalState({ showSearch: false });
      return true;
    }, [setLocalState]),
    showSearch,
  );

  const [searchRequest, setSearchRequest] = useState({ text: "", n: 0 });
  const serverName = useChatStore(
    (s) => s.servers.find((server) => server.id === state.activeServerId)?.name,
  );
  const searchScope = useMemo<SearchScope | null>(() => {
    if (isDM) return channelId ? { kind: "channel", channelId } : null;
    const id = serverId ?? state.activeServerId;
    return id && id !== "@me" ? { kind: "server", serverId: id } : null;
  }, [isDM, channelId, serverId, state.activeServerId]);
  const searchScopeKey = searchScope
    ? searchScope.kind === "server"
      ? searchScope.serverId
      : searchScope.channelId
    : "none";
  const searchScopeLabel = isDM ? channelName : (serverName ?? "this server");
  const closeSearch = useCallback(
    () => setLocalState({ showSearch: false }),
    [setLocalState],
  );
  const handleSearchJump = useCallback(
    (targetChannelId: string, messageId: string) => {
      if (targetChannelId === channelId) {
        handleJumpToMessage(messageId);
      } else {
        window.dispatchEvent(
          new CustomEvent("navigate-channel", {
            detail: { channelId: targetChannelId, messageId },
          }),
        );
      }
    },
    [channelId, handleJumpToMessage],
  );

  // The quick switcher (and anything else) can open search with a query.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string } | undefined>)
        .detail;
      setSearchRequest((prev) => ({
        text: typeof detail?.text === "string" ? detail.text : "",
        n: prev.n + 1,
      }));
      setLocalState({ showSearch: true });
    };
    window.addEventListener(OPEN_MESSAGE_SEARCH_EVENT, open);
    return () => window.removeEventListener(OPEN_MESSAGE_SEARCH_EVENT, open);
  }, [setLocalState]);

  const computedMembers = useMemo(() => {
    if (isDM && state.user) {
      const dmChannel = state.dmChannels.find((c: any) => c.id === channelId);
      if (dmChannel?.recipient) {
        return [
          { user: state.user, roles: [] },
          { user: dmChannel.recipient, roles: [] },
        ];
      }
    }
    return state.members || [];
  }, [isDM, state.user, state.dmChannels, channelId, state.members]);

  const welcomeContent = useMemo(
    () => (
      <MemoizedChatWelcomeContent
        isDM={!!isDM}
        channelName={channelName}
        channelId={channelId}
      />
    ),
    [channelId, channelName, isDM],
  );

  const searchOpen = showSearch && !!searchScope;
  const threadOpen = !searchOpen && !!threadMessageId && !!channelId;
  const pinsOpen = !searchOpen && !threadOpen && showPins;
  const membersOpen =
    !searchOpen &&
    !threadOpen &&
    !pinsOpen &&
    (showMembers || showChannelDetails);
  const membersMode = useSidePanelLayout(true);
  // Keep the thread mounted while its sheet/drawer animates out.
  const [lastThread, setLastThread] = useState<{
    channelId: string;
    id: string;
  } | null>(null);
  if (
    threadMessageId &&
    channelId &&
    (lastThread?.id !== threadMessageId || lastThread?.channelId !== channelId)
  ) {
    setLastThread({ channelId, id: threadMessageId });
  }
  const threadPanelId =
    threadMessageId ??
    (lastThread?.channelId === channelId ? lastThread.id : null);

  if (!channelId) {
    return <EmptyChatArea onMenuClick={onMenuClick} />;
  }

  return (
    <div
      className="flex flex-1 flex-col min-h-0 min-w-0 relative bg-ply-0 chat-area-container"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DragDropOverlay isDragging={isDragging} />

      <ChatHeader
        isDM={isDM}
        channelName={channelName}
        channelId={channelId}
        memberCount={computedMembers.length}
        showChannelDetails={showChannelDetails}
        onToggleChannelDetails={() =>
          setLocalState((prev: any) => ({
            showChannelDetails: !prev.showChannelDetails,
          }))
        }
        onMenuClick={onMenuClick}
        onMembersClick={onMembersClick}
        showMembers={showMembers}
        handleTogglePins={handleTogglePins}
        pinButtonRef={pinButtonRef}
        pinnedCount={pinnedCount}
        showPins={showPins}
        onOpenSearch={() => setLocalState({ showSearch: !showSearch })}
        showSearch={showSearch}
        onClose={onClose}
        onCall={onCall}
        dmUsername={dmUsername}
      />
      {/* The connection strip sits in the flow under the header, so a drop
          pushes the messages down instead of covering the first line. */}
      <ColumnConnectionSlot />

      <BanMemberDialog
        target={banTarget}
        onClose={closeBan}
        onBan={confirmBan}
      />

      {pinMessage && (
        <PinModal
          isOpen={pinModal.isOpen}
          onClose={() =>
            setLocalState({
              pinModal: { ...pinModal, isOpen: false },
            })
          }
          onConfirm={confirmPinAction}
          message={pinMessage}
          mode={pinModal.mode}
          channelName={channelName}
        />
      )}

      <div className="flex flex-1 min-h-0 min-w-0 flex-row">
        <div className="flex flex-1 flex-col min-w-0 min-h-0 bg-ply-0 relative chat-messages-container">
          <div className="flex flex-1 min-h-0 flex-col">
            {/* In-DM call region */}
            {isDM && channelId && <DMCallRegion channelId={channelId} />}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Overlays the list's top edge (and its sticky day label), so
                the column never jumps when unread state changes. */}
              {unreadCount > 0 && unreadSince && (
                <UnreadBanner
                  count={unreadCount}
                  since={unreadSince}
                  onMarkAsRead={handleMarkAsRead}
                  className="absolute inset-x-0 top-0"
                />
              )}
              <VirtualMessageList
                ref={virtualListRef}
                messages={state.messages}
                currentUserId={state.user?.id}
                canPin={canPin}
                canDeleteMessages={canDeleteMessages}
                hasMore={hasMore}
                loading={loading}
                isDetached={isDetached}
                initialScrollMessageId={anchorScrollId}
                initialScrollAlign={localState.initialScrollAlign || "center"}
                initialScrollBehavior={
                  localState.initialScrollBehavior || "auto"
                }
                highlightInitialScroll={highlightAnchor}
                restoreInProgress={restoreInProgress}
                onInitialScrollSettled={() => {
                  handleInitialScrollSettled();
                  setLocalState({ restoreInProgress: false });
                }}
                unreadSeparatorId={unreadSeparatorId}
                onLoadMore={handleLoadMore}
                onLoadAfter={
                  isDetached && hasMoreAfterAnchor ? handleLoadAfter : undefined
                }
                onReply={handleReply}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onJump={handleJumpToMessage}
                onBan={canBan ? handleBan : undefined}
                onThread={handleThread}
                welcomeContent={welcomeContent}
                onAtBottom={handleAtBottom}
                onScrollRangeChange={handleScrollRangeChange}
                onMessageVisible={handleMessageVisible}
              />
            </div>
          </div>

          <ChatJumpToPresent
            isDetached={isDetached}
            onJumpToPresent={handleJumpToPresent}
          />

          <div className="relative shrink-0">
            {/* The typing band: a 24px row of its own above the composer,
                so the pill never covers the last message. */}
            <div className="flex h-6 items-center px-4">
              <ChatTypingIndicator typingUsers={typingUsers} />
            </div>
            {canSendMessages || isDM ? (
              <MessageInput
                channelId={channelId}
                channelName={channelName}
                isDM={isDM}
                onSend={handleSend}
                onTyping={handleTyping}
                replyTo={replyTo}
                onCancelReply={() => setLocalState({ replyTo: null })}
              />
            ) : (
              <ComposerReadOnly />
            )}
          </div>
        </div>

        {searchOpen ? (
          <SearchPanel
            key={`${searchScopeKey}:${searchRequest.n}`}
            scope={searchScope!}
            scopeLabel={searchScopeLabel}
            initialText={searchRequest.text}
            onClose={closeSearch}
            onJump={handleSearchJump}
          />
        ) : null}

        {/*
         * One right-hand panel at a time (search > thread > pins > members).
         * Each is a SidePanel: docked at lg, a sheet below, a drawer on
         * phones; it owns its scrim, Escape, back button and focus return.
         */}
        {threadPanelId && channelId ? (
          <ThreadSidebar
            open={threadOpen}
            channelId={channelId}
            rootMessageId={threadPanelId}
            currentUserId={state.user?.id}
            canPin={canPin}
            canDeleteMessages={canDeleteMessages}
            onReply={handleReply}
            onPin={handlePin}
            onUnpin={handleUnpin}
            onJump={handleJumpToMessage}
            onBan={canBan ? handleBan : undefined}
            onClose={() => setLocalState({ threadMessageId: null })}
          />
        ) : null}

        <PinnedMessagesSidebar
          open={pinsOpen}
          messages={state.pinnedMessages}
          isLoading={state.loadingPins}
          onClose={() => setLocalState({ showPins: false })}
          onJumpToMessage={handleJumpToMessage}
          onUnpin={handleUnpin}
          canUnpin={canPin}
        />

        <SidePanel
          open={membersOpen}
          onOpenChange={(next) => {
            if (next) return;
            if (showChannelDetails) {
              setLocalState({ showChannelDetails: false });
            }
            if (showMembers) onMembersClick?.();
          }}
          title={showChannelDetails ? channelName || "Details" : "Members"}
          hideHeader={membersMode !== "sheet" || showChannelDetails}
          dockClassName={cn(
            "border-l border-line bg-ply-0",
            showChannelDetails ? "w-[360px]" : "w-60",
          )}
        >
          <MemberList
            members={computedMembers}
            onlineUsers={state.onlineUsers}
            typingUsers={
              state.activeChannelId
                ? state.typingUsers[state.activeChannelId]
                : undefined
            }
            currentUserId={state.user?.id}
            onBan={canBan ? handleBan : undefined}
            onClose={() => {
              if (showChannelDetails) {
                setLocalState({ showChannelDetails: false });
              }
              if (showMembers) onMembersClick?.();
            }}
            channelName={channelName}
            channelId={channelId}
            serverId={serverId ?? state.activeServerId}
            onOpenSearch={() => {
              setLocalState({ showSearch: true });
            }}
            onOpenSettings={
              !isDM && canManageChannel && channelSettingsPayload
                ? () => setLocalState({ showChannelSettings: true })
                : undefined
            }
            onInviteClick={onInviteClick}
            onJumpToMessage={handleJumpToMessage}
            onOpenThread={(messageId) => {
              setLocalState({ threadMessageId: messageId });
            }}
            showDetails={showChannelDetails}
            onToggleDetails={() => setLocalState({ showChannelDetails: false })}
            isDM={isDM}
          />
        </SidePanel>
      </div>

      {channelSettingsPayload && (serverId ?? state.activeServerId) && (
        <ChannelSettingsModal
          open={showChannelSettings}
          serverId={(serverId ?? state.activeServerId)!}
          channel={channelSettingsPayload}
          onUpdated={(updates) =>
            dispatch({
              type: "UPSERT_CHANNEL",
              channel: { ...channelSettingsPayload, ...updates },
            })
          }
          onClose={() => setLocalState({ showChannelSettings: false })}
        />
      )}
    </div>
  );
}
