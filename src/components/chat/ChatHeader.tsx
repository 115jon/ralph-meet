import { IconButton } from "@/components/ui/IconButton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { ArrowLeft, ChevronRight, Phone, Search } from "lucide-react";
import { AtSign, Hash, Pin, Users, X } from "./Icons";
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
  onClose,
  onCall,
  dmUsername,
  channelId,
}: ChatHeaderProps) {
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
      className="relative z-20 flex shrink-0 items-center justify-between border-b border-rm-border bg-rm-bg-primary px-2.5 md:px-4"
      style={{
        height: "calc(48px + var(--safe-area-top, 0px))",
        paddingTop: "var(--safe-area-top, 0px)",
      }}
    >
      <div className="flex items-center gap-1 group">
        <IconButton
          icon={ArrowLeft}
          variant="muted"
          size="sm"
          className="h-10 w-10 md:hidden"
          onClick={onMenuClick}
          title="Servers"
        />

        <button
          className="group/mobiletext flex min-w-0 max-w-[min(45vw,180px)] items-center gap-1.5 text-left transition-opacity hover:opacity-80 md:hidden"
          onClick={onMembersClick}
        >
          {isDM ? (
            <AtSign className="h-[22px] w-[22px] text-rm-text-muted shrink-0" />
          ) : (
            <Hash className="h-[22px] w-[22px] text-rm-text-muted shrink-0" />
          )}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-0.5 text-ui-md font-semibold text-rm-text leading-none truncate">
              <InlineEmojiText text={channelName} className="truncate" />
              <ChevronRight className="h-[14px] w-[14px] text-rm-text-muted shrink-0" />
            </div>
            {!isDM && (
              <span className="text-ui-2xs text-rm-text-muted font-medium flex items-center gap-1 mt-0.5 leading-none">
                <div className="w-1.5 h-1.5 rounded-full bg-rm-text-muted/60" />
                {memberCount} Members
              </span>
            )}
          </div>
        </button>

        <button
          className={cn(
            "hidden items-center gap-1.5 md:flex pl-1 group/chname transition-ui cursor-pointer rounded-md px-2 py-1 -ml-2",
            showChannelDetails ? "bg-rm-bg-hover" : "hover:bg-rm-bg-hover/60",
          )}
          onClick={onToggleChannelDetails}
          title="View channel details"
        >
          {isDM ? (
            <AtSign className="h-5 w-5 text-rm-text-muted transition-colors group-hover/chname:text-rm-text-secondary shrink-0" />
          ) : (
            <Hash className="h-5 w-5 text-rm-text-muted transition-colors group-hover/chname:text-rm-text-secondary shrink-0" />
          )}
          {isDM && dmUsername ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <h2
                  className={cn(
                    "text-ui-base font-semibold text-rm-text-primary leading-none",
                    "group-hover/chname:underline underline-offset-2",
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
                "text-ui-base font-semibold text-rm-text-primary leading-none",
                "group-hover/chname:underline underline-offset-2",
              )}
            >
              <InlineEmojiText text={channelName} />
            </h2>
          )}
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-ui shrink-0",
              showChannelDetails
                ? "rotate-90 text-primary"
                : "text-rm-text-muted/40 group-hover/chname:text-rm-text-muted",
            )}
          />
        </button>
      </div>

      <div className="flex items-center gap-1 text-rm-text-muted md:gap-2">
        <div className="hidden md:flex items-center gap-0.5 border-r border-rm-border pr-2">
          {isDM && onCall && !hideCallButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  icon={Phone}
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
          <button
            type="button"
            aria-label="Pinned messages"
            aria-pressed={showPins}
            className="group relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-ui hover:bg-rm-bg-hover enabled:active:scale-[0.96]"
            title="Pinned Messages"
            onClick={handleTogglePins}
            ref={pinButtonRef}
          >
            <Pin
              className={cn(
                "h-[18px] w-[18px] transition-colors",
                showPins
                  ? "text-rm-accent rotate-45"
                  : "text-rm-text-muted group-hover:text-rm-text",
              )}
            />
            {pinnedCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 badge-count bg-rm-accent">
                {pinnedCount}
              </span>
            )}
          </button>
          <NotificationBell />
          {onMembersClick && (
            <IconButton
              icon={Users}
              variant="muted"
              size="sm"
              aria-label="Members"
              aria-pressed={showMembers}
              className={cn(
                showMembers && "text-rm-accent hover:text-rm-accent",
              )}
              onClick={onMembersClick}
            />
          )}
        </div>
        <div className="flex items-center">
          <button
            type="button"
            className="hidden md:inline-flex h-8 items-center gap-2 rounded-md border border-rm-border bg-rm-bg-elevated px-2.5 text-ui-sm font-medium text-rm-text-muted transition-ui hover:border-rm-border-strong hover:text-rm-text"
            onClick={onOpenSearch}
            title={`Search ${channelName}`}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[110px] truncate">Search</span>
          </button>
          <IconButton
            icon={Search}
            variant="muted"
            size="sm"
            className="h-10 w-10 md:hidden"
            onClick={onOpenSearch}
          />
        </div>
        {onClose && (
          <IconButton
            icon={X}
            variant="muted"
            size="sm"
            className="ml-1 rounded-md border border-rm-border bg-rm-bg-elevated hover:bg-rm-bg-hover"
            onClick={onClose}
            title="Close Chat"
          />
        )}
      </div>
    </header>
  );
}
