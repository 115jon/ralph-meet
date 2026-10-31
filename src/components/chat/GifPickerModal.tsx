import {
  readList,
  readNonBlankString,
  readStoredJson,
} from "@/lib/persisted-guard";
import { isMobileViewport } from "@/hooks/useMediaQuery";
import { useAppActive } from "@/hooks/useAppActive";
import { PickerSurface } from "./PickerSurface";
import {
  PICKER_RING,
  PICKER_WIDTH,
  PICKER_WIDTH_CLASS,
  handlePickerGridKeyDown,
} from "./picker-grid";
import { PickerHeader, PickerSearch, PickerSectionLabel } from "./PickerHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  inferGifPickerMediaType,
  parseStoredGifFavorites,
  toggleGifFavorite,
  type GifPickerAsset,
  type GifPickerCategory,
  type GifPickerItem,
  type GifPickerMediaType,
  type GifProvider,
} from "@/lib/gif-picker";
import { getVoiceRenderableGifAsset } from "@/lib/voice-channel-status";
import { consumeStickerToken } from "@/lib/voice/sticker-rate-limiter";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import {
  useGifFavoriteActions,
  useGifFavoritesStore,
} from "@/stores/useGifFavoritesStore";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { useUser } from "@kova/react";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import {
  MENU_HINT,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
  MENU_PANEL,
} from "@/components/ui/menu";
import { Tabs, type TabItem } from "@/components/ui/tabs";
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
const KLIPY_ONLY_MEDIA_TYPES: readonly GifPickerMediaType[] = [
  "stickers",
  "clips",
  "memes",
];
type GifPickerMode = "categories" | "featured" | "search" | "favorites";

const MEDIA_TABS: readonly TabItem<GifPickerMediaType>[] = [
  { value: "gifs", label: "GIFs" },
  { value: "stickers", label: "Stickers" },
  { value: "clips", label: "Clips" },
  { value: "memes", label: "Memes" },
];

