export function ChatJumpToPresent({ isDetached, onJumpToPresent }: any) {
  if (!isDetached) return null;
  return (
    <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
      <button
        onClick={onJumpToPresent}
        className="flex items-center gap-2 rounded-full border border-rm-accent/30 bg-rm-accent/90 px-4 py-2 text-[12px] font-bold text-white shadow-lg shadow-rm-accent/40 backdrop-blur-sm transition-all hover:bg-rm-accent-hover hover:scale-105 active:scale-95 cursor-pointer"
      >
        <span>Jump to Present</span>
        <span className="text-[14px] leading-none">↓</span>
      </button>
    </div>
  );
}
