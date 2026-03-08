import { getAuthAssetUrl } from "@/lib/platform";
import type { Message } from "@/lib/types";
import { X } from "./Icons";

export function ReplyIndicator({ replyTo, onCancelReply }: { replyTo: Message; onCancelReply?: () => void }) {
  return (
    <div className="flex animate-in slide-in-from-bottom-2 items-center justify-between rounded-t-2xl border-b border-rm-border bg-primary/5 px-4 py-2 duration-200">
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-widest text-primary">
          Replying to
        </span>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
            {replyTo.author?.avatar_url ? (
              <div className="relative h-full w-full">
                <img src={getAuthAssetUrl(replyTo.author.avatar_url)} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              (replyTo.author?.username ?? "?")[0].toUpperCase()
            )}
          </div>
          <span className="whitespace-nowrap text-[12px] font-bold text-primary">
            {replyTo.author?.username ?? "Unknown"}
          </span>
        </div>
        <span className="truncate text-[12px] font-medium text-rm-text-muted ml-1">
          {replyTo.content}
        </span>
      </div>
      <button
        type="button"
        onClick={onCancelReply}
        className="rounded-lg p-1 text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
