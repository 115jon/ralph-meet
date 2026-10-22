/**
 * UnreadBanner
 *
 * Top banner showing unread message count and time.
 * Uses the app's primary color. Includes a "Mark As Read" button.
 */

import { Button } from "@/components/ui/button";
import { Check } from "./Icons";

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
    <div className="z-10 mx-2 mt-1 flex h-8 shrink-0 items-center justify-between rounded-md bg-primary px-3 text-ui-sm font-medium text-primary-foreground">
      <span>
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
        className="text-ui-sm text-primary-foreground [--hover-o:0.15]"
      >
        Mark As Read
        <Check className="size-3.5" strokeWidth={2.5} />
      </Button>
    </div>
  );
}