function useColumnsCount(expanded: boolean) {
  const [cols, setCols] = useState(2);

  useEffect(() => {
    if (!expanded) {
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

  return expanded ? cols : 2;
}

interface GifPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gif: GifPickerItem) => Promise<void>;
  apiQuery?: string;
  defaultProvider?: GifProvider;
  defaultMediaType?: GifPickerMediaType;
  providers?: GifProvider[];
  skipAuth?: boolean;
  initialExpanded?: boolean;
  lockExpanded?: boolean;
  /** Opened from a dialog: the stacked layer (z-60) instead of z-50. */
  stacked?: boolean;
  /** When set, the picker acts as a voice reaction sender instead of chat inserter.
   *  Clicking an item sends via SFU and keeps the picker open. */
  voiceMode?: { sfu: SFUClient };
  markerRef?: React.RefObject<HTMLElement | null>;
}

export default function GifPickerModal({
  open,
  onClose,
  onSelect,
  apiQuery = "",
  defaultProvider = DEFAULT_GIF_PROVIDER,
  defaultMediaType = "gifs",
  providers,
  skipAuth = false,
  initialExpanded = false,
  lockExpanded = false,
  stacked = false,
  voiceMode,
  markerRef,
}: GifPickerModalProps) {
  const { user } = useUser();
  const providerOptions = providers?.length
    ? providers
    : DEFAULT_PROVIDER_OPTIONS;
  const preferredProvider =
    KLIPY_ONLY_MEDIA_TYPES.includes(defaultMediaType) &&
    providerOptions.includes("klipy")
      ? "klipy"
      : defaultProvider;
  const initialProvider = providerOptions.includes(preferredProvider)
    ? preferredProvider
    : providerOptions[0];
  const externalApiQuerySuffix = apiQuery
    ? `&${apiQuery.replace(/^[?&]+/, "")}`
    : "";
  const [mode, setMode] = useState<GifPickerMode>("categories");
  const browseModeRef = useRef<"categories" | "featured">("categories");
  const [provider, setProvider] = useState<GifProvider>(initialProvider);
  const [mediaType, setMediaType] =
    useState<GifPickerMediaType>(defaultMediaType);
  const [query, setQuery] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [_isSuggesting, setIsSuggesting] = useState(false);
  const [isSuggestionListOpen, setIsSuggestionListOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [categories, setCategories] = useState<GifPickerCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [results, setResults] = useState<GifPickerItem[]>([]);
  const [featuredPreview, setFeaturedPreview] = useState<GifPickerItem | null>(
    null,
  );
  const [localFavorites, setLocalFavorites] = useState<GifPickerItem[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreCooldownUntil, setLoadMoreCooldownUntil] = useState<
    number | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });
  const [clipsMuted, setClipsMuted] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("chat:clips:muted") !== "false";
  });

  // Voice reaction: display mode (persisted)
  const [voiceDisplayMode, setVoiceDisplayMode] = useState<VoiceDisplayMode>(
    () => {
      if (typeof window === "undefined") return "single";
      const s = window.localStorage.getItem(VOICE_DISPLAY_MODE_KEY);
      return (VOICE_DISPLAY_MODES as readonly string[]).includes(s ?? "")
        ? (s as VoiceDisplayMode)
        : "single";
    },
  );
  const [voiceRateLimited, setVoiceRateLimited] = useState(false);
  const settingsUserId = user?.id ?? null;
  const mediaSafetySettings = useMediaSafetySettingsStore((state) =>
    state.getSettings(settingsUserId),
  );
  const setMediaSafetyCurrentUser = useMediaSafetySettingsStore(
    (state) => state.setCurrentUser,
  );
  const mediaRequestQuerySuffix = useMemo(() => {
    const queryParams = new URLSearchParams({
      contentFilter: mediaSafetySettings.contentFilter,
    });
    if (settingsUserId) {
      queryParams.set("customerId", settingsUserId);
    }
    return `&${queryParams.toString()}`;
  }, [mediaSafetySettings.contentFilter, settingsUserId]);
  const requestApiQuerySuffix = `${mediaRequestQuerySuffix}${externalApiQuerySuffix}`;
  const requestContextKey = `${mediaSafetySettings.contentFilter}:${settingsUserId ?? "guest"}`;

  const persistVoiceDisplayMode = useCallback((mode: VoiceDisplayMode) => {
    setVoiceDisplayMode(mode);
    window.localStorage.setItem(VOICE_DISPLAY_MODE_KEY, mode);
  }, []);

  useEffect(() => {
    if (settingsUserId) {
      setMediaSafetyCurrentUser(settingsUserId);
    }
  }, [settingsUserId, setMediaSafetyCurrentUser]);

  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const lastSyncedDefaultMediaTypeRef = useRef(defaultMediaType);

  const getRecentQueriesKey = useCallback((mType: GifPickerMediaType) => {
    return `chat:gifs:recent:${mType}`;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    setRecentQueries(
      readStoredJson(
        window.localStorage.getItem(key),
        readList(readNonBlankString),
      ) ?? [],
    );
  }, [mediaType, getRecentQueriesKey]);

  const saveQueryToHistory = useCallback(
    (q: string) => {
      if (typeof window === "undefined") return;
      const key = getRecentQueriesKey(mediaType);
      setRecentQueries((prev) => {
        const filtered = prev.filter(
          (item) => item.toLowerCase() !== q.toLowerCase(),
        );
        const next = [q, ...filtered].slice(0, 5);
        window.localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    [mediaType, getRecentQueriesKey],
  );

  const clearRecentQueries = useCallback(() => {
    if (typeof window === "undefined") return;
    const key = getRecentQueriesKey(mediaType);
    window.localStorage.removeItem(key);
    setRecentQueries([]);
  }, [mediaType, getRecentQueriesKey]);

  const removeRecentQuery = useCallback(
    (qToRemove: string) => {
      if (typeof window === "undefined") return;
      const key = getRecentQueriesKey(mediaType);
      setRecentQueries((prev) => {
        const next = prev.filter((q) => q !== qToRemove);
        window.localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    [mediaType, getRecentQueriesKey],
  );

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
  const searchFieldRef = useRef<HTMLDivElement>(null);
  const skipSuggestionOpenRef = useRef(false);
  const allowSearchFocusRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const loadMoreBlockedUntilRef = useRef(0);
  const [cache] = useState(
    () =>
      new Map<
        string,
        {
          results: GifPickerItem[];
          next: string | null;
          error: string | null;
          scrollTop?: number;
        }
      >(),
  );
  const [categoriesCache] = useState(
    () => new Map<string, GifPickerCategory[]>(),
  );
  const [featuredPreviewCache] = useState(
    () => new Map<string, GifPickerItem | null>(),
  );

  const dbFavorites = useGifFavoritesStore((state) => state.favorites);
  const { load: loadDbFavorites, toggle: toggleDbFavorite } =
    useGifFavoriteActions();
  const favorites = skipAuth ? localFavorites : dbFavorites;

  const filteredFavorites = useMemo(() => {
    return favorites.filter((gif) => {
      const itemMediaType = inferGifPickerMediaType(gif);
      return itemMediaType === mediaType;
    });
  }, [favorites, mediaType]);
  const latestFavoritePreview = filteredFavorites[0] ?? null;
  const featuredPreviewCacheKey = useMemo(
    () =>
      `${provider}:${mediaType}:${requestContextKey}:${skipAuth ? "guest" : "auth"}:${requestApiQuerySuffix}`,
    [provider, mediaType, requestContextKey, requestApiQuerySuffix, skipAuth],
  );

  const getCacheKey = useCallback(
    (
      mType: GifPickerMediaType,
      mMode: GifPickerMode,
      q: string,
      prov: GifProvider,
      contextKey: string,
    ) => {
      return `${mType}:${mMode}:${q}:${prov}:${contextKey}`;
    },
    [],
  );
  const cachedFeaturedPreview =
    cache.get(
      getCacheKey(mediaType, "featured", "", provider, requestContextKey),
    )?.results[0] ?? null;
  const featuredCardPreview = cachedFeaturedPreview ?? featuredPreview;

  const handleMediaTypeChange = useCallback(
    (nextMediaType: GifPickerMediaType) => {
      const currentCacheKey = getCacheKey(
        mediaType,
        mode,
        query,
        provider,
        requestContextKey,
      );
      if (scrollRef.current) {
        const cached = cache.get(currentCacheKey);
        if (cached) {
          cached.scrollTop = scrollRef.current.scrollTop;
        }
      }

      const nextProvider = KLIPY_ONLY_MEDIA_TYPES.includes(nextMediaType)
        ? "klipy"
        : provider;

      let nextMode = mode;
      if (mode !== "favorites") {
        nextMode = searchValue.trim() ? "search" : browseModeRef.current;
      }
      const nextQuery = nextMode === "categories" ? "" : query;

      setMediaType(nextMediaType);
      setIsSuggestionListOpen(false);
      setActiveSuggestionIndex(-1);
      if (KLIPY_ONLY_MEDIA_TYPES.includes(nextMediaType)) {
        setProvider("klipy");
      }
      setMode(nextMode);

      if (nextMode === "favorites") {
        const nextFilteredFavorites = favorites.filter((gif) => {
          const itemMediaType = inferGifPickerMediaType(gif);
          return itemMediaType === nextMediaType;
        });
        setResults(nextFilteredFavorites);
        nextCursorRef.current = null;
        setError(null);
        setLoading(false);
      } else {
        const nextCacheKey = getCacheKey(
          nextMediaType,
          nextMode,
          nextQuery,
          nextProvider,
          requestContextKey,
        );
        const cached = cache.get(nextCacheKey);
        if (cached) {
          setResults(cached.results);
          nextCursorRef.current = cached.next;
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
          nextCursorRef.current = null;
          setError(null);
        }
      }
    },
    [
      cache,
      mediaType,
      mode,
      query,
      provider,
      requestContextKey,
      searchValue,
      getCacheKey,
      favorites,
    ],
  );

  useEffect(() => {
    if (lastSyncedDefaultMediaTypeRef.current === defaultMediaType) return;
    lastSyncedDefaultMediaTypeRef.current = defaultMediaType;
    if (defaultMediaType === mediaType) return;
    handleMediaTypeChange(defaultMediaType);
  }, [defaultMediaType, handleMediaTypeChange, mediaType]);

  const providerLabel = getGifProviderLabel(provider);

  const mediaLabel = useMemo(() => {
    if (mediaType === "clips") return "clips";
    if (mediaType === "memes") return "memes";
    if (mediaType === "stickers") return "stickers";
    return "GIFs";
  }, [mediaType]);

  const getNoResultsMessage = () => {
    if (mode === "featured") {
      return `No featured ${mediaLabel} found right now.`;
    }
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
    setLocalFavorites(
      parseStoredGifFavorites(
        window.localStorage.getItem(GIF_FAVORITES_STORAGE_KEY),
      ),
    );
  }, [skipAuth]);

  useEffect(() => {
    if (!skipAuth) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      GIF_FAVORITES_STORAGE_KEY,
      JSON.stringify(favorites),
    );
  }, [favorites, skipAuth]);

  useEffect(() => {
    if (!open || skipAuth) return;
    void loadDbFavorites();
  }, [loadDbFavorites, open, skipAuth]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    if (cachedFeaturedPreview) {
      setFeaturedPreview(cachedFeaturedPreview);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (featuredPreviewCache.has(featuredPreviewCacheKey)) {
      setFeaturedPreview(
        featuredPreviewCache.get(featuredPreviewCacheKey) ?? null,
      );
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setFeaturedPreview(null);

    const run = async () => {
      try {
        const queryParams = new URLSearchParams({
          mode: "search",
          provider,
          limit: "1",
          mediaType,
        });
        if (skipAuth) {
          queryParams.set("skipAuth", "true");
        }

        const endpoint = `/api/gifs?${queryParams.toString()}${requestApiQuerySuffix}`;
        const data = await apiGet<GifPickerResponse>(endpoint, {
          signal: controller.signal,
          skipAuth,
        });

        if (!cancelled) {
          const previewItem =
            dedupeGifPickerItems(
              data.results.map((item) => ({ ...item, query: "" })),
            )[0] ?? null;
          featuredPreviewCache.set(featuredPreviewCacheKey, previewItem);
          setFeaturedPreview(previewItem);
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          featuredPreviewCache.set(featuredPreviewCacheKey, null);
          setFeaturedPreview(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    cachedFeaturedPreview,
    featuredPreviewCache,
    featuredPreviewCacheKey,
    mediaType,
    provider,
    requestApiQuerySuffix,
    skipAuth,
    open,
  ]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    const cacheKey = `${provider}:${mediaType}`;
    const cached = categoriesCache.get(cacheKey);
    if (cached) {
      setCategories(cached);
      setCategoriesLoading(false);
      return;
    }

    const run = async () => {
      setCategoriesLoading(true);
      try {
        const data = await apiGet<GifCategoryResponse>(
          `/api/gifs?mode=categories&provider=${provider}&mediaType=${mediaType}${requestApiQuerySuffix}`,
          {
            signal: controller.signal,
            skipAuth,
          },
        );
        if (!cancelled) {
          categoriesCache.set(cacheKey, data.categories);
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
  }, [
    provider,
    mediaType,
    requestApiQuerySuffix,
    skipAuth,
    categoriesCache,
    open,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      setQuery(nextQuery);
      setMode((current) => {
        if (current === "favorites") return current;
        return nextQuery ? "search" : browseModeRef.current;
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    if (!open) return undefined;

    const trimmed = searchValue.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsSuggestionListOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const timeout = window.setTimeout(async () => {
      setIsSuggesting(true);
      try {
        const buildSuggestionEndpoint = (
          mode: "autocomplete" | "suggestions",
        ) => {
          const queryParams = new URLSearchParams({
            mode,
            q: trimmed,
            provider,
          });
          if (skipAuth) {
            queryParams.set("skipAuth", "true");
          }
          return `/api/gifs?${queryParams.toString()}${requestApiQuerySuffix}`;
        };
        const [autocompleteResult, suggestionResult] = await Promise.allSettled(
          [
            apiGet<{ results: string[] }>(
              buildSuggestionEndpoint("autocomplete"),
              {
                signal: controller.signal,
                skipAuth,
              },
            ),
            apiGet<{ results: string[] }>(
              buildSuggestionEndpoint("suggestions"),
              {
                signal: controller.signal,
                skipAuth,
              },
            ),
          ],
        );

        if (!cancelled) {
          const autocompleteSuggestions =
            autocompleteResult.status === "fulfilled" &&
            Array.isArray(autocompleteResult.value?.results)
              ? autocompleteResult.value.results
              : [];
          const providerSuggestions =
            suggestionResult.status === "fulfilled" &&
            Array.isArray(suggestionResult.value?.results)
              ? suggestionResult.value.results
              : [];
          const matchingHistory = recentQueries.filter(
            (q) =>
              q.toLowerCase().includes(trimmed.toLowerCase()) &&
              q.toLowerCase() !== trimmed.toLowerCase(),
          );
          const combined = Array.from(
            new Set([
              ...matchingHistory,
              ...autocompleteSuggestions,
              ...providerSuggestions,
            ]),
          ).slice(0, 8);
          setSuggestions(combined);
          setActiveSuggestionIndex(-1);
          setIsSuggestionListOpen(
            combined.length > 0 &&
              !skipSuggestionOpenRef.current &&
              document.activeElement === searchInputRef.current,
          );
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
  }, [
    searchValue,
    provider,
    skipAuth,
    requestApiQuerySuffix,
    recentQueries,
    open,
  ]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setActiveSuggestionIndex(-1);
      return;
    }
    if (activeSuggestionIndex >= suggestions.length) {
      setActiveSuggestionIndex(suggestions.length - 1);
    }
  }, [activeSuggestionIndex, suggestions]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    if (mode === "favorites") {
      setResults(filteredFavorites);
      nextCursorRef.current = null;
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
      nextCursorRef.current = null;
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

    if (mode !== "featured" && !query) {
      setResults([]);
      nextCursorRef.current = null;
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

    const cacheKey = getCacheKey(
      mediaType,
      mode,
      query,
      provider,
      requestContextKey,
    );
    const cached = cache.get(cacheKey);
    if (cached) {
      if (!cancelled) {
        setResults(cached.results);
        nextCursorRef.current = cached.next;
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
        const endpoint = `/api/gifs?${queryParams.toString()}${requestApiQuerySuffix}`;
        const data = await apiGet<GifPickerResponse>(endpoint, {
          signal: controller.signal,
          skipAuth,
        });
        if (!cancelled) {
          const newResults = dedupeGifPickerItems(
            data.results.map((item) => ({ ...item, query })),
          );
          cache.set(cacheKey, {
            results: newResults,
            next: data.next,
            error: null,
            scrollTop: 0,
          });
          setResults(newResults);
          nextCursorRef.current = data.next;
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== "AbortError") {
          setResults([]);
          nextCursorRef.current = null;
          const errMsg = `Could not load ${providerLabel} assets right now. Try again in a moment.`;
          cache.set(cacheKey, {
            results: [],
            next: null,
            error: errMsg,
            scrollTop: 0,
          });
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
  }, [
    cache,
    filteredFavorites,
    mode,
    provider,
    providerLabel,
    query,
    requestApiQuerySuffix,
    requestContextKey,
    skipAuth,
    mediaType,
    getCacheKey,
    saveQueryToHistory,
    open,
  ]);

  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => getGifItemIdentityKey(item))),
    [favorites],
  );

  const handleToggleFavorite = useCallback(
    (gif: GifPickerItem) => {
      if (!skipAuth) {
        void toggleDbFavorite(gif);
        return;
      }

      setLocalFavorites((current) => {
        return toggleGifFavorite(current, gif);
      });
    },
    [skipAuth, toggleDbFavorite],
  );

  const handleSelect = useCallback(
    (gif: GifPickerItem) => {
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
    },
    [voiceMode, voiceDisplayMode, onClose, onSelect, query, saveQueryToHistory],
  );

  const suggestionsVisible =
    isSearchFocused &&
    isSuggestionListOpen &&
    suggestions.length > 0 &&
    searchValue.trim().length >= 2;

  const focusResultsPane = useCallback(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  const commitProgrammaticSearch = useCallback(
    (nextQuery: string) => {
      skipSuggestionOpenRef.current = true;
      allowSearchFocusRef.current = false;
      setMode("search");
      setQuery(nextQuery);
      setSearchValue(nextQuery);
      setIsSuggestionListOpen(false);
      setActiveSuggestionIndex(-1);
      setIsSearchFocused(false);
      window.requestAnimationFrame(() => {
        focusResultsPane();
        window.requestAnimationFrame(focusResultsPane);
      });
    },
    [focusResultsPane],
  );

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      skipSuggestionOpenRef.current = true;
      allowSearchFocusRef.current = true;
      setSearchValue(suggestion);
      setQuery(suggestion);
      setMode("search");
      saveQueryToHistory(suggestion);
      setIsSuggestionListOpen(false);
      setActiveSuggestionIndex(-1);
      searchInputRef.current?.focus();
    },
    [saveQueryToHistory],
  );

  const handleSearchInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!suggestionsVisible) {
        if (event.key === "Escape") {
          setIsSuggestionListOpen(false);
          setActiveSuggestionIndex(-1);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestionIndex((current) => {
          if (current < 0) return 0;
          return current >= suggestions.length - 1 ? 0 : current + 1;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestionIndex((current) => {
          if (current < 0) return suggestions.length - 1;
          return current <= 0 ? suggestions.length - 1 : current - 1;
        });
        return;
      }

      if (
        event.key === "Enter" &&
        activeSuggestionIndex >= 0 &&
        suggestions[activeSuggestionIndex]
      ) {
        event.preventDefault();
        selectSuggestion(suggestions[activeSuggestionIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setIsSuggestionListOpen(false);
        setActiveSuggestionIndex(-1);
      }
    },
    [activeSuggestionIndex, selectSuggestion, suggestions, suggestionsVisible],
  );

  useEffect(() => {
    if (!open) return undefined;

    const closeSuggestionsOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (searchFieldRef.current?.contains(target)) return;
      setIsSuggestionListOpen(false);
      setActiveSuggestionIndex(-1);
      if (document.activeElement === searchInputRef.current) {
        focusResultsPane();
      }
    };

    document.addEventListener("pointerdown", closeSuggestionsOnOutsidePointer);
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeSuggestionsOnOutsidePointer,
      );
  }, [focusResultsPane, open]);

  const handleCategorySearch = (category: GifPickerCategory) => {
    browseModeRef.current = "categories";
    commitProgrammaticSearch(category.query);
  };

  const openFavorites = () => {
    setMode("favorites");
    setQuery("");
    setSearchValue("");
    setIsSuggestionListOpen(false);
    setActiveSuggestionIndex(-1);
    setResults(filteredFavorites);
    nextCursorRef.current = null;
  };

  const openFeatured = useCallback(() => {
    browseModeRef.current = "featured";
    setMode("featured");
    setQuery("");
    setSearchValue("");
    setError(null);
    setIsSuggestionListOpen(false);
    setActiveSuggestionIndex(-1);
  }, []);

  const handleBack = useCallback(() => {
    browseModeRef.current = "categories";
    setQuery("");
    setSearchValue("");
    setResults([]);
    nextCursorRef.current = null;
    setError(null);
    setIsSuggestionListOpen(false);
    setActiveSuggestionIndex(-1);
    setMode("categories");
  }, []);

  const handleLoadMore = async () => {
    const initialCursor = nextCursorRef.current;
    if (
      (mode !== "search" && mode !== "featured") ||
      !initialCursor ||
      loadingMoreRef.current
    )
      return;
    if (Date.now() < loadMoreBlockedUntilRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    const loadNextPage = async (
      currentCursor: string,
      accumulatedResults: GifPickerItem[],
      attempts: number,
      addedCount: number,
    ): Promise<{
      accumulatedResults: GifPickerItem[];
      nextCursor: string | null;
    }> => {
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
      const endpoint = `/api/gifs?${queryParams.toString()}${requestApiQuerySuffix}`;
      const data = await apiGet<GifPickerResponse>(endpoint, { skipAuth });

      const incoming = data.results.map((item) => ({ ...item, query }));
      const currentLength = accumulatedResults.length;
      const nextAccumulatedResults = appendUniqueGifPickerItems(
        accumulatedResults,
        incoming,
      );
      const newlyAdded = nextAccumulatedResults.length - currentLength;
      const nextAddedCount = addedCount + newlyAdded;
      const nextCursor = data.next ?? null;

      if (newlyAdded > 0 && nextAddedCount >= 8) {
        return { accumulatedResults: nextAccumulatedResults, nextCursor };
      }
      if (
        !nextCursor ||
        nextCursor === currentCursor ||
        incoming.length === 0 ||
        attempts + 1 >= 3
      ) {
        return { accumulatedResults: nextAccumulatedResults, nextCursor };
      }

      return loadNextPage(
        nextCursor,
        nextAccumulatedResults,
        attempts + 1,
        nextAddedCount,
      );
    };

    try {
      const { accumulatedResults, nextCursor } = await loadNextPage(
        initialCursor,
        [...results],
        0,
        0,
      );
      const cacheKey = getCacheKey(
        mediaType,
        mode,
        query,
        provider,
        requestContextKey,
      );
      cache.set(cacheKey, {
        results: accumulatedResults,
        next: nextCursor,
        error: null,
        scrollTop: scrollRef.current?.scrollTop || 0,
      });
      setResults(accumulatedResults);
      nextCursorRef.current = nextCursor;
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
          setError(
            `Could not load more ${providerLabel} ${mediaLabel}. Scroll again to retry.`,
          );
        }
      }
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  };

  const handleProviderChange = (nextProvider: GifProvider) => {
    setProvider(nextProvider);
    if (
      nextProvider === "tenor" &&
      KLIPY_ONLY_MEDIA_TYPES.includes(mediaType)
    ) {
      setMediaType("gifs");
    }
    setSuggestions([]);
    setIsSuggestionListOpen(false);
    setActiveSuggestionIndex(-1);
    setError(null);
    nextCursorRef.current = null;
    setLoadMoreCooldownUntil(null);
    loadMoreBlockedUntilRef.current = 0;
  };

  useEffect(() => {
    if (!loadMoreCooldownUntil) return;
    const timeout = window.setTimeout(
      () => {
        loadMoreBlockedUntilRef.current = 0;
        setLoadMoreCooldownUntil(null);
      },
      Math.max(0, loadMoreCooldownUntil - Date.now()),
    );

    return () => window.clearTimeout(timeout);
  }, [loadMoreCooldownUntil]);

  const handleScroll = async () => {
    const el = scrollRef.current;
    if (!el || !nextCursorRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
      await handleLoadMore();
    }
  };

  useEffect(() => {
    if (expanded) return;
    const updatePosition = () => {
      if (!markerRef?.current) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      if (isMobileViewport()) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = PICKER_WIDTH;

      const MAX_HEIGHT = Math.min(600, window.innerHeight - 20);

      const style: React.CSSProperties = {
        opacity: 1,
        maxHeight: MAX_HEIGHT,
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

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [expanded, markerRef]);

  // Expanded is a centred workbench (modal, with the standard scrim), so it
  // may grow past the anchored-picker cap.
  const panelLayout = isExpanded
    ? "left-1/2 top-1/2 h-[min(780px,calc(100dvh-48px))] max-h-[min(780px,calc(100dvh-48px))] w-[min(900px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"
    : markerRef
      ? cn("h-[min(600px,calc(100dvh-24px))]", PICKER_WIDTH_CLASS)
      : "bottom-[calc(88px+var(--safe-area-bottom,0px))] right-4 h-[min(600px,calc(100dvh-112px))] w-[min(420px,calc(100vw-2rem))]";

  const searchRow =
    mode === "favorites" ? (
      <>
        <IconButton
          icon="back"
          size={32}
          onClick={handleBack}
          aria-label="Back"
        />
        <h3 className="min-w-0 flex-1 truncate text-ui-row font-semibold text-ink-1">
          Favorite {mediaLabel}
        </h3>
      </>
    ) : (
      <>
        {mode === "search" || mode === "featured" ? (
          <IconButton
            icon="back"
            size={32}
            onClick={handleBack}
            aria-label="Back"
          />
        ) : null}
        <div ref={searchFieldRef} className="relative min-w-0 flex-1">
          <PickerSearch
            ref={searchInputRef}
            value={searchValue}
            onChange={(event) => {
              skipSuggestionOpenRef.current = false;
              allowSearchFocusRef.current = true;
              setSearchValue(event.target.value);
            }}
            onPointerDown={() => {
              skipSuggestionOpenRef.current = false;
              allowSearchFocusRef.current = true;
            }}
            onFocus={() => {
              if (!allowSearchFocusRef.current) {
                focusResultsPane();
                return;
              }
              setIsSearchFocused(true);
              if (
                !skipSuggestionOpenRef.current &&
                suggestions.length > 0 &&
                searchValue.trim().length >= 2
              ) {
                setIsSuggestionListOpen(true);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (document.activeElement === searchInputRef.current) {
                  return;
                }
                setIsSearchFocused(false);
                setIsSuggestionListOpen(false);
                setActiveSuggestionIndex(-1);
              }, 0);
            }}
            onKeyDown={handleSearchInputKeyDown}
            placeholder={getGifProviderSearchPlaceholder(provider)}
            aria-autocomplete="list"
            aria-controls={
              suggestionsVisible ? "gif-picker-search-suggestions" : undefined
            }
            aria-label={`Search ${providerLabel} ${mediaLabel}`}
            aria-activedescendant={
              suggestionsVisible && activeSuggestionIndex >= 0
                ? `gif-picker-suggestion-${activeSuggestionIndex}`
                : undefined
            }
          />
          {suggestionsVisible && (
            <div
              id="gif-picker-search-suggestions"
              role="listbox"
              aria-label="Search suggestions"
              className={cn(
                MENU_PANEL,
                "absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20",
              )}
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion}-${index}`}
                  id={`gif-picker-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSuggestion(suggestion);
                  }}
                  className={cn(
                    MENU_ITEM,
                    "justify-between",
                    activeSuggestionIndex === index
                      ? MENU_ITEM_DEFAULT_ON
                      : MENU_ITEM_DEFAULT,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={MENU_ICON}>
                      <Icon name="search" size="sm" />
                    </span>
                    <span className="truncate">{suggestion}</span>
                  </span>
                  {activeSuggestionIndex === index && (
                    <span className={MENU_HINT}>Enter</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton
          icon="star"
          size={32}
          onClick={openFavorites}
          className="pointer-coarse:size-11"
          aria-label="View favorites"
          tooltip="Favorites"
          tooltipSide="bottom"
        />
      </>
    );

  return (
    <TooltipProvider>
      <PickerSurface
        open={open}
        onOpenChange={(nextOpen) => !nextOpen && onClose()}
        ariaLabel="GIF picker"
        modal={isExpanded}
        stacked={stacked}
        className={panelLayout}
        style={markerRef && !isExpanded ? dynamicStyle : undefined}
        initialFocusRef={searchInputRef}
        anchorRef={markerRef}
        desktopProps={{ onMouseDown: (event) => event.stopPropagation() }}
      >
        <PickerHeader
          tabs={
            <Tabs
              label="Media type"
              items={MEDIA_TABS}
              value={mediaType}
              onValueChange={handleMediaTypeChange}
              className="h-9"
            />
          }
        >
          {searchRow}
          {!voiceMode && !lockExpanded && (
            <IconButton
              icon={expanded ? "minimize" : "maximize"}
              size={32}
              onClick={() => setExpanded((value) => !value)}
              className="max-md:hidden"
              aria-label={expanded ? "Shrink GIF picker" : "Expand GIF picker"}
              tooltip={expanded ? "Shrink" : "Expand"}
              tooltipSide="bottom"
            />
          )}
          <IconButton
            icon="close"
            size={32}
            onClick={onClose}
            aria-label="Close GIF picker"
          />
        </PickerHeader>

        {/* Voice reaction mode: display mode selector + rate limit line */}
        {voiceMode && (
          <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 scrollbar-none">
            <span className="mr-1 shrink-0 px-1 text-ui-xs font-medium text-ink-3">
              React mode
            </span>
            {VOICE_DISPLAY_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => persistVoiceDisplayMode(mode)}
                aria-pressed={voiceDisplayMode === mode}
                className={cn(
                  "h-7 shrink-0 rounded-sm px-2 text-ui-xs font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  PRESS,
                  HIT,
                  voiceDisplayMode === mode
                    ? "bg-tint-2 text-ink-1"
                    : "text-ink-3 pointer-fine:hover:text-ink-1",
                )}
              >
                {VOICE_DISPLAY_MODE_LABELS[mode]}
              </button>
            ))}
            {voiceRateLimited && (
              <span
                role="status"
                className="ml-auto flex shrink-0 items-center gap-1 px-1 text-ui-xs font-medium text-warning-ink"
              >
                <Icon name="warning" size="xs" />
                Slow down!
              </span>
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          tabIndex={-1}
          onScroll={() => void handleScroll()}
          onKeyDown={handlePickerGridKeyDown}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none"
        >
          {mode === "categories" &&
            searchValue.trim() === "" &&
            recentQueries.length > 0 && (
              <div className="mb-1">
                <PickerSectionLabel
                  sticky={false}
                  trailing={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearRecentQueries();
                      }}
                      className={cn(
                        "relative rounded-xs text-ui-xs font-medium text-ink-3 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        HIT,
                      )}
                    >
                      Clear all
                    </button>
                  }
                >
                  Recent searches
                </PickerSectionLabel>
                <div className="flex flex-wrap gap-1 px-1 pb-1">
                  {recentQueries.map((q) => (
                    <div
                      key={q}
                      className="inline-flex h-7 items-center gap-0.5 rounded-sm bg-tint-1 pl-2 pr-0.5 text-ui-xs font-medium text-ink-1"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          saveQueryToHistory(q);
                          commitProgrammaticSearch(q);
                        }}
                        className={cn(
                          "relative rounded-xs text-left outline-none pointer-fine:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          HIT,
                        )}
                      >
                        {q}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentQuery(q);
                        }}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-xs text-ink-3 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                          PRESS,
                          HIT,
                        )}
                        aria-label={`Remove ${q} from history`}
                      >
                        <Icon name="close" size="xs" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {mode === "categories" && (
            <div
              className={cn(
                "grid grid-cols-2 gap-0.5",
                expanded && "md:grid-cols-3",
              )}
            >
              <ShortcutCell
                label="Favorites"
                icon="star"
                item={latestFavoritePreview}
                onClick={openFavorites}
              />
              <ShortcutCell
                label="Trending"
                icon="trendUp"
                item={featuredCardPreview}
                onClick={openFeatured}
              />
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategorySearch(category)}
                  data-picker-cell=""
                  className={cn(
                    "group relative h-24 overflow-hidden rounded-md bg-tint-1",
                    PICKER_RING,
                  )}
                >
                  <img
                    src={category.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <span className={MEDIA_SCRIM} />
                  <span className={MEDIA_HOVER} />
                  <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-ui-row font-semibold capitalize text-white">
                    {category.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {mode === "categories" && categoriesLoading ? (
            <div
              role="status"
              className="py-8 text-center text-ui-sm font-medium text-ink-3"
            >
              Loading {providerLabel} {mediaLabel} categories…
            </div>
          ) : null}

          {mode === "categories" &&
          !categoriesLoading &&
          categories.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-ui-sm text-ink-3">
              No {providerLabel} {mediaLabel} categories available right now.
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="m-1 rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
            >
              {error}
            </div>
          ) : null}

          {mode === "favorites" && results.length === 0 ? (
            <FavoritesEmptyState mediaLabel={mediaLabel} />
          ) : null}

          {mode !== "categories" && results.length > 0 ? (
            <div className="flex items-start gap-0.5">
              {columnItems.map((col, colIdx) => (
                <div
                  key={colIdx}
                  className="flex min-w-0 flex-1 flex-col gap-0.5"
                >
                  {col.map((gif) => (
                    <GifTile
                      key={getGifItemIdentityKey(gif)}
                      gif={gif}
                      isFavorite={favoriteIds.has(getGifItemIdentityKey(gif))}
                      onToggleFavorite={handleToggleFavorite}
                      onSelect={handleSelect}
                      isClip={
                        mediaType === "clips" ||
                        (mode === "favorites" &&
                          inferGifPickerMediaType(gif) === "clips")
                      }
                      clipsMuted={clipsMuted}
                      onToggleClipsMuted={handleToggleClipsMuted}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (mode === "search" || mode === "featured") &&
            !loading &&
            !error ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-ui-sm text-ink-3">
              {getNoResultsMessage()}
            </div>
          ) : null}

          {loading ? (
            <GifLoadingSkeleton
              message={`Loading ${providerLabel} ${mediaLabel}…`}
            />
          ) : null}

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

        {/* The one provider attribution. With more than one GIF provider it
            is also the provider switch, so the name never shows twice. */}
        <div className="flex h-9 shrink-0 select-none items-center justify-center gap-1 border-t border-line text-ui-xs text-ink-3">
          <span>Powered by</span>
          {mediaType === "gifs" && providerOptions.length > 1 ? (
            <Select
              value={provider}
              onValueChange={(value) =>
                handleProviderChange(value as GifProvider)
              }
            >
              <SelectTrigger
                size="sm"
                aria-label="GIF provider"
                className="h-6 gap-1 border-transparent bg-transparent px-1.5 text-ink-2 pointer-fine:hover:bg-tint-1 data-[size=sm]:h-6 pointer-coarse:min-h-8"
              >
                <ProviderMark provider={provider} />
              </SelectTrigger>
              <SelectContent position="popper" align="center" side="top">
                {providerOptions.map((option) => {
                  const label = getGifProviderLabel(option);
                  return (
                    <SelectItem key={option} value={option} textValue={label}>
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <span className="flex items-center px-1.5 text-ink-2">
              <ProviderMark provider={provider} />
            </span>
          )}
        </div>
      </PickerSurface>
    </TooltipProvider>
  );
}

/** Over media: a fixed black scrim (media is the same in every theme). */
const MEDIA_SCRIM = "pointer-events-none absolute inset-0 bg-black/50";
/** Hover over media: the ink tint, revealed on fine pointers. */
const MEDIA_HOVER =
  "pointer-events-none absolute inset-0 bg-tint-2 opacity-0 transition-opacity duration-(--dur-1) ease-out pointer-fine:group-hover:opacity-100";

/**
 * The provider's wordmark, drawn in the current ink through a mask so it
 * holds in every theme (light, dark, Miku, Spider-Man) without a theme check.
 */
function ProviderMark({ provider }: { provider: GifProvider }) {
  if (provider === "klipy") {
    return (
      <span
        role="img"
        aria-label="KLIPY"
        className="inline-block aspect-[375/102] h-3 bg-current"
        style={{
          maskImage: `url("${klipyTextLightUrl}")`,
          WebkitMaskImage: `url("${klipyTextLightUrl}")`,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }
  return <span className="font-semibold">{getGifProviderLabel(provider)}</span>;
}

/**
 * Pauses a looping preview video while the app is inactive (hidden, or
 * behind a fullscreen game): the global CSS pause doesn't reach <video>.
 */
function useVideoPausedWhileInactive(
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const active = useAppActive();
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      if (video.autoplay && video.paused) void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [active, videoRef]);
}

/** A looping, muted preview video that stops with the app. */
function PreviewVideo(props: React.ComponentProps<"video">) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoPausedWhileInactive(videoRef);
  return <video ref={videoRef} {...props} />;
}

const ClipVideoPlayer = memo(function ClipVideoPlayer({
  asset,
  muted,
  onDurationLoaded,
}: {
  asset: GifPickerAsset;
  muted: boolean;
  onDurationLoaded?: (duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoPausedWhileInactive(videoRef);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
    >
      <video
        ref={videoRef}
        src={getMediaUrl(asset.url)}
        className="h-auto w-full object-cover"
        style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="metadata"
        aria-label="Clip preview"
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          if (
            video &&
            !isNaN(video.duration) &&
            isFinite(video.duration) &&
            onDurationLoaded
          ) {
            onDurationLoaded(video.duration);
          }
        }}
      >
        <track kind="captions" />
      </video>
    </div>
  );
});

/** A chip over media (6.5): fixed black glass and white ink in every theme. */
const MEDIA_CHIP = cn(
  "absolute z-10 flex size-7 items-center justify-center rounded-sm bg-black/60 text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
  PRESS,
  HIT,
  "absolute",
);

const GifTile = memo(function GifTile({
  gif,
  isFavorite,
  onToggleFavorite,
  onSelect,
  isClip = false,
  clipsMuted,
  onToggleClipsMuted,
}: {
  gif: GifPickerItem;
  isFavorite: boolean;
  onToggleFavorite: (gif: GifPickerItem) => void;
  onSelect: (gif: GifPickerItem) => void;
  isClip?: boolean;
  clipsMuted: boolean;
  onToggleClipsMuted: () => void;
}) {
  const [loadedDuration, setLoadedDuration] = useState<number | undefined>(
    undefined,
  );

  const duration = loadedDuration ?? gif.duration;

  // Clip audio: a fine pointer hears the clip it hovers; touch has no hover,
  // so a tap on the speaker chip opts this one clip in. `clipsMuted` is the
  // picker-wide mute either way.
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const clipMuted = !(hovered || tapped) || clipsMuted;
  const toggleClipAudio = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (hovered) {
      onToggleClipsMuted();
      return;
    }
    if (clipMuted) {
      setTapped(true);
      if (clipsMuted) onToggleClipsMuted();
    } else {
      setTapped(false);
    }
  };

  return (
    <div
      className="group relative overflow-hidden rounded-md bg-tint-1"
      onPointerEnter={
        isClip
          ? (event) => {
              if (event.pointerType === "mouse") setHovered(true);
            }
          : undefined
      }
      onPointerLeave={isClip ? () => setHovered(false) : undefined}
    >
      <button
        type="button"
        onClick={() => onSelect({ ...gif, duration })}
        data-picker-cell=""
        className={cn(
          "block w-full overflow-hidden rounded-md text-left",
          PICKER_RING,
        )}
        aria-label={`Send asset: ${gif.altText || gif.title}`}
      >
        {isClip ? (
          <ClipVideoPlayer
            asset={gif.send}
            muted={clipMuted}
            onDurationLoaded={setLoadedDuration}
          />
        ) : (
          <GifPreviewMedia asset={gif.preview} alt={gif.altText || gif.title} />
        )}
      </button>

      <span className={MEDIA_HOVER} />

      {isClip && (
        <button
          type="button"
          onClick={toggleClipAudio}
          className={cn(
            // Media overlay chip over the clip (6.5): always shown on touch,
            // revealed on hover for fine pointers.
            MEDIA_CHIP,
            "bottom-1 left-1",
            REVEAL,
          )}
          aria-label={clipMuted ? "Unmute clip preview" : "Mute clip preview"}
          aria-pressed={!clipMuted}
        >
          <Icon name={clipMuted ? "speakerOff" : "voiceChannel"} size="sm" />
        </button>
      )}

      {duration !== undefined && (
        <Num className="pointer-events-none absolute bottom-1 right-1 z-10 rounded-xs bg-black/60 px-1 py-0.5 text-white select-none">
          {formatDuration(duration)}
        </Num>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite({ ...gif, duration });
            }}
            className={cn(
              // Over the GIF itself: a media overlay chip (6.5), inset 4px so
              // it sits inside the tile's corner radius. Visible on touch,
              // hover-revealed on fine pointers; kept up once saved.
              MEDIA_CHIP,
              "right-1 top-1",
              !isFavorite && REVEAL,
            )}
            aria-label={
              isFavorite ? "Remove from favorites" : "Add to favorites"
            }
            aria-pressed={isFavorite}
          >
            <Icon
              name="star"
              state={isFavorite ? "active" : "idle"}
              size="sm"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>
          {isFavorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
});

/** Favorites / Trending: the same whole cell as a category, with a glyph. */
function ShortcutCell({
  label,
  icon,
  item,
  onClick,
}: {
  label: string;
  icon: "star" | "trendUp";
  item: GifPickerItem | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-picker-cell=""
      className={cn(
        "group relative h-24 overflow-hidden rounded-md bg-tint-2",
        PICKER_RING,
      )}
    >
      <GifShortcutCardMedia item={item} />
      {item ? <span className={MEDIA_SCRIM} /> : null}
      <span className={MEDIA_HOVER} />
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-1.5 text-ui-row font-semibold",
          item ? "text-white" : "text-ink-1",
        )}
      >
        <Icon name={icon} size="sm" />
        {label}
      </span>
    </button>
  );
}

function GifShortcutCardMedia({ item }: { item: GifPickerItem | null }) {
  if (!item) return null;

  const asset = item.preview;
  const className = "absolute inset-0 h-full w-full object-cover";

  if (asset.contentType === "video/mp4") {
    return (
      <PreviewVideo
        src={getMediaUrl(asset.url)}
        className={className}
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
      alt=""
      width={asset.width}
      height={asset.height}
      loading="lazy"
      decoding="async"
      className={className}
      aria-hidden="true"
    />
  );
}

function FavoritesEmptyState({ mediaLabel = "GIFs" }: { mediaLabel?: string }) {
  const singleLabel = mediaLabel.toLowerCase().endsWith("s")
    ? mediaLabel.slice(0, -1)
    : mediaLabel;
  return (
    <div aria-live="polite">
      <EmptyState
        size="sm"
        art={<Icon name="star" size="2xl" className="text-ink-3" />}
        title="Favorites will show up here"
        description={`Click the star in the corner of a ${singleLabel.toLowerCase()} to favorite it.`}
      />
    </div>
  );
}

function isRateLimitError(error: unknown): boolean {
  const maybeError = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
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

function GifLoadingSkeleton({
  compact = false,
  message,
}: {
  compact?: boolean;
  message: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-3"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center justify-center gap-2 text-center text-ui-xs font-medium text-ink-3">
        {compact && <Spinner className="size-3.5" />}
        {message}
      </div>
      {!compact && (
        <div className="mt-2 grid w-full grid-cols-2 gap-0.5">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton
              key={index}
              className={cn(
                "rounded-md",
                index % 3 === 0 ? "h-28" : index % 3 === 1 ? "h-20" : "h-24",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GifPreviewMedia({
  asset,
  alt,
}: {
  asset: GifPickerAsset;
  alt: string;
}) {
  const className = "h-auto w-full object-cover";
  const style = { aspectRatio: `${asset.width} / ${asset.height}` };

  if (asset.contentType === "video/mp4") {
    return (
      <PreviewVideo
        src={getMediaUrl(asset.url)}
        className={className}
        style={style}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="GIF preview"
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
