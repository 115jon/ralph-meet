/**
 * UnreadBanner
 *
 * The unread marker pinned over the top of the list: the same anatomy as
 * the in-list "New" divider (silkscreen label plus a seam), with the count
 * and time in mono and "Mark as read" at the end. It overlays the list
 * instead of pushing it down, so the column never jumps when it appears.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";
import { DividerLabel } from "./NewMessageSeparator";
import { useMessageTimeFormat } from "./message-time";

interface UnreadBannerProps {
  count: number;
  since: string; // ISO timestamp of the first unread message
  onMarkAsRead: () => void;
  className?: string;
}

export function UnreadBanner({
  count,
  since,
  onMarkAsRead,
  className,
}: UnreadBannerProps) {
  const time = useMessageTimeFormat();
  const day = time.dayLabel(since);
  const clock = time.time(since);

  return (
    <div
      role="status"
      className={cn(
        "z-20 flex h-8 shrink-0 items-center gap-3 border-b border-line bg-ply-0 pr-2 pl-4",
        "transition-[opacity,translate] duration-(--dur-3) ease-out",
        "starting:-translate-y-(--motion-shift) starting:opacity-0",
        className,
      )}
      title={time.full(since)}
    >
      <DividerLabel tone="new">New</DividerLabel>
      <span className="min-w-0 truncate text-ui-sm text-ink-2">
        <Num size="sm" className="text-ink-1">
          {count}
        </Num>{" "}
        message{count !== 1 ? "s" : ""} since{" "}
        {day !== "Today" && <>{day === "Yesterday" ? "yesterday" : day} at </>}
        <Num size="sm">{clock}</Num>
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-badge" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onMarkAsRead();
        }}
        className="shrink-0"
      >
        Mark as read
        <Icon name="check" size="sm" />
      </Button>
    </div>
  );
}
