export function ChatTypingIndicator({ typingUsers }: { typingUsers: string[] }) {
  if (typingUsers.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-full mb-2 left-6 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-rm-bg-elevated/90 backdrop-blur-md border border-rm-border shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex gap-1 pb-0.5">
        <span className="h-1 w-1 animate-bounce rounded-full bg-rm-accent [animation-delay:-0.3s]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-rm-accent [animation-delay:-0.15s]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-rm-accent" />
      </div>
      <p className="text-[11px] font-bold tracking-tight text-rm-text-muted leading-none">
        <span className="text-rm-accent">
          {typingUsers.length <= 3
            ? typingUsers.join(", ")
            : `${typingUsers.length} people`}
        </span>
        {typingUsers.length === 1 ? " is typing..." : " are typing..."}
      </p>
    </div>
  );
}
