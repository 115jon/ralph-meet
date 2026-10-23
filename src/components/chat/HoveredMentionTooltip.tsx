import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAuthAssetUrl } from "@/lib/platform";
import { AvatarImage } from "./AvatarImage";
import InlineEmojiText from "./InlineEmojiText";

/**
 * Name tooltip for a mention hovered in the composer. The mention is drawn in
 * an overlay under the textarea, so the host passes the mention's top-centre
 * (`pos`, viewport coordinates) and the stock `Tooltip` anchors to a
 * zero-size point there.
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
      <TooltipContent side="top" className="flex items-center gap-1.5">
        <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full text-ui-2xs font-semibold">
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
