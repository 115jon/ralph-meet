import { IconButton } from "@/components/ui/IconButton";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";
import { StreamingStatsPanel } from "@/components/voice/StreamingStatsPanel";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Icon, type IconName } from "@/components/ui/icon";
import { LedLabel } from "@/components/ui/led";
import type { ReactNode } from "react";
import { QualityMonitor } from "./QualityMonitor";
import { TileAvatar } from "./TileParts";

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

/**
 * The stage header: always a 48px bar above the stage (talk-tree-spec §3),
 * so it never sits on top of a shared screen. When a tile is on stage, the
 * bar names it ("Linus's Stream") with its quality readout and a Live word.
 */
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

  return (
    <header
      data-voice-header="bar"
      className="relative z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-line bg-ply-0 px-4 pt-[var(--safe-area-top,0px)]"
    >
      {onMenuClick && (
        <IconButton
          aria-label="Open sidebar"
          icon="menu"
          size={32}
          variant="muted"
          className="md:hidden"
          onClick={onMenuClick}
        />
      )}
      <div className="flex min-w-0 shrink items-center gap-2">
        <Icon name={titleIcon} size="lg" className="shrink-0 text-ink-3" />
        <h2 className="min-w-0 truncate font-display [font-optical-sizing:auto] text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1">
          <InlineEmojiText text={channelName} />
        </h2>
      </div>
      <div aria-hidden className="h-4 w-px shrink-0 bg-line-strong" />
      <StreamingStatsPanel
        connectionState={connectionState}
        joined={joined}
        className="min-w-0 shrink-0"
      />
      {meta}

      {focusedItem ? (
        <>
          <div aria-hidden className="h-4 w-px shrink-0 bg-line-strong" />
          <div
            data-focused-label=""
            className="flex min-w-0 items-center gap-2 text-ink-1"
          >
            <TileAvatar
              name={focusedItem.name ?? ""}
              avatar={focusedItem.avatar}
              avatarDisplay={focusedItem.avatarDisplay}
              sizeClassName="size-5"
              initialClassName="text-ui-2xs"
            />
            <span className="min-w-0 truncate font-display [font-optical-sizing:auto] text-[14px] leading-5 font-bold">
              <InlineEmojiText text={focusedLabel} />
            </span>
            {focusedItem.isStreaming && (
              <>
                <span className="shrink-0 text-num-xs text-ink-3">
                  <QualityMonitor
                    track={focusedItem.stream?.getVideoTracks?.()[0]}
                    signaledQuality={
                      focusedItem.isLocal ? currentScreenQuality : null
                    }
                    sfu={sfu}
                    userId={focusedItem.userId}
                    type={focusedItem.type === "screen" ? "screen" : "cam"}
                  />
                </span>
                <LedLabel state="live" className="shrink-0">
                  Live
                </LedLabel>
              </>
            )}
            {focusedWatchers.length > 0 && (
              <StreamWatcherList
                watchers={focusedWatchers}
                variant="inline"
                className="max-w-[min(32vw,16rem)]"
              />
            )}
          </div>
        </>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!showTextChat && onToggleTextChat && (
          <IconButton
            icon="chat"
            size={32}
            variant="muted"
            tooltip="Chat"
            onClick={onToggleTextChat}
          />
        )}
      </div>
    </header>
  );
}
