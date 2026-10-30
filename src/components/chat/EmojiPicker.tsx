import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeApiError } from "@/lib/api-errors";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  MAX_AI_EMOJI_PROMPT_LENGTH,
  EMOJI_RECENTS_STORAGE_KEY,
  NATIVE_EMOJI_SKIN_TONE_OPTIONS,
  buildCustomEmojiToken,
  getNativeEmojiCategories,
  isEmojiDataReady,
  loadEmojiData,
  loadEmojiRecents,
  rememberRecentEmoji,
  resolveNativeEmojiShortcode,
  searchNativeEmojis,
  toCustomEmojiRecentItem,
  toNativeEmojiRecentItem,
  type EmojiRecentItem,
  type GeneratedEmoji,
  type GeneratedEmojiListResponse,
  type NativeEmoji,
  type NativeEmojiCategory,
  type NativeEmojiSkinTone,
} from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { isMobileViewport } from "@/hooks/useMediaQuery";
import { PickerSurface } from "./PickerSurface";
import {
  PICKER_CELL,
  PICKER_CELL_ATTR,
  PICKER_WIDTH,
  PICKER_WIDTH_CLASS,
  handlePickerGridKeyDown,
} from "./picker-grid";
import { PickerHeader, PickerSearch, PickerSectionLabel } from "./PickerHeader";
import { primeCustomEmojiCache } from "@/hooks/useCustomEmojiLookup";
import { useMounted } from "@/hooks/useMounted";
import { useEmojiDataReady } from "@/hooks/useEmojiDataReady";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { HIT, PRESS } from "@/components/ui/interaction";
import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
  MENU_PANEL,
} from "@/components/ui/menu";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import InlineEmoji from "./InlineEmoji";

interface Props {
  open: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  placement?: "top-end" | "bottom-start" | "bottom-end" | "left" | "right";
  markerRef?: React.RefObject<HTMLElement | null>;
  isClosing?: boolean;
}

const CUSTOM_SECTION_ID = "custom-creations";
const RECENTS_SECTION_ID = "recently-used";
const EMPTY_EMOJI_RECENTS: EmojiRecentItem[] = [];
const SKIN_TONE_STORAGE_KEY = "chat:emoji:skin-tone:v1";
const EMOJI_RECENTS_EVENT = "emoji-recents-updated";
/** 420 wide x 560 tall (audit §4): the same width as the GIF and sound pickers. */
const PICKER_HEIGHT = 560;
/** Placeholder rail slots and grid cells while the emoji set loads (desktop). */
const LOADING_RAIL_SLOTS = 8;
const LOADING_GRID_CELLS = 90;

/**
 * Category rail glyphs (Phosphor). An unknown category id falls back to its
 * emoji drawn in grey.
 */
const CATEGORY_ICON: Partial<Record<string, IconName>> = {
  people: "emoji",
  nature: "nature",
  foods: "food",
  activity: "gamepad",
  places: "globe",
  objects: "lightbulb",
  symbols: "like",
  flags: "flag",
};

/**
 * Whole cells packed edge to edge: as many 40px columns as fit, stretched to
 * fill the row, so there is no gutter and the cell is the hit target.
 */
const EMOJI_GRID = "grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]";
const EMOJI_CELL = cn(
  "flex aspect-square items-center justify-center rounded-md",
  PICKER_CELL,
);

type EmojiView = "emoji" | "compose";
type RecentRenderableItem =
  | { key: string; type: "native"; emoji: NativeEmoji }
  | { key: string; type: "custom"; emoji: GeneratedEmoji };

/** The hovered or focused cell, shown in the footer. */
type PreviewItem = {
  name: string;
  code: string;
  native: string | null;
  imageUrl: string | null;
};

/**
 * A tiny external store for the footer preview, so hovering a cell re-renders
 * the footer only, never the ~1,900-cell grid.
 */
function createPreviewStore() {
  let current: PreviewItem | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: PreviewItem | null) {
      if (next?.code === current?.code) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type PreviewStore = ReturnType<typeof createPreviewStore>;

/** Reads the preview payload a cell carries in its data attributes. */
function previewFromEvent(target: EventTarget | null): PreviewItem | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>("[data-preview-code]");
  if (!cell) return null;
  return {
    name: cell.dataset.previewName ?? "",
    code: cell.dataset.previewCode ?? "",
    native: cell.dataset.previewNative || null,
    imageUrl: cell.dataset.previewSrc || null,
  };
}

function dedupeCreatedEmojis(items: GeneratedEmoji[]): GeneratedEmoji[] {
  const seen = new Set<string>();
  const next: GeneratedEmoji[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }

  return next;
}

