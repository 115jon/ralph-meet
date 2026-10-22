/**
 * NewMessageSeparator
 *
 * Discord-style line with a "NEW" badge, separating read and unread messages.
 */

export function NewMessageSeparator() {
  return (
    <div className="pointer-events-none flex select-none items-center gap-2 px-4 py-1">
      <div className="h-px flex-1 bg-rm-badge/70" />
      <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] leading-none text-rm-badge">
        New
      </span>
    </div>
  );
}
