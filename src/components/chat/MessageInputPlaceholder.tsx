import { cn } from "@/lib/utils";

import InlineEmojiText from "./InlineEmojiText";

interface MessageInputPlaceholderProps {
  channelName: string;
  replyDisplayName: string | null;
  /** DMs address a person ("Message @Ada"), channels a room ("#general"). */
  isDM?: boolean;
  /** A voice channel's chat: its glyph already says voice, so no "#". */
  isVoice?: boolean;
  className?: string;
}

/** The composer's prompt, shared by the visible placeholder and its label. */
export function composerPrompt({
  channelName,
  replyDisplayName,
  isDM = false,
  isVoice = false,
}: {
  channelName: string;
  replyDisplayName: string | null;
  isDM?: boolean;
  isVoice?: boolean;
}) {
  if (replyDisplayName) return `Reply to ${replyDisplayName}…`;
  if (isDM) return `Message @${channelName}`;
  return isVoice ? `Message ${channelName}` : `Message #${channelName}`;
}

export function MessageInputPlaceholder({
  channelName,
  replyDisplayName,
  isDM = false,
  isVoice = false,
  className,
}: MessageInputPlaceholderProps) {
  const text = composerPrompt({
    channelName,
    replyDisplayName,
    isDM,
    isVoice,
  });

  return (
    <InlineEmojiText
      text={text}
      // One line, ellipsised: a long channel or person name must never wrap
      // the prompt past the 48px row (it was clipped mid-glyph on phones).
      className={cn("block truncate", className)}
    />
  );
}
