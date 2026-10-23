import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ParticipantCard } from "./ParticipantCard";
import type { GridItem, VoiceActions } from "./types";

/**
 * The connected voice layout shared by the channel view, the /room page and
 * the fixtures (design-system 3.7, 3.8, 12.13):
 *
 *   header   VoiceHeader: a shrink-0 sibling, or an overlay when focused
 *   stage    the grid / focused media / activity, the only scroller
 *   panel    members tray + dock, shrink-0 chrome padded for safe areas
 */
interface VoiceStageProps {
  header: ReactNode;
  children: ReactNode;
  tray?: ReactNode;
  dock: ReactNode;
  className?: string;
  stageClassName?: string;
}

export const VoiceStage = forwardRef<HTMLDivElement, VoiceStageProps>(
  ({ header, children, tray, dock, className, stageClassName }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary",
        className,
      )}
    >
      {header}
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
        className="relative z-20 shrink-0 border-t border-rm-border bg-rm-bg-surface pr-[var(--safe-area-right,0px)] pb-[var(--safe-area-bottom,0px)] pl-[var(--safe-area-left,0px)]"
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
 * Everyone in the call as a strip above the dock while a tile is on stage.
 * Tiles are 160px so the next one peeks past the edge on a phone (the cue
 * that the strip scrolls); `safe center` keeps the first tile reachable
 * when the strip overflows.
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
      className="border-b border-rm-border animate-in fade-in duration-200"
    >
      <ul
        aria-label="Participants"
        className="flex w-full justify-[safe_center] gap-2 overflow-x-auto overscroll-x-contain px-4 py-3 scrollbar-none"
      >
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "aspect-video w-40 shrink-0 transition-opacity duration-150 ease-(--rm-ease-out)",
              focusedId !== item.id &&
                "opacity-70 pointer-fine:hover:opacity-100",
            )}
          >
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
