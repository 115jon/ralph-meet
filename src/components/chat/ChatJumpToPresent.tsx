import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

interface ChatJumpToPresentProps {
  isDetached: boolean;
  onJumpToPresent: () => void;
}

/**
 * Shown while you're reading history away from the live tail. A ply-3 float
 * (line + float shadow) above the composer; it fades and rises 4px in.
 */
export function ChatJumpToPresent({
  isDetached,
  onJumpToPresent,
}: ChatJumpToPresentProps) {
  if (!isDetached) return null;
  return (
    <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 transition-[opacity,translate] duration-(--dur-3) ease-out starting:translate-y-(--motion-shift) starting:opacity-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onJumpToPresent}
        className="border border-line bg-ply-3 text-ink-1 shadow-float"
      >
        Jump to present
        <Icon name="chevronDown" size="sm" />
      </Button>
    </div>
  );
}
