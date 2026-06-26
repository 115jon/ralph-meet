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
import { getVoiceRenderableGifAsset } from "@/lib/voice-channel-status";
import { consumeStickerToken } from "@/lib/voice/sticker-rate-limiter";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { useGifFavoriteActions, useGifFavoritesStore } from "@/stores/useGifFavoritesStore";
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, Search, Star, X, Volume2, VolumeX } from "lucide-react";
import { useTheme } from "next-themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Voice reaction display modes
// ---------------------------------------------------------------------------
const VOICE_DISPLAY_MODES = ["single", "burst", "rain", "bounce"] as const;
type VoiceDisplayMode = (typeof VOICE_DISPLAY_MODES)[number];
const VOICE_DISPLAY_MODE_LABELS: Record<VoiceDisplayMode, string> = {
  single: "Single",
  burst: "Burst 💥",
  rain: "Rain 🌧️",
  bounce: "Bounce 🏀",
};
const VOICE_DISPLAY_MODE_KEY = "voice:sticker:displayMode";


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
  initialExpanded?: boolean;
  lockExpanded?: boolean;
  overlayZIndexClassName?: string;
  /** When set, the picker acts as a voice reaction sender instead of chat inserter.
   *  Clicking an item sends via SFU and keeps the picker open. */
  voiceMode?: { sfu: SFUClient };
  markerRef?: React.RefObject<HTMLElement | null>;
  isClosing?: boolean;
}

