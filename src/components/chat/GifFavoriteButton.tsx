import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getFavoriteActionLabel } from "@/lib/gif-favorite-item";
import { getGifItemIdentityKey, type GifPickerItem } from "@/lib/gif-picker";
import { cn } from "@/lib/utils";
import { useGifFavoriteActions, useGifFavoritesStore } from "@/stores/useGifFavoritesStore";
import { useEffect, useState } from "react";

interface GifFavoriteButtonProps {
  gif: GifPickerItem;
  className?: string;
}

export function GifFavoriteButton({ gif, className }: GifFavoriteButtonProps) {
  const favorites = useGifFavoritesStore((state) => state.favorites);
  const { load, toggle } = useGifFavoriteActions();
  const [pending, setPending] = useState(false);
  const isFavorite = favorites.some((item) => getGifItemIdentityKey(item) === getGifItemIdentityKey(gif));
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
              "absolute left-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-white/95 text-black shadow-lg transition-all duration-150 hover:scale-110 disabled:pointer-events-none disabled:opacity-70 dark:bg-black/70 dark:text-white",
              isFavorite && "scale-105",
              className
            )}
            aria-label={label}
            title={label}
          >
            <svg
              viewBox="0 0 24 24"
              className={cn(
                "h-4.5 w-4.5 transition-all duration-200",
                isFavorite ? "scale-110 fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400" : "fill-transparent text-current hover:text-amber-500 dark:hover:text-yellow-400"
              )}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="bg-rm-bg-floating text-rm-text-primary">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
