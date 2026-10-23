import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
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

  // Determine if the local user is actively in the call SFU on this channel
  const voiceChannelStates = useChatStore((s) => s.voiceChannelStates);
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

  // Show "Join Call" when others are already in the voice channel
  const hasExistingCall = !!(
    channelId && voiceChannelStates[channelId]?.length > 0
  );

  return (
    <header
      className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-rm-border bg-rm-bg-primary px-4 max-md:pl-2"
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
          size="md"
          className="md:hidden"
          onClick={onMenuClick}
          title="Servers"
        />

        <button
          type="button"
          className={cn(
            "relative flex min-w-0 max-w-[min(55vw,240px)] items-center gap-2 rounded-md text-left outline-none md:hidden",
            HIT,
          )}
          onClick={onMembersClick}
        >
          <Icon
            name={channelIcon}
            size="lg"
            className="text-rm-text-muted shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-0.5 text-ui-md font-semibold text-rm-text leading-none truncate">
              <InlineEmojiText text={channelName} className="truncate" />
              <Icon
                name="chevronRight"
                size="xs"
                className="text-rm-text-muted shrink-0"
              />
            </div>
            {!isDM && (
              <span className="mt-0.5 flex items-center gap-1 text-ui-xs leading-4 text-rm-text-secondary">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-rm-text-muted"
                />
                {memberCount} Members
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          className={cn(
            "relative hidden h-8 cursor-pointer items-center gap-2 rounded-md px-2 group/chname transition-colors duration-150 md:flex",
            HIT,
            showChannelDetails
              ? "bg-rm-tint-2"
              : "pointer-fine:hover:bg-rm-tint-1",
          )}
          onClick={onToggleChannelDetails}
          title="View channel details"
        >
          <Icon
            name={channelIcon}
            size="lg"
            className="text-rm-text-muted transition-colors pointer-fine:group-hover/chname:text-rm-text-secondary shrink-0"
          />
          {isDM && dmUsername ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <h2
                  className={cn(
                    "text-ui-md font-semibold text-rm-text leading-none",
                    "pointer-fine:group-hover/chname:underline underline-offset-2",
                  )}
                >
                  <InlineEmojiText text={channelName} />
                </h2>
              </TooltipTrigger>
              <TooltipContent side="bottom">@{dmUsername}</TooltipContent>
            </Tooltip>
          ) : (
            <h2
              className={cn(
                "text-ui-md font-semibold text-rm-text leading-none",
                "pointer-fine:group-hover/chname:underline underline-offset-2",
              )}
            >
              <InlineEmojiText text={channelName} />
            </h2>
          )}
          <Icon
            name="chevronRight"
            size="xs"
            className={cn(
              "transition-ui shrink-0",
              showChannelDetails
                ? "rotate-90 text-rm-text"
                : "text-rm-text-muted pointer-fine:group-hover/chname:text-rm-text-secondary",
            )}
          />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-rm-text-muted">
        <div className="hidden items-center gap-2 border-r border-rm-border pr-2 md:flex">
          {isDM && onCall && !hideCallButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label={
                    hasExistingCall ? "Join Call" : "Start Voice Call"
                  }
                  icon="call"
                  variant="muted"
                  size="sm"
                  onClick={onCall}
                  title={hasExistingCall ? "Join Call" : "Start Voice Call"}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <p>{hasExistingCall ? "Join Call" : "Start Voice Call"}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Pinned messages"
            aria-pressed={showPins}
            className="text-rm-text-muted pointer-fine:hover:text-rm-text aria-pressed:bg-rm-tint-2 aria-pressed:text-rm-text"
            title="Pinned Messages"
            onClick={handleTogglePins}
            ref={pinButtonRef}
          >
            <Icon name="pin" state={showPins ? "active" : "idle"} size="lg" />
            {pinnedCount > 0 && (
              <span className="badge-count absolute -top-0.5 -right-0.5">
                {pinnedCount}
              </span>
            )}
          </Button>
          <NotificationBell />
          {onMembersClick && (
            <IconButton
              icon="members"
              iconState={showMembers ? "active" : "idle"}
              variant="muted"
              size="sm"
              aria-label="Members"
              aria-pressed={showMembers}
              onClick={onMembersClick}
            />
          )}
        </div>
        <div className="flex items-center">
          <button
            type="button"
            aria-pressed={showSearch}
            className={cn(
              "hidden md:inline-flex h-8 w-[168px] items-center gap-2 rounded-md bg-rm-tint-1 px-2.5 text-ui-sm font-medium text-rm-text-muted outline-none pointer-fine:hover:text-rm-text aria-pressed:bg-rm-tint-2 aria-pressed:text-rm-text lg:w-[200px]",
              PRESS,
              HIT,
            )}
            onClick={onOpenSearch}
            title={isDM ? "Search this conversation" : "Search messages"}
          >
            <Icon name="search" size="sm" className="shrink-0" />
            <span className="truncate">Search</span>
          </button>
          <IconButton
            aria-label="Search"
            icon="search"
            variant="muted"
            size="md"
            className="md:hidden"
            onClick={onOpenSearch}
          />
        </div>
        {onClose && (
          <IconButton
            aria-label="Close Chat"
            icon="close"
            variant="muted"
            size="sm"
            className="ml-1"
            onClick={onClose}
            title="Close Chat"
          />
        )}
      </div>
    </header>
  );
}
