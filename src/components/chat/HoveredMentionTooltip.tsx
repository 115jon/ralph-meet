import { getAuthAssetUrl } from "@/lib/platform";

export function HoveredMentionTooltip({ hoveredMember, pos }: { hoveredMember: any; pos: { left: number; top: number } }) {
  if (!hoveredMember) return null;
  const displayName = hoveredMember.user.display_name?.trim() || hoveredMember.user.username;

  return (
    <div
      className="fixed flex flex-col items-center animate-in fade-in zoom-in-95 duration-100 z-[100] pointer-events-none"
      style={{
        left: pos.left,
        top: pos.top - 4,
        transform: "translate(-50%, -100%)"
      }}
    >
      <div className="flex items-center gap-2 rounded-lg bg-rm-bg-elevated border border-rm-border px-3 py-1.5 shadow-xl min-w-max">
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
          {hoveredMember.user.avatar_url ? (
            <img src={getAuthAssetUrl(hoveredMember.user.avatar_url)} alt="" className="object-cover" />
          ) : (
            displayName[0].toUpperCase()
          )}
        </div>
        <span className="text-xs font-semibold text-rm-text-primary">
          {displayName}
        </span>
      </div>
      <div className="h-1.5 w-3 -mt-[1px]">
        <svg viewBox="0 0 12 6" className="fill-rm-bg-elevated stroke-rm-border drop-shadow-sm h-full w-full">
          <path d="M0 0l6 6 6-6H0z" />
        </svg>
      </div>
    </div>
  );
}
