import {
  parseCustomEmojiToken,
  resolveNativeEmojiShortcode,
  resolveNativeEmojiValue,
  type GeneratedEmoji,
} from "@/lib/emoji";

import InlineEmoji from "./InlineEmoji";

interface EmojiTokenProps {
  value: string;
  customEmojiMap?: Record<string, GeneratedEmoji>;
  className?: string;
  fallbackClassName?: string;
}

export default function EmojiToken({
  value,
  customEmojiMap = {},
  className,
  fallbackClassName,
}: EmojiTokenProps) {
  const customEmoji = parseCustomEmojiToken(value);
  if (customEmoji) {
    const item = customEmojiMap[customEmoji.id];
    if (!item?.image_url) {
      return <span className={fallbackClassName ?? className}>{`:${customEmoji.shortcode}:`}</span>;
    }

    return (
      <InlineEmoji
        alt={`:${customEmoji.shortcode}:`}
        imageUrl={item.image_url}
        className={className}
      />
    );
  }

  const nativeEmoji = value.startsWith(":") && value.endsWith(":")
    ? resolveNativeEmojiShortcode(value.slice(1, -1))
    : resolveNativeEmojiValue(value);

  if (nativeEmoji) {
    return (
      <InlineEmoji
        alt={`:${nativeEmoji.preferredShortcode}:`}
        imageUrl={nativeEmoji.imageUrl}
        native={nativeEmoji.native}
        className={className}
      />
    );
  }

  return <span className={fallbackClassName ?? className}>{value}</span>;
}
