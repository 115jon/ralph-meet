import {
  parseCustomEmojiToken,
  resolveNativeEmojiShortcode,
  resolveNativeEmojiValue,
} from "@/lib/emoji";

import InlineEmoji from "./InlineEmoji";

type EmojiTokenCustomMapItem = {
  image_url?: string | null;
};

interface EmojiTokenProps {
  value: string;
  customEmojiMap?: Record<string, EmojiTokenCustomMapItem>;
  className?: string;
  fallbackClassName?: string;
  selectable?: boolean;
}

const EMPTY_CUSTOM_EMOJI_MAP: Record<string, EmojiTokenCustomMapItem> = {};

export default function EmojiToken({
  value,
  customEmojiMap = EMPTY_CUSTOM_EMOJI_MAP,
  className,
  fallbackClassName,
  selectable = false,
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
        selectionText={`:${customEmoji.shortcode}:`}
        selectable={selectable}
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
        selectionText={nativeEmoji.native}
        selectable={selectable}
        className={className}
      />
    );
  }

  return <span className={fallbackClassName ?? className}>{value}</span>;
}
