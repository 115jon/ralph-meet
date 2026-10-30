import { cn } from "@/lib/utils";

import InlineEmojiText from "./InlineEmojiText";

interface MessageInputPlaceholderProps {
  channelName: string;
  replyDisplayName: string | null;
  /** DMs address a person ("Message @Ada"), channels a room ("#general"). */
  isDM?: boolean;
  className?: string;
}

/** The composer's prompt, shared by the visible placeholder and its label. */
export function composerPrompt({
  channelName,
  replyDisplayName,
  isDM = false,
}: {
  channelName: string;
  replyDisplayName: string | null;
  isDM?: boolean;
}) {
  if (replyDisplayName) return `Reply to ${replyDisplayName}…`;
  return isDM ? `Message @${channelName}` : `Message #${channelName}`;
}

export function MessageInputPlaceholder({
  channelName,
  replyDisplayName,
  isDM = false,
  className,
}: MessageInputPlaceholderProps) {
  const text = composerPrompt({ channelName, replyDisplayName, isDM });

  return (
    <InlineEmojiText
      text={text}
      // One line, ellipsised: a long channel or person name must never wrap
      // the prompt past the 48px row (it was clipped mid-glyph on phones).
      className={cn("block truncate", className)}
    />
  );
}
