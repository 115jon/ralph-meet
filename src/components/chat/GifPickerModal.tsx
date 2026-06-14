import { BaseModal } from "@/components/ui/BaseModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { GifProviderBranding } from "./GifProviderBranding";
import {
  appendUniqueGifPickerItems,
  DEFAULT_GIF_PROVIDER,
  dedupeGifPickerItems,
  GIF_FAVORITES_STORAGE_KEY,
  getGifItemIdentityKey,
  getGifProviderLabel,
  getGifProviderSearchPlaceholder,
  parseStoredGifFavorites,
  toggleGifFavorite,
  type GifPickerAsset,
  type GifPickerCategory,
  type GifPickerItem,
  type GifProvider,
} from "@/lib/gif-picker";
import { cn } from "@/lib/utils";
import { useGifFavoriteActions, useGifFavoritesStore } from "@/stores/useGifFavoritesStore";
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, Search, Star, X } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, useEffect, useMemo, useRef, useState } from "react";

type GifPickerResponse = {
  results: GifPickerItem[];
  next: string | null;
};

type GifCategoryResponse = {
  categories: GifPickerCategory[];
};

const DEFAULT_PROVIDER_OPTIONS: GifProvider[] = ["klipy", "tenor"];

interface GifPickerModalProps {
  onClose: () => void;
  onSelect: (gif: GifPickerItem) => Promise<void>;
  apiQuery?: string;
  defaultProvider?: GifProvider;
  providers?: GifProvider[];
  skipAuth?: boolean;
}

