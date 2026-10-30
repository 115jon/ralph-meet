import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import { DitherGlyph } from "@/components/ui/dither-glyph";

/**
 * Nothing open in the chat column. The still dithered mark (no loop: this can sit
 * on screen for hours beside a game), a heading and one way forward. The
 * header keeps the column's 48px line so the layout never jumps.
 */
export function EmptyChatArea({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-ply-0">
      <header className="z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-line bg-ply-0 px-4 pt-[var(--safe-area-top,0px)] max-md:pl-2 md:pt-0">
        <IconButton
          type="button"
          aria-label="Open navigation"
          icon="menu"
          variant="muted"
          size={40}
          className="md:hidden"
          onClick={onMenuClick}
        />
        <span className="truncate text-ui-md font-semibold text-ink-1">
          No channel
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <DitherGlyph motif="mark" size="md" />
        <div className="flex max-w-[40ch] flex-col items-center gap-1">
          <h2 className="text-ui-md font-semibold text-balance text-ink-1">
            No channel selected
          </h2>
          <p className="text-ui-sm text-pretty text-ink-2">
            Pick a server and a channel to start chatting.
          </p>
        </div>
        <Button
          variant="secondary"
          className="min-h-11 md:hidden"
          onClick={onMenuClick}
        >
          Browse channels
        </Button>
      </div>
    </div>
  );
}
