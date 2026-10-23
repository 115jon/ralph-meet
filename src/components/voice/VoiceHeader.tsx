import { IconButton } from "@/components/ui/IconButton";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";
import { StreamingStatsPanel } from "@/components/voice/StreamingStatsPanel";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ReactNode } from "react";
import { QualityMonitor } from "./QualityMonitor";

function getFocusedItemLabel(
  item: { type?: string; isLocal?: boolean; name?: string } | null | undefined,
) {
  if (!item?.name) return "";
  if (item.type !== "screen") return item.name;
  if (item.isLocal) return "Your stream";
  const ownerName = item.name.replace(/'s Stream$/, "");
  return `${ownerName}'s Stream`;
}

interface VoiceHeaderProps {
  channelName: string;
  connectionState: string;
  joined: boolean;
  focusedItem: any;
  focusedWatchers?: StreamWatcherIdentity[];
  currentScreenQuality: string | null | undefined;
  sfu: any;
  showTextChat?: boolean;
  /** Omit to hide the chat button (the /room page has its chat inline). */
  onToggleTextChat?: () => void;
  onMenuClick?: () => void;
  /** Title glyph; the channel glyph by default. */
  titleIcon?: IconName;
  /** Extra items after the connection label (room link, head count). */
  meta?: ReactNode;
}

const EMPTY_FOCUSED_WATCHERS: StreamWatcherIdentity[] = [];

export function VoiceHeader({
  channelName,
  connectionState,
  joined,
  focusedItem,
  focusedWatchers = EMPTY_FOCUSED_WATCHERS,
  currentScreenQuality,
  sfu,
  showTextChat = false,
  onToggleTextChat,
  onMenuClick,
  titleIcon = "voiceChannel",
  meta,
}: VoiceHeaderProps) {
  const focusedLabel = getFocusedItemLabel(focusedItem);

  const menuButton = onMenuClick && (
    <IconButton
      aria-label="Open sidebar"
      icon="menu"
      size="sm"
      variant="plain"
      className={cn(
        "md:hidden",
        focusedItem
          ? "text-white/80 pointer-fine:hover:text-white"
          : "text-rm-text-secondary pointer-fine:hover:text-rm-text",
      )}
      onClick={onMenuClick}
    />
  );
  const chatButton = !showTextChat && onToggleTextChat && (
    <IconButton
      icon="chat"
      size="sm"
      variant="plain"
      tooltip="Chat"
      className={cn(
        focusedItem
          ? "text-white/80 pointer-fine:hover:text-white"
          : "text-rm-text-secondary pointer-fine:hover:text-rm-text",
      )}
      onClick={onToggleTextChat}
    />
  );

  /* Unfocused: chrome above the grid (12.1). A shrink-0 sibling of the
   * scroller, so tiles never slide under it. */
  if (!focusedItem) {
    return (
      <header
        data-voice-header="bar"
        className="relative z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary px-4 pt-[var(--safe-area-top,0px)]"
      >
        {menuButton}
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={titleIcon}
            size="lg"
            className="shrink-0 text-rm-text-muted"
          />
          <h2 className="min-w-0 truncate text-ui-md font-semibold text-rm-text">
            <InlineEmojiText text={channelName} />
          </h2>
        </div>
        <div aria-hidden className="h-4 w-px shrink-0 bg-rm-border" />
        <StreamingStatsPanel
          connectionState={connectionState}
          joined={joined}
          className="min-w-0"
        />
        {meta}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {chatButton}
        </div>
      </header>
    );
  }

  /* Focused: an overlay on the media, the one place the header floats. */
  return (
    <div
      data-voice-header="overlay"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-linear-to-b from-black/70 via-black/35 to-transparent px-4 pt-[calc(var(--safe-area-top,0px)+8px)] pb-8"
    >
      <div className="pointer-events-auto flex min-h-8 min-w-0 flex-wrap items-center gap-2">
        {menuButton}
        <div className="flex min-w-0 items-center gap-2 text-white/80">
          <Icon name={titleIcon} size="lg" className="shrink-0" />
          <h2 className="min-w-0 truncate text-ui-md font-semibold text-white">
            <InlineEmojiText text={channelName} />
          </h2>
        </div>
        <div aria-hidden className="h-4 w-px shrink-0 bg-white/20" />
        <StreamingStatsPanel
          connectionState={connectionState}
          joined={joined}
          emphasized
        />
        {meta}
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/45 py-1 pr-3 pl-1">
          <div className="relative flex size-6 shrink-0 items-center justify-center overflow-visible rounded-full bg-white/10">
            {focusedItem.avatar ? (
              <AvatarImage
                src={getAuthAssetUrl(focusedItem.avatar)}
                alt=""
                display={focusedItem.avatarDisplay}
              />
            ) : (
              <span className="text-ui-2xs font-semibold text-white">
                {focusedItem.name[0]}
              </span>
            )}
          </div>
          <span className="truncate text-ui-xs font-semibold text-white">
            <InlineEmojiText text={focusedLabel} />
          </span>
          {focusedWatchers.length > 0 && (
            <>
              <div aria-hidden className="h-4 w-px shrink-0 bg-white/15" />
              <StreamWatcherList
                watchers={focusedWatchers}
                variant="inline"
                className="max-w-[min(42vw,18rem)]"
              />
            </>
          )}
        </div>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {focusedItem.isStreaming && (
          <div className="flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1">
            <span className="text-ui-2xs font-semibold text-white tabular-nums">
              <QualityMonitor
                track={focusedItem.stream?.getVideoTracks()[0]}
                signaledQuality={
                  focusedItem.isLocal ? currentScreenQuality : null
                }
                sfu={sfu}
                userId={focusedItem.userId}
                type={focusedItem.type === "screen" ? "screen" : "cam"}
              />
            </span>
            <span className="rounded-xs bg-rm-danger px-1 text-ui-2xs font-semibold text-rm-on-danger">
              Live
            </span>
          </div>
        )}
        {chatButton}
      </div>
    </div>
  );
}
