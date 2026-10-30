/**
 * List dividers in the message column (component kit, ChatColumn): one
 * anatomy, a 24x2 rule printed before a silkscreen label.
 *
 *   DayDivider            ━━ THURSDAY, OCTOBER 22        (ink-1 rule, ink-3)
 *   NewMessageSeparator   ━━ NEW ────────────────────   (badge rule and seam)
 *
 * The label sits on the text column's left edge (the row gutter), the seam
 * runs to the right gutter. The sticky day label in VirtualMessageList uses
 * the same `DividerLabel`, so the pinned copy and the in-flow one line up.
 */

import { cn } from "@/lib/utils";

export const DIVIDER_ROW =
  "pointer-events-none flex h-8 select-none items-center gap-3 pr-6 pl-4";

export function DividerLabel({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "new";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "silkscreen inline-flex shrink-0 items-center gap-3 whitespace-nowrap",
        tone === "new" ? "text-danger-ink" : "text-ink-3",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-0.5 w-6 shrink-0",
          tone === "new" ? "bg-badge" : "bg-ink-1",
        )}
      />
      {children}
    </span>
  );
}

/** A local calendar day boundary in the message list. */
export function DayDivider({ label, iso }: { label: string; iso?: string }) {
  return (
    <div role="separator" aria-label={label} className={DIVIDER_ROW}>
      <DividerLabel>
        {iso ? <time dateTime={iso}>{label}</time> : label}
      </DividerLabel>
    </div>
  );
}

/** The line between what you've read and what you haven't. */
export function NewMessageSeparator() {
  return (
    <div
      role="separator"
      aria-label="New messages"
      className={cn(DIVIDER_ROW, "h-6")}
    >
      <DividerLabel tone="new">New</DividerLabel>
      <span aria-hidden className="h-px flex-1 bg-badge" />
    </div>
  );
}
