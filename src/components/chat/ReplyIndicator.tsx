import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Message } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { AvatarImage } from "./AvatarImage";
import { ReplyPreviewContent } from "./ReplyPreviewContent";
import { UserDisplayName } from "./UserDisplayName";

export function ReplyIndicator({
  replyTo,
  onCancelReply,
  isClosing,
}: {
  replyTo: Message;
  onCancelReply?: () => void;
  isClosing?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex animate-in slide-in-from-bottom-2 items-center justify-between rounded-t-2xl border-b border-rm-border bg-primary/5 px-4 py-2 duration-200",
        isClosing && "animate-out fade-out slide-out-to-bottom-2",
      )}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-rm-accent-ink">
          Replying to
        </span>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-bg-surface text-ui-2xs font-bold text-rm-text-muted border border-rm-border">
            {replyTo.author?.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(replyTo.author.avatar_url)}
                alt=""
                display={replyTo.author.avatar_display}
              />
            ) : (
              getDisplayInitial(replyTo.author)
            )}
          </div>
          <UserDisplayName
            user={replyTo.author}
            className="block whitespace-nowrap text-ui-xs font-semibold text-rm-accent-ink"
          />
        </div>
        <span className="truncate text-ui-xs font-medium text-rm-text-muted ml-1">
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
        size="xs"
        onClick={onCancelReply}
      />
    </div>
  );
}
