import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getFavoriteActionLabel } from "@/lib/gif-favorite-item";
import { getGifItemIdentityKey, type GifPickerItem } from "@/lib/gif-picker";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { HIT, PRESS } from "@/components/ui/interaction";
import {
  useGifFavoriteActions,
  useGifFavoritesStore,
} from "@/stores/useGifFavoritesStore";
import { useEffect, useState } from "react";

interface GifFavoriteButtonProps {
  gif: GifPickerItem;
  className?: string;
}

export function GifFavoriteButton({ gif, className }: GifFavoriteButtonProps) {
  const favorites = useGifFavoritesStore((state) => state.favorites);
  const { load, toggle } = useGifFavoriteActions();
  const [pending, setPending] = useState(false);
  const isFavorite = favorites.some(
    (item) => getGifItemIdentityKey(item) === getGifItemIdentityKey(gif),
  );
  const label = getFavoriteActionLabel(gif, isFavorite);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={pending}
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              setPending(true);
              try {
                await toggle(gif);
              } finally {
                setPending(false);
              }
            }}
            className={cn(
              // Sits over the GIF itself: a media overlay chip (6.5).
              "absolute left-2 top-2 z-30 flex size-8 items-center justify-center rounded-md bg-black/60 text-white disabled:pointer-events-none disabled:opacity-70",
              PRESS,
              HIT,
              "absolute",
              className,
            )}
            aria-label={label}
            aria-pressed={isFavorite}
          >
            <Icon
              name="star"
              state={isFavorite ? "active" : "idle"}
              size="md"
              // Over media the chip is black/60, where the theme's accent ink
              // can fall under 3:1 (light themes); the fill carries the state.
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
