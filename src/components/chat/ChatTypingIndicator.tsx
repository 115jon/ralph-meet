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
      className="pointer-events-none flex h-6 min-w-0 items-center gap-2 animate-in fade-in-0 duration-150"
    >
      <div role="presentation" className="flex gap-1">
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-300ms] motion-reduce:animate-none"
        />
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-150ms] motion-reduce:animate-none"
        />
        <span
          aria-hidden="true"
          className="h-1 w-1 rounded-full bg-rm-accent animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] motion-reduce:animate-none"
        />
      </div>
      <p className="truncate text-ui-xs text-rm-text-secondary">
        <span className="font-semibold text-rm-text">
          {typingUsers.length <= 3
            ? typingUsers.join(", ")
            : `${typingUsers.length} people`}
        </span>
        {typingUsers.length === 1 ? " is typing…" : " are typing…"}
      </p>
    </div>
  );
}
