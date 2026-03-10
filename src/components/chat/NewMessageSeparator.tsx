/**
 * NewMessageSeparator
 *
 * Discord-style red line with a "NEW" badge, separating read and unread messages.
 */

export function NewMessageSeparator() {
  return (
    <div className="flex items-center gap-1 px-4 py-1 select-none pointer-events-none">
      <div className="flex-1 h-px bg-red-500" />
      <span className="text-[11px] font-bold text-red-500 uppercase tracking-wider leading-none">
        New
      </span>
    </div>
  );
}
