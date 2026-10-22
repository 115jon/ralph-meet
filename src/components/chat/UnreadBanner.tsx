/**
 * UnreadBanner
 *
 * Top banner showing unread message count and time.
 * Uses the app's primary color. Includes a "Mark As Read" button.
 */

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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onMarkAsRead();
        }}
        className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-ui-sm font-semibold transition-colors hover:bg-white/15 enabled:active:scale-[0.96]"
      >
        Mark As Read
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
