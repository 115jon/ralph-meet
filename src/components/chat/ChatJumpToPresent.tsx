import { ChevronDown } from "./Icons";

export function ChatJumpToPresent({ isDetached, onJumpToPresent }: any) {
  if (!isDetached) return null;
  return (
    <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-1 duration-150">
      <button
        type="button"
        onClick={onJumpToPresent}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-rm-accent pl-3.5 pr-2.5 text-ui-sm font-semibold text-white shadow-md transition-ui hover:bg-rm-accent-hover enabled:active:scale-[0.96]"
      >
        <span>Jump to Present</span>
        <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
