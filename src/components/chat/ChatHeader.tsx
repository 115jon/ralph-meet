import { useEffect } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { FIELD_UNDERLINE } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Num } from "@/components/ui/num";
import { HIT } from "@/components/ui/interaction";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { Icon, type IconName } from "@/components/ui/icon";
import { getChannelIcon } from "@/lib/channel-icon";
import InlineEmojiText from "./InlineEmojiText";
import { NotificationBell } from "./NotificationBell";

interface ChatHeaderProps {
  isDM?: boolean;
  channelName: string;
  memberCount: number;
  showChannelDetails: boolean;
  onToggleChannelDetails: () => void;
  onMenuClick: () => void;
  onMembersClick?: () => void;
  showMembers?: boolean;
  handleTogglePins: () => void;
  pinButtonRef: React.RefObject<HTMLButtonElement | null>;
  pinnedCount: number;
  showPins: boolean;
  onOpenSearch: () => void;
  /** Search panel is open: the search button reads as pressed. */
  showSearch?: boolean;
  onClose?: () => void;
  onCall?: () => void;
  dmUsername?: string;
  channelId?: string | null;
}

export function ChatHeader({
  isDM,
  channelName,
  memberCount,
  showChannelDetails,
  onToggleChannelDetails,
  onMenuClick,
  onMembersClick,
  showMembers,
  handleTogglePins,
  pinButtonRef,
  pinnedCount,
  showPins,
  onOpenSearch,
  showSearch = false,
  onClose,
  onCall,
  dmUsername,
  channelId,
}: ChatHeaderProps) {
  const channel = useChatStore((s) =>
    channelId ? s.channels.find((c) => c.id === channelId) : undefined,
  );
  const channelIcon: IconName = isDM
    ? "mention"
    : channel
      ? getChannelIcon(channel)
      : "textChannel";

  // Determine if the local user is actively in the call SFU on this channel.
  // One boolean, so a voice-state change elsewhere never re-renders the header.
  const hasExistingCall = useChatStore((s) =>
    channelId ? (s.voiceChannelStates[channelId]?.length ?? 0) > 0 : false,
  );
  const callChannelId = useCallStore((s) => s.channelId);
  const callStatus = useCallStore((s) => s.status);
  const hasJoinedSFU = useCallStore((s) => s.hasJoinedSFU);

  // Hide button when the user is actively connected to the call or ringing
  const isInCallSFU =
    callStatus === "active" && callChannelId === channelId && hasJoinedSFU;
  const isRinging =
    (callStatus === "ringing_outgoing" || callStatus === "ringing_incoming") &&
    callChannelId === channelId;
  const hideCallButton = isInCallSFU || isRinging;
  // Search replaces the right column, so the members toggle reads unpressed
  // while it is open.
  const membersPressed = !!showMembers && !showSearch;

  // "/" opens search when nothing editable has focus (the hint on the
  // header field). Typing "/" in the composer still starts a command.
  useEffect(() => {
    if (showSearch) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='menu']",
        )
      )
        return;
      event.preventDefault();
      onOpenSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenSearch, showSearch]);
  const title = (
    <h2 className="min-w-0 truncate font-display-tuned text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1">
      <InlineEmojiText text={channelName} />
    </h2>
  );

  return (
    <header
      className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-line bg-ply-0 px-4 max-md:pl-2"
      style={{
        height: "calc(48px + var(--safe-area-top, 0px))",
        paddingTop: "var(--safe-area-top, 0px)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          aria-label="Servers"
          icon="back"
          variant="muted"
          size={40}
          className="md:hidden"
          onClick={onMenuClick}
          title="Servers"
        />

        <button
          type="button"
          className={cn(
            "relative flex min-w-0 items-center gap-2 rounded-md text-left outline-none md:hidden",
            HIT,
          )}
          onClick={onMembersClick}
        >
          <Icon name={channelIcon} size="lg" className="shrink-0 text-ink-3" />
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-0.5 truncate font-display-tuned text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1">
              <InlineEmojiText text={channelName} className="truncate" />
              <Icon
                name="chevronRight"
                size="xs"
                className="shrink-0 text-ink-3"
              />
            </div>
            {!isDM && (
              <span className="mt-0.5 flex items-center gap-1 text-ui-xs text-ink-2">
                <Num>{memberCount}</Num> members
              </span>
            )}
          </div>
        </button>

        {/* The title opens the channel details; it reads as a control by
            its hover tint and pressed state, not by a breadcrumb chevron. */}
        <button
          type="button"
          aria-pressed={showChannelDetails}
          className={cn(
            "group/chname relative hidden h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 outline-none transition-colors duration-(--dur-1) ease-out focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus md:flex",
            HIT,
            showChannelDetails ? "bg-tint-2" : "pointer-fine:hover:bg-tint-1",
          )}
          onClick={onToggleChannelDetails}
          title={showChannelDetails ? "Hide details" : "Channel details"}
        >
          <Icon
            name={channelIcon}
            size="lg"
            className="shrink-0 text-ink-3 transition-colors duration-(--dur-1) pointer-fine:group-hover/chname:text-ink-2"
          />
          {isDM && dmUsername ? (
            <>
              {title}
              <span aria-hidden className="h-4 w-px shrink-0 bg-line-strong" />
              <span className="min-w-0 truncate text-ui-sm text-ink-3">
                @{dmUsername}
              </span>
            </>
          ) : (
            title
          )}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-ink-3">
        <div className="hidden items-center gap-1 border-r border-line pr-2 md:flex">
          {isDM && onCall && !hideCallButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label={
                    hasExistingCall ? "Join call" : "Start voice call"
                  }
                  icon="call"
                  variant="muted"
                  size={40}
                  onClick={onCall}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {hasExistingCall ? "Join call" : "Start voice call"}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Pins: no count. The red badge means "needs you"; a pinned
              total never does. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                ref={pinButtonRef}
                icon="pin"
                variant="muted"
                size={40}
                tone={showPins ? "toggled" : "idle"}
                aria-label={
                  pinnedCount > 0
                    ? `Pinned messages, ${pinnedCount}`
                    : "Pinned messages"
                }
                aria-pressed={showPins}
                onClick={handleTogglePins}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              Pinned messages
            </TooltipContent>
          </Tooltip>
          <NotificationBell />
          {onMembersClick && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  icon="members"
                  variant="muted"
                  size={40}
                  tone={membersPressed ? "toggled" : "idle"}
                  aria-label="Members"
                  aria-pressed={membersPressed}
                  onClick={onMembersClick}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {membersPressed ? "Hide members" : "Show members"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center">
          {/* One search input on screen: while the panel is open its own
              field is the input, and this collapses to a pressed toggle. */}
          {showSearch ? (
            <IconButton
              icon="search"
              variant="muted"
              size={40}
              tone="toggled"
              aria-label="Search"
              aria-pressed
              className="hidden md:inline-flex"
              onClick={onOpenSearch}
            />
          ) : (
            /* C1 underline field: no box, a 2px line-field rule that turns
               accent on focus, an outline "/" key on the right. It opens the
               search panel, whose own input takes the typing. */
            <div className={cn(FIELD_UNDERLINE, "ml-2 hidden w-56 md:block")}>
              <button
                type="button"
                aria-pressed={false}
                aria-keyshortcuts="/"
                className={cn(
                  "flex h-9 w-full items-center gap-2 text-ui-sm text-ink-3 outline-none pointer-fine:hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  HIT,
                )}
                onClick={onOpenSearch}
                title={isDM ? "Search this conversation" : "Search messages"}
              >
                <Icon name="search" size="sm" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  Search
                </span>
                <Kbd variant="outline" size="sm" aria-hidden="true">
                  /
                </Kbd>
              </button>
            </div>
          )}
          <IconButton
            aria-label="Search"
            icon="search"
            variant="muted"
            size={40}
            className="md:hidden"
            onClick={onOpenSearch}
          />
        </div>
        {onClose && (
          <IconButton
            aria-label="Close chat"
            icon="close"
            variant="muted"
            size={40}
            className="ml-1"
            onClick={onClose}
            title="Close chat"
          />
        )}
      </div>
    </header>
  );
}
