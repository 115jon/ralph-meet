/**
 * UnreadBanner
 *
 * Top banner showing unread message count and time, in the accent tint (the
 * view's one solid fill stays the primary action). Includes "Mark as read".
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

interface UnreadBannerProps {
  count: number;
  since: string; // ISO timestamp of the first unread message
  onMarkAsRead: () => void;
}

export function UnreadBanner({
  count,
  since,
  onMarkAsRead,
}: UnreadBannerProps) {
  const timeStr = new Date(since).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="z-10 mx-4 mt-2 flex h-8 shrink-0 items-center justify-between gap-2 rounded-md bg-rm-accent-tint pr-1 pl-3 text-ui-sm font-medium text-rm-accent-ink">
      <span className="min-w-0 truncate">
        {count} new message{count !== 1 ? "s" : ""} since {timeStr}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={(e) => {
          e.stopPropagation();
          onMarkAsRead();
        }}
        className="shrink-0 text-rm-accent-ink"
      >
        Mark as read
        <Icon name="check" size="xs" />
      </Button>
    </div>
  );
}
