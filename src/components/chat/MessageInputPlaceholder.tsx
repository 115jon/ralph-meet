import { cn } from "@/lib/utils";

import InlineEmojiText from "./InlineEmojiText";

interface MessageInputPlaceholderProps {
  channelName: string;
  replyDisplayName: string | null;
  className?: string;
}

export function MessageInputPlaceholder({
  channelName,
  replyDisplayName,
  className,
}: MessageInputPlaceholderProps) {
  const text = replyDisplayName
    ? `Reply to ${replyDisplayName}…`
    : `Message #${channelName}`;

  return (
    <InlineEmojiText
      text={text}
      className={cn("block whitespace-pre-wrap wrap-break-word", className)}
    />
  );
}
