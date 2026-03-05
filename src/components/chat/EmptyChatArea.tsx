import { Menu, MessageSquare } from "./Icons";

export function EmptyChatArea({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="flex flex-1 flex-col bg-rm-bg-primary relative overflow-hidden">
      <header className="h-12 flex shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary/60 px-4 z-10 backdrop-blur-md">
        <button
          className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium text-rm-text-muted">Select a channel</span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <MessageSquare className="h-12 w-12 text-rm-text-muted border-rm-border" />
        <span className="text-base font-semibold text-rm-text-muted">No channel selected</span>
        <span className="text-xs text-rm-text-muted opacity-70">
          Pick a server and channel to start chatting
        </span>
      </div>
    </div>
  );
}
