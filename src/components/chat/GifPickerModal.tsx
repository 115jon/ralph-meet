import { BaseModal } from "@/components/ui/BaseModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import klipyTextLightUrl from "@/assets/klipy-text-light.svg";
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
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, Search, Star, X, Volume2, VolumeX } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type GifPickerResponse = {
  results: GifPickerItem[];
  next: string | null;
};

type GifCategoryResponse = {
  categories: GifPickerCategory[];
};

const DEFAULT_PROVIDER_OPTIONS: GifProvider[] = ["klipy", "tenor"];

function useColumnsCount(expanded: boolean) {
  const [cols, setCols] = useState(2);

  useEffect(() => {
    if (!expanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCols(2);
      return;
    }

    const mediaMd = window.matchMedia("(min-width: 768px)");
    const mediaLg = window.matchMedia("(min-width: 1024px)");

    const update = () => {
      if (mediaLg.matches) {
        setCols(4);
      } else if (mediaMd.matches) {
        setCols(3);
      } else {
        setCols(2);
      }
    };

    update();
    mediaMd.addEventListener("change", update);
    mediaLg.addEventListener("change", update);

    return () => {
      mediaMd.removeEventListener("change", update);
      mediaLg.removeEventListener("change", update);
    };
  }, [expanded]);

  return cols;
}

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
  const [mediaType, setMediaType] = useState<"gifs" | "stickers" | "clips">("gifs");
  const [query, setQuery] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [_isSuggesting, setIsSuggesting] = useState(false);
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
  const [clipsMuted, setClipsMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("chat:clips:muted") !== "false";
  });

  const numCols = useColumnsCount(expanded);
  const columnItems = useMemo(() => {
    const cols: GifPickerItem[][] = Array.from({ length: numCols }, () => []);
    results.forEach((item, index) => {
      cols[index % numCols].push(item);
    });
    return cols;
  }, [results, numCols]);

  const handleToggleClipsMuted = useCallback(() => {
    setClipsMuted((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("chat:clips:muted", String(next));
      }
      return next;
    });
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreBlockedUntilRef = useRef(0);
  const cacheRef = useRef<Map<string, { results: GifPickerItem[]; next: string | null; error: string | null; scrollTop?: number }>>(new Map());
  const categoriesCacheRef = useRef<Map<string, GifPickerCategory[]>>(new Map());

  const dbFavorites = useGifFavoritesStore((state) => state.favorites);
  const { load: loadDbFavorites, toggle: toggleDbFavorite } = useGifFavoriteActions();
  const favorites = skipAuth ? localFavorites : dbFavorites;

  const filteredFavorites = useMemo(() => {
    return favorites.filter((gif) => {
      const itemMediaType = gif.mediaType || (
        (gif.duration !== undefined || gif.send.contentType === "video/mp4" || gif.send.url.includes(".mp4") || gif.send.url.includes("/clips/"))
          ? "clips"
          : (gif.send.contentType === "image/apng" || gif.send.url.includes("/stickers/") || gif.preview.url.includes("/stickers/") || gif.send.url.includes("sticker") || gif.preview.url.includes("sticker"))
            ? "stickers"
            : "gifs"
      );
      return itemMediaType === mediaType;
    });
  }, [favorites, mediaType]);

  const getCacheKey = useCallback((mType: "gifs" | "stickers" | "clips", mMode: "categories" | "search" | "favorites", q: string, prov: GifProvider) => {
    return `${mType}:${mMode}:${q}:${prov}`;
  }, []);

  const handleMediaTypeChange = useCallback((nextMediaType: "gifs" | "stickers" | "clips") => {
    const currentCacheKey = getCacheKey(mediaType, mode, query, provider);
    if (scrollRef.current) {
      const cached = cacheRef.current.get(currentCacheKey);
      if (cached) {
        cached.scrollTop = scrollRef.current.scrollTop;
      }
    }

    const nextProvider = (nextMediaType === "stickers" || nextMediaType === "clips") ? "klipy" : provider;
    
    let nextMode = mode;
    if (mode !== "favorites") {
      nextMode = searchValue.trim() ? "search" : "categories";
    }
    const nextQuery = nextMode === "categories" ? "" : query;

    setMediaType(nextMediaType);
    if (nextMediaType === "stickers" || nextMediaType === "clips") {
      setProvider("klipy");
    }
    setMode(nextMode);

    if (nextMode === "favorites") {
      const nextFilteredFavorites = favorites.filter((gif) => {
        const itemMediaType = gif.mediaType || (
          (gif.duration !== undefined || gif.send.contentType === "video/mp4" || gif.send.url.includes(".mp4") || gif.send.url.includes("/clips/"))
            ? "clips"
            : (gif.send.contentType === "image/apng" || gif.send.url.includes("/stickers/") || gif.preview.url.includes("/stickers/") || gif.send.url.includes("sticker") || gif.preview.url.includes("sticker"))
              ? "stickers"
              : "gifs"
        );
        return itemMediaType === nextMediaType;
      });
      setResults(nextFilteredFavorites);
      setNextCursor(null);
      setError(null);
      setLoading(false);
    } else {
      const nextCacheKey = getCacheKey(nextMediaType, nextMode, nextQuery, nextProvider);
      const cached = cacheRef.current.get(nextCacheKey);
      if (cached) {
        setResults(cached.results);
        setNextCursor(cached.next);
        setError(cached.error);
        setLoading(false);
        if (cached.scrollTop !== undefined) {
          setTimeout(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = cached.scrollTop || 0;
            }
          }, 0);
        }
      } else {
        setResults([]);
        setNextCursor(null);
        setError(null);
      }
    }
  }, [mediaType, mode, query, provider, searchValue, getCacheKey, favorites]);

  const providerLabel = getGifProviderLabel(provider);

  const mediaLabel = useMemo(() => {
    if (mediaType === "clips") return "clips";
    if (mediaType === "stickers") return "stickers";
    return "GIFs";
  }, [mediaType]);

  const getNoResultsMessage = () => {
    if (query) {
      return `No ${mediaLabel} found for "${query}".`;
    }
    return `No ${mediaLabel} found.`;
  };


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

    const cacheKey = `${provider}:${mediaType}`;
    const cached = categoriesCacheRef.current.get(cacheKey);
    if (cached) {
      setCategories(cached);
      setCategoriesLoading(false);
      return;
    }

    const run = async () => {
      setCategoriesLoading(true);
      try {
        const data = await apiGet<GifCategoryResponse>(`/api/gifs?mode=categories&provider=${provider}&mediaType=${mediaType}${apiQuerySuffix}`, {
          signal: controller.signal,
          skipAuth,
        });
        if (!cancelled) {
          categoriesCacheRef.current.set(cacheKey, data.categories);
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
  }, [apiQuerySuffix, provider, mediaType, skipAuth]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      setQuery(nextQuery);
      setMode((current) => {
        if (current === "favorites") return current;
        return nextQuery ? "search" : "categories";
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const timeout = window.setTimeout(async () => {
      setIsSuggesting(true);
      try {
        const queryParams = new URLSearchParams({
          mode: "suggestions",
          q: trimmed,
          provider
        });
        if (skipAuth) {
          queryParams.set("skipAuth", "true");
        }
        const data = await apiGet<{ results: string[] }>(`/api/gifs?${queryParams.toString()}${apiQuerySuffix}`, {
          signal: controller.signal,
          skipAuth,
        });
        if (!cancelled && data && Array.isArray(data.results)) {
          setSuggestions(data.results.slice(0, 6));
        }
      } catch (err: any) {
        if (!cancelled && err.name !== "AbortError") {
          console.error("Failed to fetch suggestions:", err);
        }
      } finally {
        if (!cancelled) {
          setIsSuggesting(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchValue, provider, skipAuth, apiQuerySuffix]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (mode === "favorites") {
      setResults(filteredFavorites);
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

    const cacheKey = getCacheKey(mediaType, mode, query, provider);
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      if (!cancelled) {
        setResults(cached.results);
        setNextCursor(cached.next);
        setError(cached.error);
        setLoading(false);
        if (cached.scrollTop !== undefined) {
          setTimeout(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = cached.scrollTop || 0;
            }
          }, 0);
        }
      }
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
        const queryParams = new URLSearchParams({
          mode: "search",
          provider,
          limit: "24",
          mediaType,
        });
        if (query) {
          queryParams.set("q", query);
        }
        if (skipAuth) {
          queryParams.set("skipAuth", "true");
        }
        const endpoint = `/api/gifs?${queryParams.toString()}${apiQuerySuffix}`;
        const data = await apiGet<GifPickerResponse>(endpoint, { signal: controller.signal, skipAuth });
        if (!cancelled) {
          const newResults = dedupeGifPickerItems(data.results.map((item) => ({ ...item, query })));
          cacheRef.current.set(cacheKey, { results: newResults, next: data.next, error: null, scrollTop: 0 });
          setResults(newResults);
          setNextCursor(data.next);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setResults([]);
          setNextCursor(null);
          const errMsg = `Could not load ${providerLabel} assets right now. Try again in a moment.`;
          cacheRef.current.set(cacheKey, { results: [], next: null, error: errMsg, scrollTop: 0 });
          setError(errMsg);
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
  }, [apiQuerySuffix, filteredFavorites, mode, provider, providerLabel, query, skipAuth, mediaType, getCacheKey]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => getGifItemIdentityKey(item))), [favorites]);

  const handleToggleFavorite = useCallback((gif: GifPickerItem) => {
    if (!skipAuth) {
      void toggleDbFavorite(gif);
      return;
    }

    setLocalFavorites((current) => {
      return toggleGifFavorite(current, gif);
    });
  }, [skipAuth, toggleDbFavorite]);

  const handleSelect = useCallback((gif: GifPickerItem) => {
    onClose();
    void onSelect(gif);
  }, [onClose, onSelect]);

  const selectSuggestion = (suggestion: string) => {
    setSearchValue(suggestion);
    setQuery(suggestion);
    setMode("search");
    searchInputRef.current?.focus();
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
    setResults(filteredFavorites);
    setNextCursor(null);
  };

  const handleBack = useCallback(() => {
    setQuery("");
    setSearchValue("");
    setResults([]);
    setNextCursor(null);
    setError(null);
    setMode("categories");
  }, []);

  const handleLoadMore = async () => {
    if (mode !== "search" || !nextCursor || loadingMoreRef.current) return;
    if (Date.now() < loadMoreBlockedUntilRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    let currentCursor = nextCursor;
    let accumulatedResults = [...results];
    let attempts = 0;
    let addedCount = 0;
    let nextCursorVal: string | null = nextCursor;

    try {
      while (attempts < 3 && addedCount < 8 && currentCursor) {
        const queryParams = new URLSearchParams({
          mode: "search",
          provider,
          limit: "24",
          next: currentCursor,
          mediaType,
        });
        if (query) {
          queryParams.set("q", query);
        }
        if (skipAuth) {
          queryParams.set("skipAuth", "true");
        }
        const endpoint = `/api/gifs?${queryParams.toString()}${apiQuerySuffix}`;
        const data = await apiGet<GifPickerResponse>(endpoint, { skipAuth });
        
        const incoming = data.results.map((item) => ({ ...item, query }));
        const currentLength = accumulatedResults.length;
        accumulatedResults = appendUniqueGifPickerItems(accumulatedResults, incoming);
        const newlyAdded = accumulatedResults.length - currentLength;
        addedCount += newlyAdded;
        
        const prevCursor = currentCursor;
        currentCursor = data.next || "";
        nextCursorVal = data.next;
        
        if (newlyAdded > 0 && addedCount >= 8) {
          break;
        }
        if (!data.next || currentCursor === prevCursor || incoming.length === 0) {
          break;
        }
        attempts++;
      }

      const cacheKey = getCacheKey(mediaType, mode, query, provider);
      cacheRef.current.set(cacheKey, {
        results: accumulatedResults,
        next: nextCursorVal,
        error: null,
        scrollTop: scrollRef.current?.scrollTop || 0
      });
      setResults(accumulatedResults);
      setNextCursor(nextCursorVal);
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
          setError(`Could not load more ${providerLabel} ${mediaLabel}. Scroll again to retry.`);
        }
      }
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };

  const handleProviderChange = (nextProvider: GifProvider) => {
    setProvider(nextProvider);
    if (nextProvider === "tenor" && mediaType === "clips") {
      setMediaType("gifs");
    }
    setSuggestions([]);
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
              <div className="flex items-center gap-1.5 text-sm font-bold text-rm-text-primary">
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("gifs")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "gifs" ? "bg-rm-bg-active text-white" : "text-rm-text-muted/60 hover:text-rm-text hover:bg-white/5"
                  )}
                >
                  GIFs
                </button>
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("stickers")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "stickers" ? "bg-rm-bg-active text-white" : "text-rm-text-muted/60 hover:text-rm-text hover:bg-white/5"
                  )}
                >
                  Stickers
                </button>
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("clips")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "clips" ? "bg-rm-bg-active text-white" : "text-rm-text-muted/60 hover:text-rm-text hover:bg-white/5"
                  )}
                >
                  Clips
                </button>
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
                  onClick={handleBack}
                  className="rounded-lg p-2 text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h3 className="truncate text-sm font-black text-rm-text">Favorite {mediaLabel}</h3>
              </div>
            ) : (
              <div className="border-b border-rm-border px-4 py-3">
                <div className="flex gap-2 items-center">
                  {mode === "search" && (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="rounded-lg p-2 text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text shrink-0"
                      aria-label="Back"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                  )}
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                    <input
                      ref={searchInputRef}
                      value={searchValue}
                      onChange={(event) => setSearchValue(event.target.value)}
                      placeholder={getGifProviderSearchPlaceholder(provider)}
                      className="h-11 w-full rounded-xl border border-[#5865f2] bg-transparent pl-11 pr-4 text-[15px] font-medium text-rm-text outline-none ring-2 ring-[#5865f2]/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={openFavorites}
                    className="rounded-xl border border-rm-border bg-rm-bg-elevated p-3 text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-yellow-400 shrink-0"
                    aria-label="View Favorites"
                    title="View Favorites"
                  >
                    <Star className="h-5 w-5" />
                  </button>
                  {mediaType === "gifs" && (
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
                  )}
                </div>
                {suggestions.length > 0 && (
                  <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-rm-text-muted mr-1 select-none">
                      Suggestions:
                    </span>
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion}-${index}`}
                        type="button"
                        onClick={() => selectSuggestion(suggestion)}
                        className="shrink-0 rounded-full bg-rm-bg-hover hover:bg-rm-bg-active border border-rm-border px-3 py-1 text-xs font-semibold text-rm-text transition-all duration-150 active:scale-95"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
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
                    </button>
                  ))}
                </div>
              )}

              {mode === "categories" && categoriesLoading ? (
                <div className="py-8 text-center text-sm font-medium text-rm-text-muted">Loading {providerLabel} {mediaLabel} categories…</div>
              ) : null}

              {mode === "categories" && !categoriesLoading && categories.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-center text-sm font-medium text-rm-text-muted">
                  No {providerLabel} {mediaLabel} categories available right now.
                </div>
              ) : null}

              {error ? (
                <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100">
                  {error}
                </div>
              ) : null}

              {mode === "favorites" && results.length === 0 ? <FavoritesEmptyState mediaLabel={mediaLabel} /> : null}

              {mode !== "categories" && results.length > 0 ? (
                <div className={cn("flex items-start", expanded ? "gap-2 md:gap-3" : "gap-2")}>
                  {columnItems.map((col, colIdx) => (
                    <div key={colIdx} className={cn("flex flex-col flex-1 min-w-0", expanded ? "gap-2 md:gap-3" : "gap-2")}>
                      {col.map((gif) => (
                        <GifTile
                          key={getGifItemIdentityKey(gif)}
                          gif={gif}
                          isFavorite={favoriteIds.has(getGifItemIdentityKey(gif))}
                          favoriteCardBg={favoriteCardBg}
                          favoriteIconBase={favoriteIconBase}
                          onToggleFavorite={handleToggleFavorite}
                          onSelect={handleSelect}
                          isClip={mediaType === "clips" || (mode === "favorites" && (gif.duration !== undefined || gif.send.contentType === "video/mp4" || gif.send.url.includes(".mp4") || gif.send.url.includes("/clips/")))}
                          clipsMuted={clipsMuted}
                          onToggleClipsMuted={handleToggleClipsMuted}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : mode === "search" && !loading && !error ? (
                <div className="flex h-40 items-center justify-center text-center text-sm font-medium text-rm-text-muted">
                  {getNoResultsMessage()}
                </div>
              ) : null}

              {loading ? <GifLoadingSkeleton message={`Loading ${providerLabel} ${mediaLabel}…`} /> : null}

              {loadingMore || loadMoreCooldownUntil ? (
                <GifLoadingSkeleton
                  compact
                  message={
                    loadMoreCooldownUntil
                      ? `${providerLabel} is rate limiting us. Waiting before the next retry…`
                      : `Loading more ${providerLabel} ${mediaLabel}…`
                  }
                />
              ) : null}
            </div>

            {provider === "klipy" && (
              <div className="flex items-center justify-center border-t border-rm-border py-2 bg-black/15 select-none pointer-events-none shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted mr-1.5 opacity-70">
                  Powered by
                </span>
                <img src={klipyTextLightUrl} alt="KLIPY" className="h-3.5 w-auto opacity-70" />
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>
    </BaseModal>
  );
}

const ClipVideoPlayer = memo(function ClipVideoPlayer({
  asset,
  alt: _alt,
  clipsMuted,
  onToggleClipsMuted,
  onDurationLoaded,
}: {
  asset: GifPickerAsset;
  alt: string;
  clipsMuted: boolean;
  onToggleClipsMuted: () => void;
  onDurationLoaded?: (duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleClipsMuted();
  };

  const handleMouseEnter = () => {
    setHovered(true);
  };

  const handleMouseLeave = () => {
    setHovered(false);
  };

  const isMuted = !hovered || clipsMuted;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <video
        ref={videoRef}
        src={getMediaUrl(asset.url)}
        className="h-auto w-full object-cover"
        style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
        autoPlay
        loop
        muted={isMuted}
        playsInline
        preload="metadata"
        aria-hidden="true"
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          if (video && !isNaN(video.duration) && isFinite(video.duration) && onDurationLoaded) {
            onDurationLoaded(video.duration);
          }
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={toggleMute}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onToggleClipsMuted();
          }
        }}
        className={cn(
          "absolute bottom-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white transition-opacity duration-150 backdrop-blur-xs border border-white/10 hover:bg-black/80 hover:scale-105 active:scale-95 cursor-pointer",
          hovered ? "opacity-100" : "opacity-0"
        )}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </div>
    </div>
  );
});

const GifTile = memo(function GifTile({
  gif,
  isFavorite,
  favoriteCardBg,
  favoriteIconBase,
  onToggleFavorite,
  onSelect,
  isClip = false,
  clipsMuted,
  onToggleClipsMuted,
}: {
  gif: GifPickerItem;
  isFavorite: boolean;
  favoriteCardBg: string;
  favoriteIconBase: string;
  onToggleFavorite: (gif: GifPickerItem) => void;
  onSelect: (gif: GifPickerItem) => void;
  isClip?: boolean;
  clipsMuted: boolean;
  onToggleClipsMuted: () => void;
}) {
  const [prevGifId, setPrevGifId] = useState(() => getGifItemIdentityKey(gif));
  const [loadedDuration, setLoadedDuration] = useState<number | undefined>(undefined);

  if (prevGifId !== getGifItemIdentityKey(gif)) {
    setPrevGifId(getGifItemIdentityKey(gif));
    setLoadedDuration(undefined);
  }

  const duration = loadedDuration ?? gif.duration;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-rm-border bg-black/30">
      <button
        type="button"
        onClick={() => onSelect({ ...gif, duration })}
        className="block w-full overflow-hidden text-left"
        aria-label={`Send asset: ${gif.altText || gif.title}`}
      >
        {isClip ? (
          <ClipVideoPlayer
            asset={gif.send}
            alt={gif.altText || gif.title}
            clipsMuted={clipsMuted}
            onToggleClipsMuted={onToggleClipsMuted}
            onDurationLoaded={setLoadedDuration}
          />
        ) : (
          <GifPreviewMedia asset={gif.preview} alt={gif.altText || gif.title} />
        )}
      </button>

      {duration !== undefined && (
        <div className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs border border-white/5 select-none">
          {formatDuration(duration)}
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/35 to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite({ ...gif, duration });
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

function FavoritesEmptyState({ mediaLabel = "GIFs" }: { mediaLabel?: string }) {
  const singleLabel = mediaLabel.toLowerCase().endsWith("s") ? mediaLabel.slice(0, -1) : mediaLabel;
  return (
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1" aria-live="polite">
      <div className="relative flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <Star className="absolute right-4 top-3 h-7 w-7 fill-amber-400 text-amber-400" aria-hidden="true" />
        <p>Click the star in the corner of a {singleLabel.toLowerCase()} to favorite it</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <p>Favorites will show up here!</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-md bg-black/35 px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text">
        <p>So uhh... maybe go favorite some {mediaLabel}?</p>
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

function formatDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function GifLoadingSkeleton({ compact = false, message }: { compact?: boolean; message: string }) {
  return (
    <div className="py-4 flex flex-col items-center justify-center" aria-live="polite" aria-busy="true">
      <div className="text-center text-xs font-semibold uppercase tracking-wide text-rm-text-muted/80 flex items-center justify-center gap-2">
        {compact && (
          <svg className="animate-spin h-3.5 w-3.5 text-rm-text-muted/80" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {message}
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-2 w-full mt-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "animate-pulse rounded-xl border border-white/5 bg-white/[0.08]",
                index % 3 === 0 ? "h-28" : index % 3 === 1 ? "h-20" : "h-24"
              )}
            />
          ))}
        </div>
      )}
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
