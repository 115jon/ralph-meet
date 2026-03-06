import { useBackButton } from "@/hooks/useBackButton";
import type { Channel } from "@/lib/types";
import { useCallback } from "react";
import ChannelSettingsModal from "./ChannelSettingsModal";
import MemberList from "./MemberList";
import MessageInput from "./MessageInput";
import { PinModal } from "./PinModal";
import { PinnedMessagesSidebar } from "./PinnedMessagesSidebar";
import SearchPanel from "./SearchPanel";
import ThreadSidebar from "./ThreadSidebar";
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
}

import { ChatHeader } from "./ChatHeader";
import { ChatJumpToPresent } from "./ChatJumpToPresent";
import { ChatTypingIndicator } from "./ChatTypingIndicator";
import { ChatWelcomeContent } from "./ChatWelcomeContent";
import { DragDropOverlay } from "./DragDropOverlay";
import { EmptyChatArea } from "./EmptyChatArea";

// --- Main Component ---

import { useChatArea } from "./useChatArea";

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
    onDragOver,
    onDragLeave,
    onDrop,
    typingUsers,
    pinnedCount,
    canSendMessages,
    canPin,
    canBan,
    channelData,
  } = useChatArea({ channelId, jumpToMessageId, onJumped });

  if (!channelId) {
    return <EmptyChatArea onMenuClick={onMenuClick} />;
  }

  useBackButton(
    useCallback(() => {
      // 1. Priority: Context menus and popovers (handled by their own hooks theoretically or modals)
      // 2. Search Panel
      if (showSearch) {
        setLocalState({ showSearch: false });
        // NOTE: search panel has its own focus, but this ensures clicking back closes it
        return true;
      }
      // 3. Pinned messages
      if (showPins) {
        setLocalState({ showPins: false });
        return true;
      }
      // 4. Thread sidebar
      if (threadMessageId) {
        setLocalState({ threadMessageId: null });
        return true;
      }
      // 5. Channel details (on mobile)
      if (showChannelDetails) {
        setLocalState({ showChannelDetails: false });
        return true;
      }
      // 6. Member list (on mobile)
      if (showMembers && onMembersClick) {
        // Technically onMembersClick toggles it in the parent (ChatPageClient)
        // But let's verify if we are on a smaller screen since this UI is usually pervasive on desktop
        if (window.innerWidth < 768) {
          onMembersClick();
          return true;
        }
      }

      return false; // allow to cascade to next (parent, e.g. ChatPageClient)
    }, [showSearch, showPins, threadMessageId, showChannelDetails, showMembers, onMembersClick, setLocalState]),
    showSearch || showPins || !!threadMessageId || showChannelDetails || !!(showMembers && onMembersClick)
  );

  return (
    <div
      className="flex flex-1 flex-col min-h-0 min-w-0 relative bg-rm-bg-primary"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DragDropOverlay isDragging={isDragging} />

      <ChatHeader
        isDM={isDM}
        channelName={channelName}
        memberCount={state.members?.length || 0}
        showChannelDetails={showChannelDetails}
        onToggleChannelDetails={() => setLocalState((prev: any) => ({ showChannelDetails: !prev.showChannelDetails }))}
        onMenuClick={onMenuClick}
        onMembersClick={onMembersClick}
        showMembers={showMembers}
        handleTogglePins={handleTogglePins}
        pinButtonRef={pinButtonRef}
        pinnedCount={pinnedCount}
        showPins={showPins}
        onOpenSearch={() => setLocalState({ showSearch: true })}
        onClose={onClose}
      />

      <PinModal
        isOpen={pinModal.isOpen}
        onClose={() => setLocalState({ pinModal: { isOpen: false, message: null, mode: 'pin' } })}
        onConfirm={confirmPinAction}
        message={pinModal.message}
        mode={pinModal.mode}
        channelName={channelName}
      />

      {showPins && (
        <div
          className="absolute inset-0 z-50 md:inset-auto md:right-4 md:top-14"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLocalState({ showPins: false });
          }}
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") setLocalState({ showPins: false });
          }}
        >
          <div ref={pinSidebarRef} className="h-full w-full bg-rm-bg-primary/50 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none flex sm:justify-end items-start pointer-events-auto">
            <PinnedMessagesSidebar
              messages={state.pinnedMessages}
              isLoading={state.loadingPins}
              onClose={() => setLocalState({ showPins: false })}
              onJumpToMessage={handleJumpToMessage}
              onUnpin={handleUnpin}
              canUnpin={canPin}
            />
          </div>
        </div>
      )}

      {showSearch && state.activeServerId && (
        <SearchPanel
          serverId={state.activeServerId}
          onClose={() => setLocalState({ showSearch: false })}
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

      <div className="flex flex-1 min-h-0 min-w-0 flex-row">
        <div className="flex flex-1 flex-col min-w-0 bg-rm-bg-primary relative border-r border-white/5">
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
                <ChatWelcomeContent isDM={!!isDM} channelName={channelName} channelId={channelId} state={state} />
              }
            />
          </div>

          <ChatJumpToPresent isDetached={isDetached} onJumpToPresent={handleJumpToPresent} />

          <div className="shrink-0 relative">
            <ChatTypingIndicator typingUsers={typingUsers} />
            {canSendMessages || isDM ? (
              <MessageInput
                channelId={channelId}
                channelName={channelName}
                onSend={handleSend}
                onTyping={handleTyping}
                replyTo={replyTo}
                onCancelReply={() => setLocalState({ replyTo: null })}
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

        {(showMembers || showChannelDetails) && !isDM && state.activeServerId && !threadMessageId && (
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
              channelId={channelId}
              serverId={serverId ?? state.activeServerId}
              onOpenSearch={() => {
                setLocalState({ showSearch: true });
              }}
              onOpenSettings={() => setLocalState({ showChannelSettings: true })}
              onInviteClick={onInviteClick}
              pinnedMessages={state.pinnedMessages}
              loadingPins={state.loadingPins}
              canUnpin={canPin}
              onUnpin={handleUnpin}
              onJumpToMessage={handleJumpToMessage}
              onOpenThread={(messageId) => {
                setLocalState({ threadMessageId: messageId });
              }}
              showDetails={showChannelDetails}
              onToggleDetails={() => setLocalState({ showChannelDetails: false })}
            />
          </>
        )}

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
            onClose={() => setLocalState({ threadMessageId: null })}
          />
        )}
      </div>

      {showChannelSettings && channelData && (serverId ?? state.activeServerId) && (
        <ChannelSettingsModal
          serverId={(serverId ?? state.activeServerId)!}
          channel={channelData as Channel}
          onClose={() => setLocalState({ showChannelSettings: false })}
        />
      )}
    </div>
  );
}
