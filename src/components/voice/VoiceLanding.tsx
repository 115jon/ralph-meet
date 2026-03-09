import { IconButton } from "@/components/ui/IconButton";
import { getAuthAssetUrl } from "@/lib/platform";
import { Menu, MessageSquare, Volume2 } from "../chat/Icons";

interface VoiceLandingProps {
  channelName: string;
  vcMembers: any[];
  handleJoin: () => void;
  showTextChat: boolean;
  onToggleTextChat: () => void;
  onMenuClick?: () => void;
}

export function VoiceLanding({
  channelName,
  vcMembers,
  handleJoin,
  showTextChat,
  onToggleTextChat,
  onMenuClick,
}: VoiceLandingProps) {
  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-rm-bg-primary/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--rm-glow)_0%,_transparent_70%)]" />
      <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-rm-bg-primary/80 to-transparent" />

      <div className="relative z-10 h-14 flex items-center px-4 md:px-5 shrink-0 justify-between">
        <div className="flex items-center gap-2 text-rm-text-muted">
          {onMenuClick && (
            <IconButton
              icon={Menu}
              variant="muted"
              size="sm"
              className="md:hidden"
              onClick={onMenuClick}
            />
          )}
          <Volume2 size={18} />
          <span className="text-sm font-bold text-rm-text tracking-tight">{channelName}</span>
        </div>
        {!showTextChat && (
          <IconButton icon={MessageSquare} variant="muted" size="sm" onClick={onToggleTextChat} />
        )}
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <h2 className="text-2xl font-bold text-rm-text/90 tracking-tight">{channelName}</h2>
        <p className="text-sm text-rm-text-muted font-medium">
          {vcMembers.length === 0
            ? 'No one is currently in voice'
            : `${vcMembers.length} ${vcMembers.length === 1 ? 'person' : 'people'} in voice`}
        </p>

        {vcMembers.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            {vcMembers.slice(0, 5).map((m) => (
              <div key={m.clerk_user_id} className="w-8 h-8 rounded-full bg-rm-bg-elevated overflow-hidden ring-1 ring-rm-border">
                {m.avatar_url ? (
                  <div className="relative h-full w-full">
                    <img
                      src={getAuthAssetUrl(m.avatar_url)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-rm-text-muted">
                    {m.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>
            ))}
            {vcMembers.length > 5 && (
              <div className="w-8 h-8 rounded-full bg-rm-bg-elevated flex items-center justify-center text-xs font-bold text-rm-text-muted ring-1 ring-rm-border">
                +{vcMembers.length - 5}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleJoin}
          className="mt-4 px-8 py-2.5 bg-primary text-primary-foreground font-bold text-sm rounded-md hover:bg-primary/90 transition-all hover:shadow-[0_0_30px_var(--rm-glow)] active:scale-95 outline-none"
        >
          Join Voice
        </button>
      </div>
    </div>
  );
}
