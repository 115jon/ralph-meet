import { extractCustomEmojiIds, splitTextByNativeEmoji } from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";

import EmojiToken from "./EmojiToken";

const CUSTOM_EMOJI_REGEX = /<:[a-z0-9_]+:[a-z0-9-]+>/gi;

interface InlineEmojiTextProps {
  text: string;
  className?: string;
  emojiClassName?: string;
  selectable?: boolean;
}

function renderPlainText(
  text: string,
  keyPrefix: string,
  emojiClassName: string | undefined,
  selectable: boolean,
) {
  return splitTextByNativeEmoji(text).map((part, index) => (
    part.type === "emoji" ? (
      <EmojiToken
        key={`${keyPrefix}-emoji-${index}`}
        value={part.value}
        className={emojiClassName}
        selectable={selectable}
      />
    ) : part.value
  ));
}

export default function InlineEmojiText({
  text,
  className,
  emojiClassName,
  selectable = false,
}: InlineEmojiTextProps) {
  const customEmojiIds = extractCustomEmojiIds(text);
  const customEmojiMap = useCustomEmojiLookup(customEmojiIds);
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CUSTOM_EMOJI_REGEX)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(...renderPlainText(text.slice(lastIndex, index), `text-${index}`, emojiClassName, selectable));
    }

    nodes.push(
      <EmojiToken
        key={`custom-${index}`}
        value={token}
        customEmojiMap={customEmojiMap}
        className={emojiClassName}
        selectable={selectable}
      />,
    );

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderPlainText(text.slice(lastIndex), `tail-${lastIndex}`, emojiClassName, selectable));
  }

  return <span className={className}>{nodes.length > 0 ? nodes : text}</span>;
}
