import { Button } from "@/components/ui/button";
import { ChevronDown } from "./Icons";

export function ChatJumpToPresent({ isDetached, onJumpToPresent }: any) {
  if (!isDetached) return null;
  return (
    <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-1 duration-150">
      <Button
        type="button"
        onClick={onJumpToPresent}
        className="gap-1.5 rounded-full shadow-[var(--rm-shadow-1)]"
      >
        <span>Jump to Present</span>
        <ChevronDown className="size-4" strokeWidth={2.5} />
      </Button>
    </div>
  );
}