function getStoredSkinTone(): NativeEmojiSkinTone {
  if (typeof window === "undefined") return 0;

  try {
    const rawValue = window.localStorage.getItem(SKIN_TONE_STORAGE_KEY);
    const numericValue = Number(rawValue);

    return Number.isInteger(numericValue) &&
      numericValue >= 0 &&
      numericValue <= 5
      ? (numericValue as NativeEmojiSkinTone)
      : 0;
  } catch {
    return 0;
  }
}

function subscribeEmojiRecents(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === EMOJI_RECENTS_STORAGE_KEY) {
      onStoreChange();
    }
  };

  const handleEmojiRecents = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(EMOJI_RECENTS_EVENT, handleEmojiRecents);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(EMOJI_RECENTS_EVENT, handleEmojiRecents);
  };
}

function matchesGeneratedEmojiSearch(
  item: GeneratedEmoji,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;

  return `${item.shortcode} ${item.prompt}`
    .toLowerCase()
    .includes(normalizedQuery);
}

/** Status-based copy (never the server's log message), or the fallback. */
function getErrorMessage(
  error: unknown,
  action: string,
  fallback: string,
): string {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number"
    ? describeApiError(error, action)
    : fallback;
}

function ReadyEmojiPreview({
  alt,
  imageUrl,
  native,
  className,
}: {
  alt: string;
  imageUrl?: string | null;
  native?: string | null;
  className?: string;
}) {
  return (
    <InlineEmoji
      alt={alt}
      imageUrl={imageUrl}
      native={native}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}

const NativeEmojiButton = memo(function NativeEmojiButton({
  emoji,
  onSelect,
}: {
  emoji: NativeEmoji;
  onSelect: (emoji: NativeEmoji) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(emoji)}
      aria-label={`Insert :${emoji.preferredShortcode}:`}
      className={EMOJI_CELL}
      data-picker-cell=""
      data-preview-name={emoji.name}
      data-preview-code={emoji.preferredShortcode}
      data-preview-native={emoji.native}
      data-preview-src={emoji.imageUrl}
    >
      <ReadyEmojiPreview
        alt={`:${emoji.preferredShortcode}:`}
        imageUrl={emoji.imageUrl}
        native={emoji.native}
        className="size-7"
      />
    </button>
  );
});

/** A custom creation in the same 40px cell as a standard emoji. */
const CustomEmojiButton = memo(function CustomEmojiButton({
  emoji,
  onSelect,
}: {
  emoji: GeneratedEmoji;
  onSelect: (emoji: GeneratedEmoji) => void;
}) {
  const isReady = emoji.status === "ready" && Boolean(emoji.image_url);
  const isPending = emoji.status === "pending";

  return (
    <button
      type="button"
      disabled={!isReady}
      onClick={() => {
        if (isReady) onSelect(emoji);
      }}
      aria-label={
        isReady
          ? `Insert :${emoji.shortcode}:`
          : `Emoji ${emoji.shortcode} is ${emoji.status}`
      }
      className={EMOJI_CELL}
      data-picker-cell=""
      data-preview-name={emoji.prompt || emoji.shortcode}
      data-preview-code={emoji.shortcode}
      data-preview-src={emoji.image_url ?? ""}
    >
      {isReady ? (
        <ReadyEmojiPreview
          alt={`:${emoji.shortcode}:`}
          imageUrl={emoji.image_url}
          className="size-7"
        />
      ) : isPending ? (
        <Spinner className="text-ink-3" />
      ) : (
        <Icon name="alert" size="md" className="text-danger-ink" />
      )}
    </button>
  );
});