export default function GifPickerModal({
  onClose,
  onSelect,
  apiQuery = "",
  defaultProvider = DEFAULT_GIF_PROVIDER,
  providers,
  skipAuth = false,
}: GifPickerModalProps) {
  const { resolvedTheme } = useTheme();
  const providerOptions = providers?.length ? providers : DEFAULT_PROVIDER_OPTIONS;
  const initialProvider = providerOptions.includes(defaultProvider) ? defaultProvider : providerOptions[0];
  const apiQuerySuffix = apiQuery ? `&${apiQuery.replace(/^[?&]+/, "")}` : "";
  const [mode, setMode] = useState<"categories" | "search" | "favorites">("categories");
  const [provider, setProvider] = useState<GifProvider>(initialProvider);
  const [query, setQuery] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [categories, setCategories] = useState<GifPickerCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [results, setResults] = useState<GifPickerItem[]>([]);
  const [localFavorites, setLocalFavorites] = useState<GifPickerItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreCooldownUntil, setLoadMoreCooldownUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreBlockedUntilRef = useRef(0);
  const providerLabel = getGifProviderLabel(provider);
  const dbFavorites = useGifFavoritesStore((state) => state.favorites);
  const { load: loadDbFavorites, toggle: toggleDbFavorite } = useGifFavoriteActions();
  const favorites = skipAuth ? localFavorites : dbFavorites;

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [provider]);

  useEffect(() => {
    if (!skipAuth) return;
    if (typeof window === "undefined") return;
    setLocalFavorites(parseStoredGifFavorites(window.localStorage.getItem(GIF_FAVORITES_STORAGE_KEY)));
  }, [skipAuth]);

  useEffect(() => {
    if (!skipAuth) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites, skipAuth]);

  useEffect(() => {
    if (skipAuth) return;
    void loadDbFavorites();
  }, [loadDbFavorites, skipAuth]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setCategoriesLoading(true);
      try {
        const data = await apiGet<GifCategoryResponse>(`/api/gifs?mode=categories&provider=${provider}${apiQuerySuffix}`, {
          signal: controller.signal,
          skipAuth,
        });
        if (!cancelled) {
          setCategories(data.categories);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setCategories([]);
        }
      } finally {
        if (!cancelled) {
          setCategoriesLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiQuerySuffix, provider, skipAuth]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      setQuery(nextQuery);
      setMode((current) => current === "favorites" ? current : nextQuery ? "search" : "categories");
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
      setLoadingMore(false);
      setLoadMoreCooldownUntil(null);
      loadMoreBlockedUntilRef.current = 0;
      setError(null);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (mode === "categories") {
      setResults([]);
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
      setLoadMoreCooldownUntil(null);
      loadMoreBlockedUntilRef.current = 0;
      setError(null);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (!query) {
      setResults([]);
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
      setLoadMoreCooldownUntil(null);
      loadMoreBlockedUntilRef.current = 0;
      setError(null);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const load = async () => {
      setLoading(true);
      setLoadingMore(false);
      setLoadMoreCooldownUntil(null);
      loadMoreBlockedUntilRef.current = 0;
      setError(null);
      try {
        const endpoint = `/api/gifs?mode=search&provider=${provider}&q=${encodeURIComponent(query)}&limit=24${apiQuerySuffix}`;
        const data = await apiGet<GifPickerResponse>(endpoint, { signal: controller.signal, skipAuth });
        if (!cancelled) {
          setResults(dedupeGifPickerItems(data.results.map((item) => ({ ...item, query }))));
          setNextCursor(data.next);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setResults([]);
          setNextCursor(null);
          setError(`Could not load ${providerLabel} GIFs right now. Try another search in a moment.`);
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
  }, [apiQuerySuffix, favorites, mode, provider, providerLabel, query, skipAuth]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => getGifItemIdentityKey(item))), [favorites]);

  const handleToggleFavorite = (gif: GifPickerItem) => {
    if (!skipAuth) {
      void toggleDbFavorite(gif);
      return;
    }

    setLocalFavorites((current) => {
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
    setQuery(category.query);
    setSearchValue(category.query);
  };

  const openFavorites = () => {
    setMode("favorites");
    setQuery("");
    setSearchValue("");
    setResults(dedupeGifPickerItems(favorites));
    setNextCursor(null);
  };

  const closeFavorites = () => {
    setMode("categories");
    setQuery("");
    setSearchValue("");
    setResults([]);
    setNextCursor(null);
    setError(null);
  };

  const handleLoadMore = async () => {
    if (mode !== "search" || !nextCursor || loadingMoreRef.current) return;
    if (Date.now() < loadMoreBlockedUntilRef.current) return;

    const cursor = nextCursor;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const endpoint = `/api/gifs?mode=search&provider=${provider}&q=${encodeURIComponent(query)}&limit=24&next=${encodeURIComponent(cursor)}${apiQuerySuffix}`;
      const data = await apiGet<GifPickerResponse>(endpoint, { skipAuth });
      setResults((current) => appendUniqueGifPickerItems(current, data.results.map((item) => ({ ...item, query }))));
      setNextCursor(data.next);
      loadMoreBlockedUntilRef.current = 0;
      setLoadMoreCooldownUntil(null);
      setError(null);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        if (isRateLimitError(error)) {
          const retryAt = Date.now() + 5000;
          loadMoreBlockedUntilRef.current = retryAt;
          setLoadMoreCooldownUntil(retryAt);
          setError(null);
        } else {
          setError(`Could not load more ${providerLabel} GIFs. Scroll again to retry.`);
        }
      }
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };

  const handleProviderChange = (nextProvider: GifProvider) => {
    setProvider(nextProvider);
    setError(null);
    setNextCursor(null);
    setLoadMoreCooldownUntil(null);
    loadMoreBlockedUntilRef.current = 0;
  };

  useEffect(() => {
    if (!loadMoreCooldownUntil) return;
    const timeout = window.setTimeout(() => {
      loadMoreBlockedUntilRef.current = 0;
      setLoadMoreCooldownUntil(null);
    }, Math.max(0, loadMoreCooldownUntil - Date.now()));

    return () => window.clearTimeout(timeout);
  }, [loadMoreCooldownUntil]);

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

            {mode === "favorites" ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={closeFavorites}
                  className="rounded-lg p-2 text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label="Back to GIFs"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h3 className="truncate text-sm font-black text-rm-text">Favorites</h3>
              </div>
            ) : (
              <div className="border-b border-rm-border px-4 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                  <div className="flex gap-2">
                    <input
                      ref={searchInputRef}
                      value={searchValue}
                      onChange={(event) => setSearchValue(event.target.value)}
                      placeholder={getGifProviderSearchPlaceholder(provider)}
                      className="h-11 w-full rounded-xl border border-[#5865f2] bg-transparent pl-11 pr-4 text-[15px] font-medium text-rm-text outline-none ring-2 ring-[#5865f2]/20"
                    />
                    <div className="relative shrink-0">
                      {providerOptions.length > 1 ? (
                        <>
                          <select
                            value={provider}
                            onChange={(event) => handleProviderChange(event.target.value as GifProvider)}
                            aria-label="GIF provider"
                            className="h-11 appearance-none rounded-xl border border-rm-border bg-rm-bg-elevated pl-3 pr-9 text-sm font-semibold text-rm-text outline-none transition hover:bg-rm-bg-hover"
                          >
                            {providerOptions.map((option) => (
                              <option key={option} value={option}>{getGifProviderLabel(option)}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                        </>
                      ) : (
                        <div className="flex h-11 items-center rounded-xl border border-rm-border bg-rm-bg-elevated px-3 text-sm font-semibold text-rm-text">
                          {getGifProviderLabel(provider)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={scrollRef} onScroll={() => void handleScroll()} className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {mode === "categories" && (
                <div className={cn("mb-4 grid grid-cols-2 gap-2", expanded && "md:grid-cols-3")}>
                  <button
                    type="button"
                    onClick={openFavorites}
                    className="group relative h-24 overflow-hidden rounded-xl border border-rm-border bg-[#5c6ff8]"
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_45%)]" />
                    <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-white">Favorites</div>
                  </button>
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
                      <GifProviderBranding fileKeyOrUrl={category.imageUrl} />
                    </button>
                  ))}
                </div>
              )}

              {mode === "categories" && categoriesLoading ? (
                <div className="py-8 text-center text-sm font-medium text-rm-text-muted">Loading {providerLabel} GIF categories…</div>
              ) : null}

              {mode === "categories" && !categoriesLoading && categories.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-center text-sm font-medium text-rm-text-muted">
                  No {providerLabel} GIF categories available right now.
                </div>
              ) : null}

              {error ? (
                <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100">
                  {error}
                </div>
              ) : null}

              {mode === "favorites" && results.length === 0 ? <FavoritesEmptyState /> : null}

              {mode !== "categories" && results.length > 0 ? (
                <div className={cn(resultColumns, "[column-fill:_balance]")}>
                  {results.map((gif) => (
                    <GifTile
                      key={getGifItemIdentityKey(gif)}
                      gif={gif}
                      isFavorite={favoriteIds.has(getGifItemIdentityKey(gif))}
                      favoriteCardBg={favoriteCardBg}
                      favoriteIconBase={favoriteIconBase}
                      onToggleFavorite={handleToggleFavorite}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ) : mode === "search" && !loading ? (
                <div className="flex h-40 items-center justify-center text-center text-sm font-medium text-rm-text-muted">
                  {`No GIFs found for "${query}".`}
                </div>
              ) : null}

              {loading ? <GifLoadingSkeleton message={`Loading ${providerLabel} GIFs…`} /> : null}

              {loadingMore || loadMoreCooldownUntil ? (
                <GifLoadingSkeleton
                  compact
                  message={
                    loadMoreCooldownUntil
                      ? `${providerLabel} is rate limiting us. Waiting before the next retry…`
                      : `Loading more ${providerLabel} GIFs…`
                  }
                />
              ) : null}
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
      <GifProviderBranding fileKeyOrUrl={gif.sourceUrl || gif.send.url || gif.preview.url} />

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

function FavoritesEmptyState() {
  return (
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1" aria-live="polite">
      <div className="relative flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <Star className="absolute right-4 top-3 h-7 w-7 fill-amber-400 text-amber-400" aria-hidden="true" />
        <p>Click the star in the corner of a gif to favorite it</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <p>Favorites will show up here!</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <p>So uhh... maybe go favorite some GIFs?</p>
      </div>
    </div>
  );
}

function isRateLimitError(error: unknown): boolean {
  const maybeError = error as { status?: unknown; code?: unknown; message?: unknown };
  return (
    maybeError.status === 429 ||
    String(maybeError.code || "").endsWith("_RATE_LIMITED") ||
    String(maybeError.message || "").includes("429")
  );
}

function GifLoadingSkeleton({ compact = false, message }: { compact?: boolean; message: string }) {
  return (
    <div className="py-4" aria-live="polite" aria-busy="true">
      <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-rm-text-muted/80">{message}</div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: compact ? 4 : 8 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "animate-pulse rounded-xl border border-white/5 bg-white/[0.08]",
              index % 3 === 0 ? "h-28" : index % 3 === 1 ? "h-20" : "h-24"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function GifPreviewMedia({ asset, alt }: { asset: GifPickerAsset; alt: string }) {
  const className = "h-auto w-full object-cover";
  const style = { aspectRatio: `${asset.width} / ${asset.height}` };

  if (asset.contentType === "video/mp4") {
    return (
      <video
        src={getMediaUrl(asset.url)}
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
      src={getAuthAssetUrl(asset.url)}
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
