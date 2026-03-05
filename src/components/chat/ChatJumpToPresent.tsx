export function ChatJumpToPresent({ isDetached, onJumpToPresent }: any) {
  if (!isDetached) return null;
  return (
    <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
      <button
        onClick={onJumpToPresent}
        className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-600/90 px-4 py-2 text-[12px] font-bold text-white shadow-lg shadow-indigo-900/40 backdrop-blur-sm transition-all hover:bg-indigo-500 hover:shadow-indigo-700/50 hover:scale-105 active:scale-95"
      >
        <span>Jump to Present</span>
        <span className="text-[14px] leading-none">↓</span>
      </button>
    </div>
  );
}
