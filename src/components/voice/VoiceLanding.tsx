import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { DitherField } from "@/components/ui/DitherField";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { getAuthAssetUrl } from "@/lib/platform";
import { AvatarImage } from "../chat/AvatarImage";
import { Icon } from "@/components/ui/icon";

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

      <header className="relative z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-rm-border px-4 pt-[var(--safe-area-top,0px)]">
        {onMenuClick && (
          <IconButton
            aria-label="Open sidebar"
            icon="menu"
            variant="muted"
            size="sm"
            className="md:hidden"
            onClick={onMenuClick}
          />
        )}
        <Icon
          name="voiceChannel"
          size="lg"
          className="shrink-0 text-rm-text-muted"
        />
        <span className="min-w-0 truncate text-ui-md font-semibold text-rm-text">
          <InlineEmojiText text={channelName} />
        </span>
        {!showTextChat && (
          <IconButton
            aria-label="Show chat"
            icon="chat"
            variant="muted"
            size="sm"
            className="ml-auto"
            onClick={onToggleTextChat}
          />
        )}
      </header>

      {/* Empty-state anatomy (14.1): glyph, title, body, one action. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 pb-[max(3rem,var(--safe-area-bottom,0px))] text-center">
        <Icon
          name="voiceChannel"
          size="3xl"
          className="hidden text-rm-text-muted md:block"
        />
        <Icon
          name="voiceChannel"
          size="2xl"
          className="text-rm-text-muted md:hidden"
        />
        <h2 className="max-w-full text-ui-xl font-semibold text-balance break-words text-rm-text">
          <InlineEmojiText text={channelName} />
        </h2>
        <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
          {vcMembers.length === 0
            ? "No one is here yet. Join and others will see you in the channel."
            : `${vcMembers.length} ${vcMembers.length === 1 ? "person is" : "people are"} in voice.`}
        </p>

        {vcMembers.length > 0 && (
          <div className="flex items-center">
            {vcMembers.slice(0, 5).map((m, index) => (
              <div
                key={m.clerk_user_id}
                className={
                  "size-9 overflow-visible rounded-full bg-rm-tint-2 ring-2 ring-rm-bg-primary" +
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
                  <div className="flex h-full w-full items-center justify-center rounded-full text-ui-xs font-semibold text-rm-text">
                    {m.name?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
              </div>
            ))}
            {vcMembers.length > 5 && (
              <div className="-ml-2 flex size-9 items-center justify-center rounded-full bg-rm-tint-2 text-ui-xs font-semibold text-rm-text ring-2 ring-rm-bg-primary">
                +{vcMembers.length - 5}
              </div>
            )}
          </div>
        )}

        <Button type="button" size="lg" onClick={handleJoin} className="mt-1">
          Join voice
        </Button>
      </div>
    </div>
  );
}
