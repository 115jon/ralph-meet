import { AvatarImage } from "@/components/chat/AvatarImage";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";

const SIZES = {
  16: "size-4 text-[9px]",
  20: "size-5 text-[10px]",
  24: "size-6 text-ui-2xs",
  32: "size-8 text-ui-xs",
  36: "size-9 text-ui-sm",
  40: "size-10 text-ui-sm",
} as const;

export type MiniAvatarSize = keyof typeof SIZES;

/**
 * A user's avatar at list sizes (search results, quick switcher, filter
 * chips): the shared AvatarImage, so avatar crops and decorations render as
 * they do in messages, with the same initial fallback.
 */
export function MiniAvatar({
  avatarUrl,
  avatarDisplay,
  displayName,
  username,
  size = 32,
  className,
}: {
  avatarUrl?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
  displayName?: string | null;
  username?: string | null;
  size?: MiniAvatarSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-tint-2 font-semibold text-rm-text-secondary select-none",
        SIZES[size],
        className,
      )}
    >
      {avatarUrl ? (
        <AvatarImage
          src={getAuthAssetUrl(avatarUrl)}
          alt=""
          display={avatarDisplay}
          loading="lazy"
        />
      ) : (
        getDisplayInitial({ display_name: displayName, username })
      )}
    </span>
  );
}
