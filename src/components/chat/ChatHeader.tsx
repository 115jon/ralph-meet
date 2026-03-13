import { IconButton } from "@/components/ui/IconButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { ArrowLeft, ChevronRight, Phone, Search } from "lucide-react";
import { AtSign, Hash, Pin, Users, X } from "./Icons";
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
  const isInCallSFU = callStatus === "active" && callChannelId === channelId && hasJoinedSFU;
  const isRinging = (callStatus === "ringing_outgoing" || callStatus === "ringing_incoming") && callChannelId === channelId;
  const hideCallButton = isInCallSFU || isRinging;

  // Show "Join Call" when others are already in the voice channel
  const hasExistingCall = !!(channelId && voiceChannelStates[channelId]?.length > 0);

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-rm-border bg-rm-bg-primary/60 backdrop-blur-md px-4 z-20 relative"
      style={{ height: 'calc(48px + var(--safe-area-top, 0px))', paddingTop: 'var(--safe-area-top, 0px)' }}
    >
      <div className="flex items-center gap-1 group">
        <IconButton
          icon={ArrowLeft}
          variant="muted"
          size="sm"
          className="md:hidden"
          onClick={onMenuClick}
          title="Servers"
        />

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
            {!isDM && (
              <span className="text-[11px] text-rm-text-muted font-semibold flex items-center gap-1 mt-0.5 leading-none">
                <div className="w-1.5 h-1.5 rounded-full bg-rm-text-muted/60" />
                {memberCount} Members
              </span>
            )}
          </div>
        </button>

        <button
          className={cn(
            "hidden items-center gap-1.5 md:flex pl-1 group/chname transition-all cursor-pointer rounded-md px-2 py-1 -ml-2",
            showChannelDetails
              ? "bg-rm-bg-hover"
              : "hover:bg-rm-bg-hover/60"
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
                <h2 className={cn(
                  "text-[15px] font-semibold text-rm-text-primary tracking-tight leading-none transition-all",
                  "group-hover/chname:underline underline-offset-2"
                )}>{channelName}</h2>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-medium shadow-xl px-3 py-2 rounded-lg">
                @{dmUsername}
              </TooltipContent>
            </Tooltip>
          ) : (
            <h2 className={cn(
              "text-[15px] font-semibold text-rm-text-primary tracking-tight leading-none transition-all",
              "group-hover/chname:underline underline-offset-2"
            )}>{channelName}</h2>
          )}
          <ChevronRight className={cn(
            "h-3.5 w-3.5 transition-all shrink-0",
            showChannelDetails
              ? "rotate-90 text-primary"
              : "text-rm-text-muted/40 group-hover/chname:text-rm-text-muted"
          )} />
        </button>
      </div>

      <div className="flex items-center gap-2 md:gap-4 text-rm-text-muted">
        <div className="hidden md:flex items-center gap-2 md:gap-4 border-r border-rm-border pr-2 md:pr-4">
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
              <TooltipContent side="bottom" sideOffset={8} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>{hasExistingCall ? "Join Call" : "Start Voice Call"}</p>
              </TooltipContent>
            </Tooltip>
          )}
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
              role="button"
              tabIndex={0}
              onClick={onMembersClick}
            />
          )}
        </div>
        <div className="flex items-center">
          <div className="hidden md:flex relative items-center w-36 overflow-hidden rounded-[3px] bg-rm-bg-elevated border border-rm-border hover:w-56 transition-all duration-300">
            <input type="text" placeholder={`Search ${channelName}`} className="w-full bg-transparent px-2 py-1 flex-1 text-[13px] text-rm-text outline-none placeholder:text-rm-text-muted" onClick={onOpenSearch} />
            <Search className="absolute right-2 h-4 w-4 text-rm-text-muted pointer-events-none" />
          </div>
          <IconButton
            icon={Search}
            variant="muted"
            size="sm"
            className="md:hidden"
            onClick={onOpenSearch}
          />
        </div>
        {onClose && (
          <IconButton
            icon={X}
            variant="muted"
            size="xs"
            className="ml-4"
            onClick={onClose}
            title="Close Chat"
          />
        )}
      </div>
    </header>
  );
}
