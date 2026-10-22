export function ChatTypingIndicator({
  typingUsers,
}: {
  typingUsers: string[];
}) {
  if (typingUsers.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none absolute bottom-full left-5 z-20 mb-1.5 flex h-7 items-center gap-2 rounded-md border border-rm-border bg-rm-bg-elevated px-2.5 shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-150"
    >
      <div role="presentation" className="flex gap-1">
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-300ms]"
        />
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-150ms]"
        />
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite]"
        />
      </div>
      <p className="text-ui-xs leading-none text-rm-text-muted">
        <span className="font-semibold text-rm-text">
          {typingUsers.length <= 3
            ? typingUsers.join(", ")
            : `${typingUsers.length} people`}
        </span>
        {typingUsers.length === 1 ? " is typing..." : " are typing..."}
      </p>
    </div>
  );
}