/** The hovered or focused emoji's name and `:shortcode:`. */
function PreviewFooter({ store }: { store: PreviewStore }) {
  const item = useSyncExternalStore(store.subscribe, store.get, () => null);
  return (
    <div
      // Touch has no hover, so the preview line only exists for a fine pointer.
      className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3 pointer-coarse:hidden"
      aria-hidden="true"
    >
      {item ? (
        <>
          <ReadyEmojiPreview
            alt=""
            imageUrl={item.imageUrl}
            native={item.native}
            className="size-6 shrink-0"
          />
          <span className="min-w-0 truncate text-ui-sm font-medium text-ink-1">
            {item.name}
          </span>
          <span className="ms-auto min-w-0 shrink truncate text-num-xs text-ink-3">
            :{item.code}:
          </span>
        </>
      ) : (
        <span className="text-ui-xs text-ink-3">Pick an emoji</span>
      )}
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            PRESS,
            HIT,
            active
              ? "bg-tint-2 text-ink-1"
              : "text-ink-3 pointer-fine:hover:text-ink-1",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function EmojiPicker({
  open,
  onSelect,
  onClose,
  placement = "top-end",
  markerRef: externalMarkerRef,
  isClosing = false,
}: Props) {
  const mounted = useMounted();
  const [activeView, setActiveView] = useState<EmojiView>("emoji");
  const [search, setSearch] = useState("");
  const [selectedSkinTone, setSelectedSkinTone] =
    useState<NativeEmojiSkinTone>(0);
  const [showSkinToneMenu, setShowSkinToneMenu] = useState(false);
  const [generatedEmojis, setGeneratedEmojis] = useState<GeneratedEmoji[]>([]);
  const [loadingGeneratedEmojis, setLoadingGeneratedEmojis] = useState(true);
  const [generatedEmojiError, setGeneratedEmojiError] = useState<string | null>(
    null,
  );
  const recents = useSyncExternalStore(
    subscribeEmojiRecents,
    loadEmojiRecents,
    () => EMPTY_EMOJI_RECENTS,
  );
  // Bundled (always ready) on the web; on desktop the set loads in its own
  // chunk, so the picker shows a static skeleton until it lands.
  const emojiDataReady = useEmojiDataReady();
  const [emojiDataFailed, setEmojiDataFailed] = useState(false);
  const [emojiDataAttempt, setEmojiDataAttempt] = useState(0);
  const nativeCategories = useMemo(
    () => (emojiDataReady ? getNativeEmojiCategories(selectedSkinTone) : []),
    [emojiDataReady, selectedSkinTone],
  );
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const pendingJumpIdRef = useRef<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [shortcode, setShortcode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [previewStore] = useState(createPreviewStore);

  useEffect(() => {
    if (mounted) setSelectedSkinTone(getStoredSkinTone());
  }, [mounted]);

  const internalMarkerRef = useRef<HTMLSpanElement>(null);
  const markerRef = externalMarkerRef ?? internalMarkerRef;
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });
  const promptInputId = useId();
  const searchInputId = useId();
  const shortcodeInputId = useId();

  const deferredSearch = useDeferredValue(search.trim());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const hasPendingGeneratedEmojis = useMemo(
    () => generatedEmojis.some((item) => item.status === "pending"),
    [generatedEmojis],
  );
  const customSearchResults = useMemo(
    () =>
      deferredSearch
        ? generatedEmojis.filter((item) =>
            matchesGeneratedEmojiSearch(item, deferredSearch),
          )
        : [],
    [deferredSearch, generatedEmojis],
  );
  const nativeSearchResults = useMemo(
    () =>
      deferredSearch && emojiDataReady
        ? searchNativeEmojis(deferredSearch, 120, selectedSkinTone)
        : [],
    [deferredSearch, emojiDataReady, selectedSkinTone],
  );
  const clapPreviewEmoji = useMemo(
    () =>
      emojiDataReady
        ? (resolveNativeEmojiShortcode("clap", selectedSkinTone) ??
          resolveNativeEmojiShortcode("raised_hands", selectedSkinTone))
        : null,
    [emojiDataReady, selectedSkinTone],
  );

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      sectionRefs.current[id] = node;
    },
    [],
  );

  const persistSkinTone = useCallback((tone: NativeEmojiSkinTone) => {
    setSelectedSkinTone(tone);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SKIN_TONE_STORAGE_KEY, String(tone));
      } catch {
        // Skin tone persistence is optional when browser storage is unavailable.
      }
    }
  }, []);

  const recentRenderableItems = useMemo<RecentRenderableItem[]>(
    () =>
      recents.flatMap<RecentRenderableItem>((item) => {
        if (item.type === "native") {
          if (!emojiDataReady) return [];
          const emoji =
            resolveNativeEmojiShortcode(item.shortcode, selectedSkinTone) ??
            resolveNativeEmojiShortcode(item.shortcode);

          return emoji
            ? [
                {
                  key: `recent-native-${item.id}`,
                  type: "native" as const,
                  emoji,
                },
              ]
            : [];
        }

        const customEmoji = generatedEmojis.find(
          (emoji) => emoji.id === item.id,
        );
        return customEmoji
          ? [
              {
                key: `recent-custom-${item.id}`,
                type: "custom" as const,
                emoji: customEmoji,
              },
            ]
          : [];
      }),
    [emojiDataReady, generatedEmojis, recents, selectedSkinTone],
  );

  // Sections that exist right now, in scroll order. "Recently used" and
  // "Your creations" only appear when they have something in them, so the
  // first view is standard emoji, never an empty box.
  const hasRecents = recentRenderableItems.length > 0;
  const hasCreations = generatedEmojis.length > 0;
  const sectionOrder = useMemo(
    () => [
      ...(hasRecents ? [RECENTS_SECTION_ID] : []),
      ...(hasCreations ? [CUSTOM_SECTION_ID] : []),
      ...nativeCategories.map((category) => category.id),
    ],
    [hasCreations, hasRecents, nativeCategories],
  );
  const currentCategory = activeCategory ?? sectionOrder[0] ?? null;

  const loadGeneratedEmojis = useCallback(
    async (options?: { signal?: AbortSignal; silent?: boolean }) => {
      setGeneratedEmojiError(null);
      if (!options?.silent) {
        setLoadingGeneratedEmojis(true);
      }

      try {
        const response = await apiGet<GeneratedEmojiListResponse>(
          "/api/emojis",
          { signal: options?.signal },
        );
        const nextItems = dedupeCreatedEmojis(response.items);
        primeCustomEmojiCache(nextItems);
        setGeneratedEmojis(nextItems);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setGeneratedEmojiError(
          getErrorMessage(
            error,
            "load your emoji creations",
            "Unable to load your emoji creations. Check your connection and try again.",
          ),
        );
      } finally {
        setLoadingGeneratedEmojis(false);
      }
    },
    [],
  );

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [activeView]);

  // Load the native set when the picker opens before it is ready. A failed
  // load resolves without data; show Retry instead of an endless skeleton.
  useEffect(() => {
    if (!open || emojiDataReady) return undefined;

    let cancelled = false;
    void loadEmojiData().then(() => {
      if (!cancelled) setEmojiDataFailed(!isEmojiDataReady());
    });
    return () => {
      cancelled = true;
    };
  }, [emojiDataAttempt, emojiDataReady, open]);

  const retryEmojiData = useCallback(() => {
    setEmojiDataFailed(false);
    setEmojiDataAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const controller = new AbortController();
    void loadGeneratedEmojis({ signal: controller.signal });
    return () => controller.abort();
  }, [loadGeneratedEmojis, open]);

  useEffect(() => {
    if (!hasPendingGeneratedEmojis) return undefined;

    const intervalId = window.setInterval(() => {
      void loadGeneratedEmojis({ silent: true });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [hasPendingGeneratedEmojis, loadGeneratedEmojis]);

  useEffect(() => {
    previewStore.set(null);
  }, [deferredSearch, previewStore]);

  const handleBackButton = useCallback(() => {
    if (showSkinToneMenu) {
      setShowSkinToneMenu(false);
      return;
    }
    onClose();
  }, [onClose, showSkinToneMenu]);

  useEffect(() => {
    const pendingJumpId = pendingJumpIdRef.current;
    if (!pendingJumpId || activeView !== "emoji" || deferredSearch) return;

    const container = contentRef.current;
    const node = sectionRefs.current[pendingJumpId];
    if (!container || !node) return;

    // A jump is a keyboard-or-click navigation: instant, no smooth scroll.
    container.scrollTo({ top: Math.max(0, node.offsetTop) });
    pendingJumpIdRef.current = null;
  }, [activeView, deferredSearch, currentCategory]);

  useEffect(() => {
    const updatePosition = () => {
      if (!markerRef.current) return;
      if (isMobileViewport()) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = PICKER_WIDTH;

      // Calculate absolute safe max height
      const MAX_HEIGHT = Math.min(PICKER_HEIGHT, window.innerHeight - 20);

      const style: React.CSSProperties = {
        opacity: 1,
        maxHeight: MAX_HEIGHT,
      };

      if (placement === "left" || placement === "right") {
        const opensToRight = placement === "right";
        let left = opensToRight ? rect.right + 8 : rect.left - pickerWidth - 8;
        if (
          (opensToRight && left + pickerWidth > window.innerWidth - 10) ||
          (!opensToRight && left < 10)
        ) {
          left = opensToRight ? rect.left - pickerWidth - 8 : rect.right + 8;
        }
        const maxLeft = Math.max(10, window.innerWidth - pickerWidth - 10);
        left = Math.min(Math.max(10, left), maxLeft);
        style.left = left;
        style.top = Math.min(
          Math.max(10, rect.top),
          Math.max(10, window.innerHeight - MAX_HEIGHT - 10),
        );
      } else {
        let left = rect.left;
        if (left + pickerWidth > window.innerWidth - 10) {
          left = Math.max(10, window.innerWidth - pickerWidth - 10);
        }
        if (left < 10) left = 10;
        style.left = left;
      }

      if (placement.startsWith("bottom")) {
        if (rect.bottom + 8 + MAX_HEIGHT > window.innerHeight - 10) {
          // Will clip bottom! Pin to safe bottom edge instead.
          style.bottom = 10;
        } else {
          style.top = rect.bottom + 8;
        }
      } else if (placement !== "left" && placement !== "right") {
        style.bottom = window.innerHeight - rect.top + 8;
        style.maxHeight = Math.min(MAX_HEIGHT, Math.max(100, rect.top - 16));
      }
      setDynamicStyle(style);
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [markerRef, placement]);

  const handleRememberRecent = useCallback((item: EmojiRecentItem) => {
    rememberRecentEmoji(item);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EMOJI_RECENTS_EVENT));
    }
  }, []);

  const handleNativeSelect = useCallback(
    (emoji: NativeEmoji) => {
      handleRememberRecent(toNativeEmojiRecentItem(emoji));
      onSelect(emoji.native);
      onClose();
    },
    [handleRememberRecent, onClose, onSelect],
  );

  const handleCustomSelect = useCallback(
    (emoji: GeneratedEmoji) => {
      if (!emoji.image_url) return;

      handleRememberRecent(toCustomEmojiRecentItem(emoji));
      onSelect(buildCustomEmojiToken(emoji.shortcode, emoji.id));
      onClose();
    },
    [handleRememberRecent, onClose, onSelect],
  );

  const handleEmojiListScroll = useCallback(() => {
    if (deferredSearch) return;

    const container = contentRef.current;
    if (!container) return;

    let nextActive = currentCategory;
    const scrollTop = container.scrollTop;

    for (const id of sectionOrder) {
      const node = sectionRefs.current[id];
      if (!node) continue;

      if (node.offsetTop - 32 <= scrollTop) {
        nextActive = id;
      }
    }

    if (nextActive !== currentCategory) {
      setActiveCategory(nextActive);
    }
  }, [currentCategory, deferredSearch, sectionOrder]);

  const jumpToSection = useCallback((id: string) => {
    setActiveView("emoji");
    setSearch("");
    setActiveCategory(id);
    setShowSkinToneMenu(false);
    pendingJumpIdRef.current = id;
  }, []);

  const handleGenerate = useCallback(async () => {
    const normalizedPrompt = prompt.trim();
    const normalizedShortcode = shortcode.trim();

    if (!normalizedPrompt || isGenerating) return;

    setGenerateError(null);
    setGenerateSuccess(null);
    setIsGenerating(true);

    try {
      const response = await apiPost<
        { item: GeneratedEmoji },
        { prompt: string; shortcode?: string }
      >("/api/emojis", {
        prompt: normalizedPrompt,
        ...(normalizedShortcode ? { shortcode: normalizedShortcode } : {}),
      });

      primeCustomEmojiCache([response.item]);
      setGeneratedEmojis((current) =>
        dedupeCreatedEmojis([response.item, ...current]),
      );
      setPrompt("");
      setShortcode("");
      setGenerateSuccess(
        `Added :${response.item.shortcode}: to your creations.`,
      );
    } catch (error) {
      setGenerateError(
        getErrorMessage(
          error,
          "start emoji generation",
          "Unable to start emoji generation. Check your connection and try again.",
        ),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, shortcode]);

  // Footer preview follows the pointer and keyboard focus (event delegation,
  // so the grid itself never re-renders for it).
  const trackPreview = (event: React.SyntheticEvent) => {
    const item = previewFromEvent(event.target);
    if (item) previewStore.set(item);
  };

  const focusFirstCell = () => {
    contentRef.current
      ?.querySelector<HTMLElement>(`[${PICKER_CELL_ATTR}]:not(:disabled)`)
      ?.focus();
  };

  const creationsStatus = hasPendingGeneratedEmojis ? (
    <>
      <Spinner className="size-3" />
      <span>Generating</span>
    </>
  ) : null;

  const creationsGrid = (
    <div className={EMOJI_GRID}>
      {generatedEmojis.map((emoji) => (
        <CustomEmojiButton
          key={emoji.id}
          emoji={emoji}
          onSelect={handleCustomSelect}
        />
      ))}
    </div>
  );

  return (
    <>
      {!externalMarkerRef ? (
        <span
          ref={internalMarkerRef}
          aria-hidden="true"
          className="absolute"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {mounted
        ? createPortal(
            <>
              <TooltipProvider>
                <PickerSurface
                  open={open}
                  modal={false}
                  onBackButton={
                    open && !isClosing ? handleBackButton : undefined
                  }
                  onOpenChange={(nextOpen) => !nextOpen && onClose()}
                  ariaLabel="Emoji picker"
                  className={cn(
                    "h-[min(560px,calc(100dvh-24px))]",
                    PICKER_WIDTH_CLASS,
                  )}
                  style={dynamicStyle}
                  stacked
                  initialFocusRef={searchInputRef}
                  anchorRef={markerRef}
                  onEscapeKeyDown={(event) => {
                    if (showSkinToneMenu) {
                      event.preventDefault();
                      setShowSkinToneMenu(false);
                    }
                  }}
                >
                  {activeView === "emoji" ? (
                    <PickerHeader>
                      <PickerSearch
                        ref={searchInputRef}
                        id={searchInputId}
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setShowSkinToneMenu(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            focusFirstCell();
                          } else if (event.key === "Enter" && deferredSearch) {
                            // Enter picks the best match.
                            event.preventDefault();
                            contentRef.current
                              ?.querySelector<HTMLButtonElement>(
                                `[${PICKER_CELL_ATTR}]:not(:disabled)`,
                              )
                              ?.click();
                          }
                        }}
                        placeholder="Search emoji and your creations"
                        aria-label="Search emoji and your creations"
                      />

                      <div className="relative">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() =>
                                setShowSkinToneMenu((current) => !current)
                              }
                              className={cn(
                                "flex size-8 items-center justify-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:size-11",
                                PRESS,
                                HIT,
                                showSkinToneMenu && "bg-tint-2",
                              )}
                              aria-label="Choose emoji skin tone"
                              aria-expanded={showSkinToneMenu}
                            >
                              {clapPreviewEmoji ? (
                                <ReadyEmojiPreview
                                  alt="Choose emoji skin tone"
                                  imageUrl={clapPreviewEmoji.imageUrl}
                                  native={clapPreviewEmoji.native}
                                  className="size-5"
                                />
                              ) : (
                                <Icon name="react" size="md" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={8}>
                            Skin tone
                          </TooltipContent>
                        </Tooltip>

                        {showSkinToneMenu ? (
                          <div
                            className={cn(
                              MENU_PANEL,
                              "absolute right-0 top-[calc(100%+8px)] z-20 w-52",
                            )}
                          >
                            {NATIVE_EMOJI_SKIN_TONE_OPTIONS.map((option) => {
                              const optionClapEmoji =
                                resolveNativeEmojiShortcode(
                                  "clap",
                                  option.tone,
                                ) ?? clapPreviewEmoji;
                              const isActive = selectedSkinTone === option.tone;

                              return (
                                <button
                                  key={option.tone}
                                  type="button"
                                  onClick={() => {
                                    persistSkinTone(option.tone);
                                    setShowSkinToneMenu(false);
                                  }}
                                  aria-pressed={isActive}
                                  className={cn(
                                    MENU_ITEM,
                                    isActive
                                      ? MENU_ITEM_DEFAULT_ON
                                      : MENU_ITEM_DEFAULT,
                                  )}
                                >
                                  {optionClapEmoji ? (
                                    <ReadyEmojiPreview
                                      alt={option.label}
                                      imageUrl={optionClapEmoji.imageUrl}
                                      native={optionClapEmoji.native}
                                      className="size-4"
                                    />
                                  ) : null}
                                  <span>{option.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <IconButton
                        icon="magic"
                        size={32}
                        onClick={() => {
                          setActiveView("compose");
                          setGenerateError(null);
                          setGenerateSuccess(null);
                          setShowSkinToneMenu(false);
                        }}
                        aria-label="Create emoji"
                        tooltip="Generate your own emoji"
                        tooltipSide="bottom"
                        className="pointer-coarse:size-11"
                      />
                    </PickerHeader>
                  ) : (
                    <PickerHeader>
                      <IconButton
                        icon="back"
                        size={32}
                        onClick={() => {
                          setActiveView("emoji");
                          setGenerateError(null);
                          setGenerateSuccess(null);
                        }}
                        aria-label="Back"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ui-row font-semibold text-ink-1">
                          AI emoji composer
                        </div>
                        <div className="truncate text-ui-xs text-ink-3">
                          Build custom emoji for your server vibe
                        </div>
                      </div>
                    </PickerHeader>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col">
                    {activeView === "emoji" ? (
                      <div className="flex min-h-0 flex-1">
                        <nav
                          aria-label="Emoji categories"
                          className="no-scrollbar flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line py-1"
                        >
                          {hasRecents ? (
                            <RailButton
                              label="Recently used"
                              active={
                                !deferredSearch &&
                                currentCategory === RECENTS_SECTION_ID
                              }
                              onClick={() => jumpToSection(RECENTS_SECTION_ID)}
                            >
                              <Icon name="clock" size="lg" />
                            </RailButton>
                          ) : null}
                          {hasCreations ? (
                            <RailButton
                              label="Your creations"
                              active={
                                !deferredSearch &&
                                currentCategory === CUSTOM_SECTION_ID
                              }
                              onClick={() => jumpToSection(CUSTOM_SECTION_ID)}
                            >
                              <Icon name="sparkle" size="lg" />
                            </RailButton>
                          ) : null}
                          {hasRecents || hasCreations ? (
                            <div className="my-0.5 h-px w-5 shrink-0 bg-line" />
                          ) : null}
                          {!emojiDataReady && !emojiDataFailed
                            ? Array.from(
                                { length: LOADING_RAIL_SLOTS },
                                (_, index) => (
                                  <div
                                    key={index}
                                    className="flex size-8 shrink-0 items-center justify-center"
                                  >
                                    <Skeleton className="size-5" />
                                  </div>
                                ),
                              )
                            : null}
                          {nativeCategories.map((category) => (
                            <CategoryRailButton
                              key={category.id}
                              category={category}
                              active={
                                !deferredSearch &&
                                currentCategory === category.id
                              }
                              onJump={jumpToSection}
                            />
                          ))}
                        </nav>

                        <div
                          ref={contentRef}
                          onScroll={handleEmojiListScroll}
                          onKeyDown={handlePickerGridKeyDown}
                          onPointerOver={trackPreview}
                          onFocus={trackPreview}
                          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1"
                        >
                          {!emojiDataReady ? (
                            emojiDataFailed ? (
                              <div
                                role="alert"
                                className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-ui-sm text-ink-3"
                              >
                                <span>Emoji didn't load.</span>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={retryEmojiData}
                                >
                                  Try again
                                </Button>
                              </div>
                            ) : (
                              <div role="status" aria-label="Loading emoji">
                                <div className="flex h-8 items-center px-2">
                                  <Skeleton className="h-3 w-24 rounded-xs" />
                                </div>
                                <div className={EMOJI_GRID}>
                                  {Array.from(
                                    { length: LOADING_GRID_CELLS },
                                    (_, index) => (
                                      <div
                                        key={index}
                                        className="flex aspect-square items-center justify-center"
                                      >
                                        <Skeleton className="size-7 rounded-md" />
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )
                          ) : deferredSearch ? (
                            customSearchResults.length +
                              nativeSearchResults.length >
                            0 ? (
                              <section aria-label="Search results">
                                <PickerSectionLabel
                                  trailing={
                                    <span className="text-num-xs">
                                      {customSearchResults.length +
                                        nativeSearchResults.length}
                                    </span>
                                  }
                                >
                                  Results
                                </PickerSectionLabel>
                                <div className={EMOJI_GRID}>
                                  {customSearchResults.map((emoji) => (
                                    <CustomEmojiButton
                                      key={emoji.id}
                                      emoji={emoji}
                                      onSelect={handleCustomSelect}
                                    />
                                  ))}
                                  {nativeSearchResults.map((emoji) => (
                                    <NativeEmojiButton
                                      key={`${emoji.id}-${emoji.unified}`}
                                      emoji={emoji}
                                      onSelect={handleNativeSelect}
                                    />
                                  ))}
                                </div>
                              </section>
                            ) : (
                              <div
                                role="status"
                                className="flex h-40 items-center justify-center px-6 text-center text-ui-sm text-ink-3"
                              >
                                No emoji matched "{deferredSearch}".
                              </div>
                            )
                          ) : (
                            <>
                              {hasRecents ? (
                                <section
                                  ref={setSectionRef(RECENTS_SECTION_ID)}
                                  aria-label="Recently used"
                                >
                                  <PickerSectionLabel>
                                    Recently used
                                  </PickerSectionLabel>
                                  <div className={EMOJI_GRID}>
                                    {recentRenderableItems.map((item) =>
                                      item.type === "native" ? (
                                        <NativeEmojiButton
                                          key={item.key}
                                          emoji={item.emoji}
                                          onSelect={handleNativeSelect}
                                        />
                                      ) : (
                                        <CustomEmojiButton
                                          key={item.key}
                                          emoji={item.emoji}
                                          onSelect={handleCustomSelect}
                                        />
                                      ),
                                    )}
                                  </div>
                                </section>
                              ) : null}

                              {hasCreations ? (
                                <section
                                  ref={setSectionRef(CUSTOM_SECTION_ID)}
                                  aria-label="Your creations"
                                >
                                  <PickerSectionLabel
                                    trailing={creationsStatus}
                                  >
                                    Your creations
                                  </PickerSectionLabel>
                                  {creationsGrid}
                                </section>
                              ) : generatedEmojiError &&
                                !loadingGeneratedEmojis ? (
                                <div
                                  role="alert"
                                  className="mx-1 mt-2 flex items-center gap-2 rounded-md bg-danger-tint px-2 py-1.5 text-ui-xs text-danger-ink"
                                >
                                  <span className="min-w-0 flex-1">
                                    {generatedEmojiError}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void loadGeneratedEmojis()}
                                  >
                                    Retry
                                  </Button>
                                </div>
                              ) : null}

                              {nativeCategories.map((category) => (
                                <section
                                  key={category.id}
                                  ref={setSectionRef(category.id)}
                                  aria-label={category.label}
                                  style={{
                                    contentVisibility: "auto",
                                    containIntrinsicSize: "auto 320px",
                                  }}
                                >
                                  <PickerSectionLabel>
                                    {category.label}
                                  </PickerSectionLabel>
                                  <div className={EMOJI_GRID}>
                                    {category.emojis.map((emoji) => (
                                      <NativeEmojiButton
                                        key={`${category.id}-${emoji.id}-${emoji.unified}`}
                                        emoji={emoji}
                                        onSelect={handleNativeSelect}
                                      />
                                    ))}
                                  </div>
                                </section>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                        onKeyDown={handlePickerGridKeyDown}
                        onPointerOver={trackPreview}
                        onFocus={trackPreview}
                      >
                        <div className="space-y-3 p-3">
                          <div>
                            <label
                              htmlFor={promptInputId}
                              className="mb-1.5 block text-ui-sm font-medium text-ink-1"
                            >
                              Prompt
                            </label>
                            <Textarea
                              id={promptInputId}
                              aria-label="Prompt"
                              value={prompt}
                              onChange={(event) => {
                                setPrompt(
                                  event.target.value.slice(
                                    0,
                                    MAX_AI_EMOJI_PROMPT_LENGTH,
                                  ),
                                );
                                setGenerateError(null);
                                setGenerateSuccess(null);
                              }}
                              rows={3}
                              placeholder="Cyber raccoon smirking with pixel sunglasses"
                              className="resize-none"
                            />
                            <div className="mt-1 text-right text-num-xs text-ink-3">
                              {prompt.trim().length} /{" "}
                              {MAX_AI_EMOJI_PROMPT_LENGTH}
                            </div>
                          </div>
                          <div>
                            <label
                              htmlFor={shortcodeInputId}
                              className="mb-1.5 block text-ui-sm font-medium text-ink-1"
                            >
                              Shortcode
                            </label>
                            <Input
                              id={shortcodeInputId}
                              type="text"
                              aria-label="Shortcode"
                              value={shortcode}
                              onChange={(event) => {
                                setShortcode(event.target.value);
                                setGenerateError(null);
                                setGenerateSuccess(null);
                              }}
                              placeholder="Optional. We can generate one for you."
                              className="pointer-coarse:h-11"
                            />
                          </div>
                          {generateError ? (
                            <div
                              role="alert"
                              className="rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
                            >
                              {generateError}
                            </div>
                          ) : null}
                          {generateSuccess ? (
                            <div
                              role="status"
                              className="rounded-md bg-success-tint px-3 py-2 text-ui-sm text-success-ink"
                            >
                              {generateSuccess}
                            </div>
                          ) : null}
                          <Button
                            onClick={() => void handleGenerate()}
                            disabled={!prompt.trim()}
                            loading={isGenerating}
                            className="w-full"
                          >
                            <Icon name="sparkle" size="sm" />
                            Generate emoji
                          </Button>
                        </div>

                        <section
                          aria-label="Your creations"
                          className="border-t border-line px-1 pb-1"
                        >
                          <PickerSectionLabel
                            sticky={false}
                            trailing={creationsStatus}
                          >
                            Your creations
                          </PickerSectionLabel>
                          {loadingGeneratedEmojis && !hasCreations ? (
                            <div
                              role="status"
                              className="flex items-center gap-2 px-2 py-3 text-ui-sm text-ink-3"
                            >
                              <Spinner />
                              Loading your creations…
                            </div>
                          ) : generatedEmojiError ? (
                            <div
                              role="alert"
                              className="mx-1 rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
                            >
                              {generatedEmojiError}
                            </div>
                          ) : hasCreations ? (
                            creationsGrid
                          ) : (
                            <div className="px-2 py-3 text-ui-sm text-ink-3">
                              Your creations will show up here as soon as you
                              generate them.
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </div>

                  <PreviewFooter store={previewStore} />
                </PickerSurface>
              </TooltipProvider>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

/** A category rail button: a Phosphor glyph, or the category's emoji in grey. */
const CategoryRailButton = memo(function CategoryRailButton({
  category,
  active,
  onJump,
}: {
  category: NativeEmojiCategory;
  active: boolean;
  onJump: (id: string) => void;
}) {
  const icon = CATEGORY_ICON[category.id];
  return (
    <RailButton
      label={category.label}
      active={active}
      onClick={() => onJump(category.id)}
    >
      {icon ? (
        <Icon name={icon} size="lg" />
      ) : (
        <ReadyEmojiPreview
          alt=""
          imageUrl={category.iconImageUrl}
          native={category.iconNative}
          className={cn(
            "size-4.5 grayscale",
            active ? "opacity-90" : "opacity-60",
          )}
        />
      )}
    </RailButton>
  );
});
