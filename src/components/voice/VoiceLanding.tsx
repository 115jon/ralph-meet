import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { DitherGlyph } from "@/components/ui/dither-glyph";
import { Led } from "@/components/ui/led";
import { Icon } from "@/components/ui/icon";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { TileAvatar } from "./TileParts";

interface VoiceLandingProps {
  channelName: string;
  vcMembers: any[];
  handleJoin: () => void;
  showTextChat: boolean;
  onToggleTextChat: () => void;
  onMenuClick?: () => void;
}

const MAX_LISTED = 6;

/** One person already in the channel: who they are and whether they talk. */
function LandingMember({ member }: { member: any }) {
  const speaking = useSpeakingAttr(member.clerk_user_id);
  const name = member.display_name || member.name || member.username || "?";
  return (
    <li
      {...speaking}
      className="flex h-8 items-center gap-2 rounded-sm px-2 text-left"
    >
      <span className="rm-speak rounded-avatar">
        <TileAvatar
          name={name}
          avatar={member.avatar_url}
          avatarDisplay={member.avatar_display}
          sizeClassName="size-6"
          initialClassName="text-ui-2xs"
        />
      </span>
      <span className="min-w-0 flex-1 truncate font-display [font-optical-sizing:auto] text-[14px] leading-5 font-bold text-ink-1">
        <InlineEmojiText text={name} />
      </span>
      {member.self_deaf ? (
        <Icon
          name="deafen"
          state="off"
          size="xs"
          label="Deafened"
          className="text-muted-state"
        />
      ) : member.self_mute ? (
        <Icon
          name="mic"
          state="off"
          size="xs"
          label="Muted"
          className="text-muted-state"
        />
      ) : (
        <Led state="talk" follow="speaking" />
      )}
    </li>
  );
}

/**
 * Before you join (talk-tree-spec §8 Voice): a still dithered level meter instead of the
 * old dither loop, the channel, who is already in it (speaking lights and
 * all, so you can hear the room before you walk in) and one Join button.
 * Nothing on this surface animates at rest.
 */
export function VoiceLanding({
  channelName,
  vcMembers,
  handleJoin,
  showTextChat,
  onToggleTextChat,
  onMenuClick,
}: VoiceLandingProps) {
  const count = vcMembers.length;
  const listed = vcMembers.slice(0, MAX_LISTED);
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-ply-0">
      <header className="relative z-20 box-content flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 pt-[var(--safe-area-top,0px)]">
        {onMenuClick && (
          <IconButton
            aria-label="Open sidebar"
            icon="menu"
            variant="muted"
            size={32}
            className="md:hidden"
            onClick={onMenuClick}
          />
        )}
        <Icon name="voiceChannel" size="lg" className="shrink-0 text-ink-3" />
        <span className="min-w-0 truncate font-display [font-optical-sizing:auto] text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1">
          <InlineEmojiText text={channelName} />
        </span>
        {!showTextChat && (
          <IconButton
            aria-label="Show chat"
            icon="chat"
            variant="muted"
            size={32}
            className="ml-auto"
            onClick={onToggleTextChat}
          />
        )}
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-10 pb-[max(2.5rem,var(--safe-area-bottom,0px))] text-center">
        <DitherGlyph motif="voice" size="md" />
        <div className="flex max-w-[40ch] flex-col items-center gap-1">
          <h2 className="max-w-full font-display [font-optical-sizing:auto] text-[28px] leading-8 font-extrabold tracking-[-0.03em] text-balance break-words text-ink-1">
            <InlineEmojiText text={channelName} />
          </h2>
          <p className="text-ui-sm text-pretty text-ink-2">
            {count === 0
              ? "No one's here yet. Join and the others will see you in the channel."
              : count === 1
                ? "1 person is in voice."
                : `${count} people are in voice.`}
          </p>
        </div>

        {count > 0 && (
          <ul
            aria-label={`In ${channelName}`}
            className="flex w-full max-w-[280px] flex-col rounded-lg border border-line bg-ply-1 p-1"
          >
            {listed.map((m) => (
              <LandingMember key={m.clerk_user_id} member={m} />
            ))}
            {count > MAX_LISTED && (
              <li className="flex h-8 items-center px-2 text-ui-xs text-ink-3">
                and {count - MAX_LISTED} more
              </li>
            )}
          </ul>
        )}

        <Button type="button" size="lg" onClick={handleJoin}>
          Join voice
        </Button>
      </div>
    </div>
  );
}
