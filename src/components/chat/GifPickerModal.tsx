import { BaseModal } from "@/components/ui/BaseModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import {
  GIF_FAVORITES_STORAGE_KEY,
  parseStoredGifFavorites,
  toggleGifFavorite,
  type GifPickerAsset,
  type GifPickerCategory,
  type GifPickerItem,
} from "@/lib/gif-picker";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2, Search, X } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, useEffect, useMemo, useRef, useState } from "react";

type GifPickerResponse = {
  results: GifPickerItem[];
  next: string | null;
};

type GifCategoryResponse = {
  categories: GifPickerCategory[];
};

export default function GifPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (gif: GifPickerItem) => Promise<void>;
}) {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<"featured" | "search" | "favorites">("featured");
  const [query, setQuery] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [categories, setCategories] = useState<GifPickerCategory[]>([]);
  const [results, setResults] = useState<GifPickerItem[]>([]);
  const [favorites, setFavorites] = useState<GifPickerItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setFavorites(parseStoredGifFavorites(window.localStorage.getItem(GIF_FAVORITES_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      try {
        const data = await apiGet<GifCategoryResponse>("/api/gifs?mode=categories&limit=8", { signal: controller.signal });
        if (!cancelled) {
          setCategories(data.categories);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setCategories([]);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      setQuery(nextQuery);
      setMode(nextQuery ? "search" : "featured");
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (mode === "favorites") {
      setResults(favorites);
      setNextCursor(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const endpoint = mode === "search" && query
          ? `/api/gifs?mode=search&q=${encodeURIComponent(query)}&limit=24`
          : `/api/gifs?mode=featured&limit=24`;
        const data = await apiGet<GifPickerResponse>(endpoint, { signal: controller.signal });
        if (!cancelled) {
          setResults(data.results);
          setNextCursor(data.next);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setResults([]);
          setNextCursor(null);
          setError("Could not load GIFs right now. Try another search in a moment.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [favorites, mode, query]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);

  const handleToggleFavorite = (gif: GifPickerItem) => {
    setFavorites((current) => {
      const next = toggleGifFavorite(current, gif);
      if (mode === "favorites") {
        setResults(next);
      }
      return next;
    });
  };

  const handleSelect = (gif: GifPickerItem) => {
    onClose();
    void onSelect(gif);
  };

  const handleCategorySearch = (category: GifPickerCategory) => {
    setMode("search");
    setSearchValue(category.query);
  };

  const openFavorites = () => {
    setMode("favorites");
    setQuery("");
    setSearchValue("");
    setResults(favorites);
    setNextCursor(null);
  };

  const handleLoadMore = async () => {
    if (mode === "favorites" || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const endpoint = mode === "search" && query
        ? `/api/gifs?mode=search&q=${encodeURIComponent(query)}&limit=24&next=${encodeURIComponent(nextCursor)}`
        : `/api/gifs?mode=featured&limit=24&next=${encodeURIComponent(nextCursor)}`;
      const data = await apiGet<GifPickerResponse>(endpoint);
      setResults((current) => [...current, ...data.results]);
      setNextCursor(data.next);
      setError(null);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setError("Could not load more GIFs. Scroll again to retry.");
      }
    } finally {
      loadingMoreRef.current = false;
    }
  };

  const handleScroll = async () => {
    const el = scrollRef.current;
    if (!el || !nextCursor) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
      await handleLoadMore();
    }
  };

  const favoriteCardBg = resolvedTheme === "light" ? "bg-white/95" : "bg-black/70";
  const favoriteIconBase = resolvedTheme === "light" ? "text-black" : "text-white";
  const panelLayout = expanded
    ? "left-1/2 top-1/2 h-[min(82vh,780px)] w-[min(900px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
    : "bottom-[calc(88px+var(--safe-area-bottom,0px))] right-4 h-[min(68vh,620px)] w-[min(420px,calc(100vw-2rem))] max-sm:inset-x-2 max-sm:bottom-[calc(76px+var(--safe-area-bottom,0px))] max-sm:h-[min(72vh,560px)] max-sm:w-auto";
  const resultColumns = expanded ? "columns-2 gap-3 md:columns-3 lg:columns-4" : "columns-2 gap-2";

  return (
    <BaseModal onClose={onClose}>
      <TooltipProvider>
        <div
          className={cn("fixed inset-0 z-[250]", expanded ? "bg-black/55 backdrop-blur-sm" : "bg-transparent")}
          onMouseDown={onClose}
        >
          <div
            className={cn(
              "absolute flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#18191c] shadow-[0_24px_80px_rgba(0,0,0,0.45)]",
              panelLayout
            )}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rm-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-rm-text-primary">
                <button type="button" className="rounded-xl bg-rm-bg-active px-3.5 py-2 text-white">GIFs</button>
                <span className="hidden rounded-xl px-3 py-2 text-rm-text-muted/60 sm:block">Stickers</span>
                <span className="hidden rounded-xl px-3 py-2 text-rm-text-muted/60 sm:block">Emoji</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="rounded-lg p-2 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label={expanded ? "Shrink GIF picker" : "Expand GIF picker"}
                  title={expanded ? "Shrink" : "Expand"}
                >
                  {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label="Close GIF picker"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-b border-rm-border px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                <input
                  ref={searchInputRef}
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search Tenor"
                  className="h-11 w-full rounded-xl border border-[#5865f2] bg-transparent pl-11 pr-4 text-[15px] font-medium text-rm-text outline-none ring-2 ring-[#5865f2]/20"
                />
              </div>
            </div>

            <div ref={scrollRef} onScroll={() => void handleScroll()} className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {!query && (
                <div className={cn("mb-4 grid grid-cols-2 gap-2", expanded && "md:grid-cols-3")}>
                  {favorites.length > 0 && (
                    <button
                      type="button"
                      onClick={openFavorites}
                      className="group relative h-24 overflow-hidden rounded-xl border border-rm-border bg-[#5c6ff8]"
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_45%)]" />
                      <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-white">Favorites</div>
                    </button>
                  )}
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => handleCategorySearch(category)}
                      className="group relative h-24 overflow-hidden rounded-xl border border-rm-border"
                    >
                      <img src={category.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/45" />
                      <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-lg font-black capitalize text-white">{category.label}</div>
                    </button>
                  ))}
                </div>
              )}

              {error ? (
                <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100">
                  {error}
                </div>
              ) : null}

              {results.length > 0 ? (
                <div className={cn(resultColumns, "[column-fill:_balance]")}>
                  {results.map((gif) => (
                    <GifTile
                      key={gif.id}
                      gif={gif}
                      isFavorite={favoriteIds.has(gif.id)}
                      favoriteCardBg={favoriteCardBg}
                      favoriteIconBase={favoriteIconBase}
                      onToggleFavorite={handleToggleFavorite}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ) : !loading ? (
                <div className="flex h-40 items-center justify-center text-center text-sm font-medium text-rm-text-muted">
                  {mode === "favorites"
                    ? "No favorite GIFs yet. Hover a GIF and star it to save it here."
                    : mode === "search"
                      ? `No GIFs found for "${query}".`
                      : "No GIFs available right now."}
                </div>
              ) : null}

              {loading && (
                <div className="py-8 text-center text-sm font-medium text-rm-text-muted">Loading GIFs…</div>
              )}
            </div>
          </div>
        </div>
      </TooltipProvider>
    </BaseModal>
  );
}

const GifTile = memo(function GifTile({
  gif,
  isFavorite,
  favoriteCardBg,
  favoriteIconBase,
  onToggleFavorite,
  onSelect,
}: {
  gif: GifPickerItem;
  isFavorite: boolean;
  favoriteCardBg: string;
  favoriteIconBase: string;
  onToggleFavorite: (gif: GifPickerItem) => void;
  onSelect: (gif: GifPickerItem) => void;
}) {
  return (
    <div className="group relative mb-2 break-inside-avoid overflow-hidden rounded-xl border border-rm-border bg-black/30">
      <button
        type="button"
        onClick={() => onSelect(gif)}
        className="block w-full overflow-hidden text-left"
        aria-label={`Send GIF: ${gif.altText || gif.title}`}
      >
        <GifPreviewMedia asset={gif.preview} alt={gif.altText || gif.title} />
      </button>

      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/35 to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(gif);
            }}
            className={cn(
              "absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 opacity-0 shadow-lg transition-all duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:scale-110",
              favoriteCardBg,
              isFavorite ? "scale-110" : "scale-100"
            )}
          >
            <svg
              viewBox="0 0 24 24"
              className={cn(
                "h-4.5 w-4.5 transition-all duration-200",
                isFavorite ? "fill-yellow-400 text-yellow-400 scale-110" : `${favoriteIconBase} fill-transparent group-hover:text-yellow-400`
              )}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8} className="bg-rm-bg-floating text-rm-text-primary">
          {isFavorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
});

function GifPreviewMedia({ asset, alt }: { asset: GifPickerAsset; alt: string }) {
  const className = "h-auto w-full object-cover";
  const style = { aspectRatio: `${asset.width} / ${asset.height}` };

  if (asset.contentType === "video/mp4") {
    return (
      <video
        src={asset.url}
        className={className}
        style={style}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={asset.url}
      alt={alt}
      width={asset.width}
      height={asset.height}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
    />
  );
}
