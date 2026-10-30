import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ParticipantCard } from "./ParticipantCard";
import type { GridItem, VoiceActions } from "./types";

/**
 * The connected voice layout shared by the channel view, the /room page and
 * the fixtures (talk-tree-spec §3):
 *
 *   header   VoiceHeader, a 48px bar (never an overlay on the stream)
 *   banner   the 32px connection banner (reconnecting / failed), optional
 *   stage    the grid / focused media / activity on ply-0, the only scroller
 *   panel    members tray + stage bar on ply-1, padded for safe areas
 */
interface VoiceStageProps {
  header: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  tray?: ReactNode;
  dock: ReactNode;
  className?: string;
  stageClassName?: string;
}

export const VoiceStage = forwardRef<HTMLDivElement, VoiceStageProps>(
  (
    { header, banner, children, tray, dock, className, stageClassName },
    ref,
  ) => (
    <div
      ref={ref}
      data-voice-stage=""
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ply-0",
        className,
      )}
    >
      {header}
      {banner}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden",
          stageClassName,
        )}
      >
        {children}
      </div>
      <div
        data-voice-dock-panel
        className="relative z-20 shrink-0 border-t border-line bg-ply-1 pr-[var(--safe-area-right,0px)] pb-[var(--safe-area-bottom,0px)] pl-[var(--safe-area-left,0px)]"
      >
        {tray}
        {dock}
      </div>
    </div>
  ),
);

VoiceStage.displayName = "VoiceStage";

interface MembersTrayProps {
  items: GridItem[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  globalDeafened: boolean;
  watchedStreams: Record<string, boolean>;
  streamThumbnails: Record<string, string>;
  voiceActions?: VoiceActions;
}

/**
 * Everyone in the call as a strip above the stage bar while a tile is on
 * stage. 144px tiles so the next one peeks past the edge on a phone (the cue
 * that the strip scrolls); `safe center` keeps the first tile reachable
 * when the strip overflows. The tile on stage keeps its avatar and takes the
 * accent edge.
 */
export function MembersTray({
  items,
  focusedId,
  onFocus,
  globalDeafened,
  watchedStreams,
  streamThumbnails,
  voiceActions,
}: MembersTrayProps) {
  return (
    <div
      data-members-tray
      className="border-b border-line transition-opacity duration-(--dur-3) ease-out starting:opacity-0"
    >
      <ul
        aria-label="Participants"
        className="flex w-full justify-[safe_center] gap-2 overflow-x-auto overscroll-x-contain px-4 py-2 scrollbar-none"
      >
        {items.map((item) => (
          <li key={item.id} className="aspect-video w-36 shrink-0">
            <ParticipantCard
              item={item}
              isFocused={focusedId === item.id}
              isTray
              globalDeafened={globalDeafened}
              watchedStreams={watchedStreams}
              streamThumbnails={streamThumbnails}
              voiceActions={voiceActions}
              suppressVideo={focusedId === item.id}
              onClick={() => onFocus(focusedId === item.id ? null : item.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