export default function GifPickerModal({
  onClose,
  onSelect,
  apiQuery = "",
  defaultProvider = DEFAULT_GIF_PROVIDER,
  providers,
  skipAuth = false,
  initialExpanded = false,
  lockExpanded = false,
  overlayZIndexClassName = "z-[250]",
  voiceMode,
  markerRef,
  isClosing = false,
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
  const [expanded, setExpanded] = useState(initialExpanded);
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const [clipsMuted, setClipsMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("chat:clips:muted") !== "false";
  });

  // Voice reaction: display mode (persisted)
  const [voiceDisplayMode, setVoiceDisplayMode] = useState<VoiceDisplayMode>(() => {
    if (typeof window === "undefined") return "single";
    const s = window.localStorage.getItem(VOICE_DISPLAY_MODE_KEY);
    return (VOICE_DISPLAY_MODES as readonly string[]).includes(s ?? "") ? (s as VoiceDisplayMode) : "single";
  });
  const [voiceRateLimited, setVoiceRateLimited] = useState(false);

  const persistVoiceDisplayMode = useCallback((mode: VoiceDisplayMode) => {
    setVoiceDisplayMode(mode);
    window.localStorage.setItem(VOICE_DISPLAY_MODE_KEY, mode);
  }, []);


  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const getRecentQueriesKey = useCallback((mType: "gifs" | "stickers" | "clips") => {
    return `chat:gifs:recent:${mType}`;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    const stored = window.localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentQueries(parsed.filter((q) => typeof q === "string" && q.trim() !== ""));
          return;
        }
      } catch (e) {
        console.error("Failed to parse recent queries:", e);
      }
    }
    setRecentQueries([]);
  }, [mediaType, getRecentQueriesKey]);

  const saveQueryToHistory = useCallback((q: string) => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    setRecentQueries((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== q.toLowerCase());
      const next = [q, ...filtered].slice(0, 5);
      window.localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [mediaType, getRecentQueriesKey]);

  const clearRecentQueries = useCallback(() => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    window.localStorage.removeItem(key);
    setRecentQueries([]);
  }, [mediaType, getRecentQueriesKey]);

  const removeRecentQuery = useCallback((qToRemove: string) => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    setRecentQueries((prev) => {
      const next = prev.filter((q) => q !== qToRemove);
      window.localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [mediaType, getRecentQueriesKey]);

  // Debounce saving search history to avoid intermediate queries while typing
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || mode !== "search" || results.length === 0) return;

    const timeout = setTimeout(() => {
      saveQueryToHistory(trimmed);
    }, 1500); // 1.5 seconds debounce for saving

    return () => clearTimeout(timeout);
  }, [query, mode, results, saveQueryToHistory]);

  const isExpanded = lockExpanded || expanded;
  const numCols = useColumnsCount(isExpanded);
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
          const matchingHistory = recentQueries.filter((q) =>
            q.toLowerCase().includes(trimmed.toLowerCase()) && q.toLowerCase() !== trimmed.toLowerCase()
          );
          const combined = Array.from(new Set([...matchingHistory, ...data.results])).slice(0, 6);
          setSuggestions(combined);
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
  }, [searchValue, provider, skipAuth, apiQuerySuffix, recentQueries]);

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
  }, [apiQuerySuffix, filteredFavorites, mode, provider, providerLabel, query, skipAuth, mediaType, getCacheKey, saveQueryToHistory]);

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
    if (voiceMode) {
      // Voice reaction mode: send via SFU, do NOT close the picker
      const asset = getVoiceRenderableGifAsset(gif);
      if (!consumeStickerToken()) {
        setVoiceRateLimited(true);
        window.setTimeout(() => setVoiceRateLimited(false), 2500);
        return;
      }
      voiceMode.sfu.voiceGW.sendAppEvent({
        type: "reaction.sticker",
        url: asset.url,
        // Carry content type so the overlay can render <video> vs <img> correctly
        contentType: asset.contentType || "image/gif",
        displayMode: voiceDisplayMode,
      });
      return;
    }
    // Normal chat mode
    if (query.trim()) {
      saveQueryToHistory(query.trim());
    }
    onClose();
    void onSelect(gif);
  }, [voiceMode, voiceDisplayMode, onClose, onSelect, query, saveQueryToHistory]);


  const selectSuggestion = (suggestion: string) => {
    setSearchValue(suggestion);
    setQuery(suggestion);
    setMode("search");
    saveQueryToHistory(suggestion);
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

  const favoriteCardBg = "bg-rm-bg-floating/90 border border-rm-border text-rm-text";
  const favoriteIconBase = "text-rm-text-muted";
  
  useEffect(() => {
    if (expanded) return;
    let frameId: number;
    const updatePosition = () => {
      if (!markerRef?.current) {
        setDynamicStyle({ opacity: 1 });
        return;
      }
      
      if (window.innerWidth < 640) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = 420;
      
      const MAX_HEIGHT = Math.min(620, window.innerHeight - 20);

      const style: React.CSSProperties = { 
        opacity: 1,
        maxHeight: MAX_HEIGHT,
        height: "68vh" // use default height but clamped by maxHeight
      };

      let left = rect.left;
      if (left + pickerWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - pickerWidth - 10);
      }
      if (left < 10) left = 10;
      style.left = left;

      // Prefer top placement if there's room, otherwise bottom
      style.bottom = window.innerHeight - rect.top + 8;
      style.maxHeight = Math.min(MAX_HEIGHT, Math.max(100, rect.top - 16));

      setDynamicStyle(style);
    };

    frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [expanded, markerRef]);

  const panelLayout = expanded
    ? "left-1/2 top-1/2 h-[min(82vh,780px)] w-[min(900px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
    : markerRef ? "w-full sm:w-[min(440px,calc(100vw-24px))]" : "bottom-[calc(88px+var(--safe-area-bottom,0px))] right-4 h-[min(68vh,620px)] w-[min(420px,calc(100vw-2rem))] max-sm:inset-x-2 max-sm:bottom-[calc(76px+var(--safe-area-bottom,0px))] max-sm:h-[min(72vh,560px)] max-sm:w-auto";

  return (
    <BaseModal onClose={onClose}>
      <TooltipProvider>
        <div
          className={cn("fixed inset-0", overlayZIndexClassName, expanded ? "bg-black/55 backdrop-blur-sm" : "bg-transparent")}
          onMouseDown={onClose}
        >
          <div
            className={cn(
              "picker-panel absolute flex flex-col overflow-hidden rounded-[26px] border backdrop-blur-2xl shadow-2xl transition-all duration-150 ease-out",
              !isClosing ? "animate-in fade-in zoom-in-95 opacity-100" : "opacity-0 scale-95 max-sm:translate-y-8",
              markerRef && !expanded ? "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-[85dvh] max-sm:w-full max-sm:rounded-t-[26px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:translate-y-0 max-sm:slide-in-from-bottom max-sm:zoom-in-100" : "",
              panelLayout
            )}
            style={markerRef && !expanded ? dynamicStyle : undefined}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="picker-header flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-1.5 text-sm font-bold text-rm-text">
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("gifs")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "gifs" ? "bg-rm-bg-active text-rm-text shadow-sm dark:shadow-none" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                  )}
                >
                  GIFs
                </button>
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("stickers")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "stickers" ? "bg-rm-bg-active text-rm-text shadow-sm dark:shadow-none" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                  )}
                >
                  Stickers
                </button>
                <button
                  type="button"
                  onClick={() => handleMediaTypeChange("clips")}
                  className={cn(
                    "rounded-xl px-3.5 py-2 transition-all duration-150 active:scale-95",
                    mediaType === "clips" ? "bg-rm-bg-active text-rm-text shadow-sm dark:shadow-none" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                  )}
                >
                  Clips
                </button>
              </div>
              <div className="flex items-center gap-1">
                {!voiceMode && !lockExpanded && (
                  <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="rounded-lg p-2 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition"
                    aria-label={expanded ? "Shrink GIF picker" : "Expand GIF picker"}
                    title={expanded ? "Shrink" : "Expand"}
                  >
                    {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-rm-text-muted hover:bg-red-500/10 hover:text-red-500 transition"
                  aria-label="Close GIF picker"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Voice reaction mode: display mode selector + rate limit banner */}
            {voiceMode && (
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-rm-border bg-rm-bg-surface/30 overflow-x-auto scrollbar-none shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-rm-text-secondary shrink-0 mr-1">React Mode</span>
                {VOICE_DISPLAY_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => persistVoiceDisplayMode(mode)}
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all duration-150 active:scale-95",
                      voiceDisplayMode === mode
                        ? "bg-primary text-white shadow-sm shadow-primary/40"
                        : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                    )}
                  >
                    {VOICE_DISPLAY_MODE_LABELS[mode]}
                  </button>
                ))}
                {voiceRateLimited && (
                  <span className="ml-auto shrink-0 text-[11px] font-semibold text-amber-500 dark:text-amber-400">Slow down! ⚠️</span>
                )}
              </div>
            )}


            {mode === "favorites" ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-transparent">
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
              <div className="border-b border-rm-border bg-transparent px-4 py-3">
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
                      className="picker-search-input h-11 w-full rounded-xl border pl-11 pr-4 text-[15px] font-medium outline-none transition placeholder:text-rm-text-muted"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={openFavorites}
                    className="rounded-xl border border-rm-border bg-rm-bg-elevated p-3 text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-amber-500 dark:hover:text-yellow-400 shrink-0 shadow-sm dark:shadow-none"
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
                            className="picker-pill h-11 appearance-none rounded-xl border pl-3 pr-9 text-sm font-semibold outline-none transition shadow-sm dark:shadow-none"
                          >
                            {providerOptions.map((option) => (
                              <option key={option} value={option} className="bg-rm-bg-elevated text-rm-text">{getGifProviderLabel(option)}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                        </>
                      ) : (
                        <div className="flex h-11 items-center rounded-xl border border-rm-border bg-rm-bg-elevated px-3 text-sm font-semibold text-rm-text shadow-sm dark:shadow-none">
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
                        className="picker-pill shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-150 active:scale-95 shadow-sm dark:shadow-none"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={scrollRef} onScroll={() => void handleScroll()} className="custom-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {mode === "categories" && searchValue.trim() === "" && recentQueries.length > 0 && (
                <div className="mb-4 rounded-xl border border-rm-border bg-rm-bg-elevated p-3 shadow-sm dark:shadow-none">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-rm-text-muted">
                      Recent Searches
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearRecentQueries();
                      }}
                      className="text-xs font-semibold text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentQueries.map((q) => (
                      <div
                        key={q}
                        className="picker-pill inline-flex items-center gap-1.5 rounded-full border pl-3 pr-2 py-1 text-xs font-semibold transition shadow-sm dark:shadow-none"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSearchValue(q);
                            setQuery(q);
                            setMode("search");
                            saveQueryToHistory(q);
                          }}
                          className="text-left hover:underline text-rm-text"
                          style={{ color: "var(--rm-text-primary)" }}
                        >
                          {q}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecentQuery(q);
                          }}
                          className="rounded-full p-0.5 hover:bg-rm-bg-active text-rm-text-muted hover:text-rm-text transition"
                          aria-label={`Remove ${q} from history`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mode === "categories" && (
                <div className={cn("mb-4 grid grid-cols-2 gap-2", expanded && "md:grid-cols-3")}>
                  <button
                    type="button"
                    onClick={openFavorites}
                    className="group relative h-24 overflow-hidden rounded-xl border border-rm-border bg-primary shadow-sm dark:shadow-none"
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_45%)]" />
                    <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-white">Favorites</div>
                  </button>
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => handleCategorySearch(category)}
                      className="group relative h-24 overflow-hidden rounded-xl border border-rm-border shadow-sm dark:shadow-none"
                    >
                      <img src={category.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/45 dark:bg-black/60" />
                      <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-lg font-black capitalize text-white drop-shadow-md">{category.label}</div>
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
                <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-800 dark:text-red-200">
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
              <div className="flex items-center justify-center border-t border-rm-border py-2 bg-rm-bg-surface/30 select-none pointer-events-none shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rm-text-muted mr-1.5 opacity-70">
                  Powered by
                </span>
                <img src={klipyTextLightUrl} alt="KLIPY" className="h-3.5 w-auto opacity-70 dark:opacity-70 invert dark:invert-0" />
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
    <div className="group relative overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface shadow-sm dark:shadow-none">
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
                isFavorite ? "fill-amber-500 text-amber-500 dark:fill-yellow-400 dark:text-yellow-400 scale-110" : `${favoriteIconBase} fill-transparent group-hover:text-amber-500 dark:group-hover:text-yellow-400`
              )}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8} className="bg-rm-bg-floating text-rm-text border border-rm-border shadow-xl text-xs font-semibold px-3 py-1.5">
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
      <div className="relative flex min-h-40 items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text shadow-sm dark:shadow-none">
        <Star className="absolute right-4 top-3 h-7 w-7 fill-amber-400 text-amber-400" aria-hidden="true" />
        <p>Click the star in the corner of a {singleLabel.toLowerCase()} to favorite it</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text shadow-sm dark:shadow-none">
        <p>Favorites will show up here!</p>
      </div>
      <div className="flex min-h-40 items-center justify-center rounded-xl bg-rm-bg-surface border border-rm-border px-5 py-6 text-center text-[15px] font-medium leading-7 text-rm-text shadow-sm dark:shadow-none">
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
      <div className="text-center text-xs font-semibold uppercase tracking-wide text-rm-text-muted flex items-center justify-center gap-2">
        {compact && (
          <svg className="animate-spin h-3.5 w-3.5 text-rm-text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                "animate-pulse rounded-xl border border-rm-border bg-rm-bg-surface shadow-sm dark:shadow-none",
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
