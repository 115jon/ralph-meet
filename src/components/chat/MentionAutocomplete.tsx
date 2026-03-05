import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MentionAutocomplete({
  mentionQuery,
  mentionCandidates,
  mentionIndex,
  setLocalState,
  insertMention,
}: {
  mentionQuery: any;
  mentionCandidates: User[];
  mentionIndex: number;
  setLocalState: React.Dispatch<any>;
  insertMention: (user: User) => void;
}) {
  if (!mentionQuery || mentionCandidates.length === 0) return null;

  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 w-64 rounded-lg bg-rm-bg-elevated border border-rm-border shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150 z-50">
      <div className="px-3 py-2 bg-rm-bg-surface border-b border-rm-border/50">
        <span className="text-xs font-semibold text-rm-text-primary uppercase tracking-wider">
          Members
        </span>
      </div>
      <div className="py-1">
        {mentionCandidates.map((user, i) => (
          <button
            key={user.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setLocalState({ mentionIndex: i });
              insertMention(user);
            }}
            onMouseEnter={() => setLocalState({ mentionIndex: i })}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 transition-colors",
              i === mentionIndex ? "bg-indigo-500/10" : "hover:bg-rm-bg-hover"
            )}
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[10px] font-bold text-rm-text-muted border border-rm-border">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                (user.username ?? "?")[0].toUpperCase()
              )}
            </div>
            <span className={cn(
              "text-[13px] font-medium truncate",
              i === mentionIndex ? "text-indigo-400" : "text-rm-text-primary"
            )}>
              {user.username}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
