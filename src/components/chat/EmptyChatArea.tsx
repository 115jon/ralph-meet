import { DitherField } from "@/components/ui/DitherField";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function EmptyChatArea({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="flex flex-1 flex-col bg-rm-bg-primary relative overflow-hidden">
      <header className="z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-rm-border bg-rm-bg-primary px-4 pt-[var(--safe-area-top,0px)] md:pt-0">
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
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Icon
            name="chat"
            size="2xl"
            className="text-rm-text-muted md:hidden"
          />
          <Icon
            name="chat"
            size="3xl"
            className="hidden text-rm-text-muted md:block"
          />
          <h2 className="text-ui-lg font-semibold text-balance text-rm-text">
            No channel selected
          </h2>
          <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
            Pick a server and a channel to start chatting.
          </p>
          <Button
            variant="secondary"
            className="min-h-11 md:hidden"
            onClick={onMenuClick}
          >
            Browse channels
          </Button>
        </div>
      </div>
    </div>
  );
}
