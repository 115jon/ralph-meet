import type { Message } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { ReplyPreviewContent } from "./ReplyPreviewContent";
import { UserDisplayName } from "./UserDisplayName";

/**
 * The one tray anatomy inside the composer (reply bar, upload tray): a
 * tint-1 band on the composer's ply-2 with a `--line` seam toward the input.
 * The composer clips to its own radius (`overflow-hidden`), so the tray's top
 * corners are concentric with the box without a radius of their own.
 *
 * Enters with opacity + 4px of travel (`rm-list-enter`, gated on the
 * composer's `data-animate-enter`, so a first render never animates).
 */
export const COMPOSER_TRAY = "rm-list-enter border-b border-line bg-tint-1";

/** "Replying to **Ada**" above the input, with a one-tap cancel. */
export function ReplyIndicator({
  replyTo,
  onCancelReply,
  isClosing,
}: {
  replyTo: Message;
  onCancelReply?: () => void;
  /** The reply was cleared: fade out (100ms) before the host unmounts it. */
  isClosing?: boolean;
}) {
  return (
    <div
      data-testid="reply-indicator"
      aria-hidden={isClosing || undefined}
      className={cn(
        COMPOSER_TRAY,
        "flex min-h-8 items-center gap-2 py-1 pr-4 pl-3 text-ui-xs",
        isClosing && "pointer-events-none opacity-0",
      )}
      // Exit runs at about 0.7x the entrance (spec §6): opacity only, 100ms.
      style={isClosing ? { transitionDuration: "var(--dur-1)" } : undefined}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-1">
        <span className="shrink-0 text-ink-3">Replying to</span>
        <UserDisplayName
          user={replyTo.author}
          className="block max-w-56 shrink-0 truncate font-semibold text-ink-1"
        />
        <span className="ml-1 min-w-0 flex-1 truncate text-ink-3">
          <ReplyPreviewContent
            content={replyTo.content}
            attachmentsCount={
              replyTo.attachment_count ?? replyTo.attachments?.length ?? 0
            }
          />
        </span>
      </div>
      <IconButton
        type="button"
        aria-label="Cancel reply"
        icon="close"
        variant="muted"
        size={24}
        tabIndex={isClosing ? -1 : undefined}
        onClick={onCancelReply}
      />
    </div>
  );
}
