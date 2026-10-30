import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";

/**
 * Shown over the chat column while files are dragged in. Presence is opacity
 * only (it mounts transparent and fades in); nothing moves or loops.
 */
export function DragDropOverlay({ isDragging }: { isDragging: boolean }) {
  if (!isDragging) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 m-4 flex items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-scrim transition-opacity duration-(--dur-2) ease-out starting:opacity-0"
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-ply-3 px-8 py-6 text-center shadow-float">
        <Icon name="upload" size="2xl" className="text-ink-2" />
        <p className="text-ui-md font-semibold text-ink-1">Drop to upload</p>
        <p className="text-ui-sm text-ink-3">
          Files can be up to <Num size="sm">25 MB</Num>.
        </p>
      </div>
    </div>
  );
}
