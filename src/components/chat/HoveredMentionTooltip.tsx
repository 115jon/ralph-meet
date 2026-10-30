import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAuthAssetUrl } from "@/lib/platform";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { cn } from "@/lib/utils";
import InlineEmojiText from "./InlineEmojiText";

/**
 * Name tooltip for a mention hovered in the composer, in the app's one
 * tooltip look (inverted ink-1, text-ui-xs, radius 6). The mention is drawn
 * in an overlay under the textarea, so the host passes the mention's
 * top-centre (`pos`, viewport coordinates) and the stock `Tooltip` anchors to
 * a zero-size point there.
 *
 * `pos` is measured on hover, so it is only valid while the chips haven't
 * moved: `useMessageInput` clears `hoveredMention` on input, scroll, send and
 * mouse leave, which is what keeps this from rendering at stale coordinates.
 */
export function HoveredMentionTooltip({
  hoveredMember,
  pos,
}: {
  hoveredMember: any;
  pos: { left: number; top: number };
}) {
  if (!hoveredMember) return null;
  const displayName =
    hoveredMember.user.display_name?.trim() || hoveredMember.user.username;

  return (
    // Keyed by position so the tooltip re-anchors when another mention is hovered.
    <Tooltip key={`${pos.left}:${pos.top}`} open>
      <TooltipTrigger asChild>
        <span
          aria-hidden="true"
          data-slot="mention-tooltip-anchor"
          className="pointer-events-none fixed size-0"
          style={{ left: pos.left, top: pos.top }}
        />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className="flex items-center gap-1.5"
      >
        <span
          className={cn(
            "relative flex size-[18px] shrink-0 items-center justify-center bg-ply-0/20 text-ui-2xs font-semibold",
            avatarShape(
              hoveredMember.user.avatar_url &&
                hoveredMember.user.avatar_display,
            ),
          )}
        >
          {hoveredMember.user.avatar_url ? (
            <AvatarImage
              src={getAuthAssetUrl(hoveredMember.user.avatar_url)}
              alt=""
              display={hoveredMember.user.avatar_display}
            />
          ) : (
            displayName[0].toUpperCase()
          )}
        </span>
        <InlineEmojiText text={displayName} />
      </TooltipContent>
    </Tooltip>
  );
}
