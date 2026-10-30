import { useIsMobile } from "@/hooks/useMediaQuery";
import type { EmojiRecentItem } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_SEPARATOR,
} from "@/components/ui/menu";

import EmojiToken from "./EmojiToken";

interface MessageReactionSubmenuProps {
  items: EmojiRecentItem[];
  customEmojiMap: Record<string, { image_url?: string | null }>;
  onReact: (item: EmojiRecentItem) => void;
  onViewMore: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Content of the context menu's "Add reaction" submenu.
 *
 * Desktop renders it as the shared Base UI rows (`DropdownMenuItem`: leading
 * 16px emoji column, roving focus, typeahead). Phones show the same content
 * inline inside the `ActionSheet`, which has no Base UI menu around it, so
 * they get plain menu-recipe buttons.
 */
export function MessageReactionSubmenu({
  items,
  customEmojiMap,
  onReact,
  onViewMore,
}: MessageReactionSubmenuProps) {
  const isMobile = useIsMobile();
  const emoji = (item: EmojiRecentItem) => (
    <EmojiToken
      value={item.insertText}
      customEmojiMap={customEmojiMap}
      className="size-4"
      fallbackClassName="text-ui-sm leading-none"
    />
  );

  if (isMobile) {
    return (
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <button
            key={`${item.type}:${item.id}`}
            type="button"
            onClick={() => onReact(item)}
            className={cn(MENU_ITEM, MENU_ITEM_DEFAULT)}
          >
            <span className={MENU_ICON}>{emoji(item)}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        ))}
        <div className={MENU_SEPARATOR} />
        <button
          type="button"
          onClick={onViewMore}
          className={cn(MENU_ITEM, MENU_ITEM_DEFAULT)}
        >
          <Icon name="react" size="sm" className={MENU_ICON} />
          <span className="min-w-0 flex-1 truncate">View more</span>
        </button>
      </div>
    );
  }

  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={`${item.type}:${item.id}`}
          icon={emoji(item)}
          onClick={() => onReact(item)}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        icon={<Icon name="react" size="sm" />}
        onClick={onViewMore}
      >
        View more
      </DropdownMenuItem>
    </>
  );
}
