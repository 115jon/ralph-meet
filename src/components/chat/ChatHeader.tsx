import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { AtSign, Hash, Pin, Search, Users, X } from "./Icons";
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
}: ChatHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-rm-border bg-rm-bg-primary/60 backdrop-blur-md px-4 z-20 relative">
      <div className="flex items-center gap-1 group">
        <button
          className="cursor-pointer border-none bg-transparent p-1.5 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
          onClick={onMenuClick}
          title="Servers"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>

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
              {memberCount} Members
            </span>
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
          <h2 className={cn(
            "text-[15px] font-semibold text-rm-text-primary tracking-tight leading-none transition-all",
            "group-hover/chname:underline underline-offset-2"
          )}>{channelName}</h2>
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
            <input type="text" placeholder={`Search ${channelName}`} className="w-full bg-transparent px-2 py-1 flex-1 text-[13px] text-rm-text outline-none placeholder:text-rm-text-muted" onClick={onOpenSearch} />
            <Search className="absolute right-2 h-4 w-4 text-rm-text-muted pointer-events-none" />
          </div>
          <button className="md:hidden flex items-center justify-center p-1.5 text-rm-text-muted hover:text-rm-text" onClick={onOpenSearch}>
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
  );
}
