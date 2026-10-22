import { DitherField } from "@/components/ui/DitherField";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icon";

export function EmptyChatArea({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="flex flex-1 flex-col bg-rm-bg-primary relative overflow-hidden">
      <header className="h-12 flex shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary px-4 z-10">
        <IconButton
          type="button"
          aria-label="Open navigation"
          icon="menu"
          variant="muted"
          size="sm"
          iconSize="lg"
          className="md:hidden"
          onClick={onMenuClick}
        />
        <span className="text-ui-sm font-medium text-rm-text-muted">
          Select a channel
        </span>
      </header>
      <div className="relative flex flex-1 flex-col items-center justify-center">
        <DitherField
          className="inset-x-0 top-0 bottom-auto h-[42%] min-h-[160px]"
          cell={6}
          intensity={0.5}
          opacity={0.85}
          fade="bottom"
          tone="quiet"
          seed={5}
        />
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-rm-border bg-rm-bg-elevated text-rm-text-muted shadow-sm">
            <Icon name="chat" size="xl" />
          </div>
          <span className="font-display text-display text-rm-text text-balance">
            No channel selected
          </span>
          <span className="text-ui-sm text-rm-text-muted">
            Pick a server and channel to start chatting
          </span>
        </div>
      </div>
    </div>
  );
}
