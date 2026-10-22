import { IconButton } from "@/components/ui/IconButton";
import { DitherField } from "@/components/ui/DitherField";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { getAuthAssetUrl } from "@/lib/platform";
import { AvatarImage } from "../chat/AvatarImage";
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
    <div className="flex-1 flex flex-col relative overflow-hidden bg-rm-bg-primary">
      <DitherField
        cell={6}
        intensity={0.34}
        contrast={1.1}
        opacity={0.85}
        fade="bottom"
        tone="quiet"
        seed={2}
      />

      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between px-4 md:px-5">
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
          <InlineEmojiText
            text={channelName}
            className="text-ui-sm font-semibold text-rm-text"
          />
        </div>
        {!showTextChat && (
          <IconButton
            icon={MessageSquare}
            variant="muted"
            size="sm"
            onClick={onToggleTextChat}
          />
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-12 text-center">
        <h2 className="font-display text-display-lg text-rm-text text-balance">
          <InlineEmojiText text={channelName} />
        </h2>
        <p className="text-ui-base text-rm-text-secondary">
          {vcMembers.length === 0
            ? "No one is currently in voice"
            : `${vcMembers.length} ${vcMembers.length === 1 ? "person" : "people"} in voice`}
        </p>

        {vcMembers.length > 0 && (
          <div className="mt-1 flex items-center">
            {vcMembers.slice(0, 5).map((m, index) => (
              <div
                key={m.clerk_user_id}
                className={
                  "h-9 w-9 overflow-visible rounded-full bg-rm-bg-elevated ring-2 ring-rm-bg-primary" +
                  (index > 0 ? " -ml-2" : "")
                }
              >
                {m.avatar_url ? (
                  <AvatarImage
                    src={getAuthAssetUrl(m.avatar_url)}
                    alt=""
                    display={m.avatar_display}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full text-ui-xs font-semibold text-rm-text-muted">
                    {m.name?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
              </div>
            ))}
            {vcMembers.length > 5 && (
              <div className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-rm-bg-elevated text-ui-xs font-semibold text-rm-text-muted ring-2 ring-rm-bg-primary">
                +{vcMembers.length - 5}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleJoin}
          className="mt-3 h-10 rounded-md bg-primary px-6 text-ui-base font-semibold text-primary-foreground shadow-md transition-ui hover:bg-primary/90 enabled:active:scale-[0.96] outline-none"
        >
          Join Voice
        </button>
      </div>
    </div>
  );
}
