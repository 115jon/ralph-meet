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
import { primeCustomEmojiCache } from "@/hooks/useCustomEmojiLookup";
import { useMounted } from "@/hooks/useMounted";
import { Icon } from "@/components/ui/icon";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HIT, PRESS } from "@/components/ui/interaction";
import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_ITEM_DEFAULT_ON,
  MENU_PANEL,
} from "@/components/ui/menu";
import {
  type ReactNode,
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

type EmojiView = "emoji" | "compose";
type RecentRenderableItem =
  | { key: string; type: "native"; emoji: NativeEmoji }
  | { key: string; type: "custom"; emoji: GeneratedEmoji };

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

function buildInitialCollapsedCategories(
  categories: NativeEmojiCategory[],
): Record<string, boolean> {
  return {
    [RECENTS_SECTION_ID]: false,
    [CUSTOM_SECTION_ID]: false,
    ...Object.fromEntries(
      categories.map((category, index) => [category.id, index !== 0]),
    ),
  };
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

function NativeEmojiButton({
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
      title={`:${emoji.preferredShortcode}:`}
      aria-label={`Insert :${emoji.preferredShortcode}:`}
      className={cn(
        "flex size-10 items-center justify-center rounded-md",
        PRESS,
        HIT,
      )}
    >
      <ReadyEmojiPreview
        alt={`:${emoji.preferredShortcode}:`}
        imageUrl={emoji.imageUrl}
        native={emoji.native}
        className="h-6 w-6"
      />
    </button>
  );
}

function CustomEmojiCard({
  emoji,
  onSelect,
}: {
  emoji: GeneratedEmoji;
  onSelect: (emoji: GeneratedEmoji) => void;
}) {
  const isReady = emoji.status === "ready" && Boolean(emoji.image_url);
  const _isFailed = emoji.status === "failed";
  const isPending = emoji.status === "pending";

  return (
    <button
      type="button"
      disabled={!isReady}
      onClick={() => {
        if (isReady) onSelect(emoji);
      }}
      title={`:${emoji.shortcode}: ${emoji.prompt}`}
      aria-label={
        isReady
          ? `Insert :${emoji.shortcode}:`
          : `Emoji ${emoji.shortcode} is ${emoji.status}`
      }
      className={cn(
        "group rounded-lg border border-rm-border p-2 text-left",
        isReady ? PRESS : "cursor-default opacity-90",
      )}
    >
      <div
        className={cn(
          "relative mb-2 flex h-14 items-center justify-center rounded-md bg-rm-tint-1",
        )}
      >
        {isReady ? (
          <ReadyEmojiPreview
            alt={`:${emoji.shortcode}:`}
            imageUrl={emoji.image_url}
            className="h-9 w-9"
          />
        ) : isPending ? (
          <div className="flex flex-col items-center gap-1 text-rm-text-muted">
            <Spinner />
            <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
              Generating
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-rm-danger-ink">
            <Icon name="alert" size="sm" />
            <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
              Failed
            </span>
          </div>
        )}
      </div>
      <div className="truncate text-ui-xs font-semibold text-rm-text">
        :{emoji.shortcode}:
      </div>
      <div className="mt-0.5 line-clamp-2 min-h-8 text-ui-2xs leading-4 text-rm-text-muted">
        {emoji.prompt}
      </div>
    </button>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  isCollapsed,
  onToggle,
  accentClassName,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  accentClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-left pointer-fine:hover:bg-rm-tint-1"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-md bg-rm-tint-1",
            accentClassName,
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-ui-sm font-semibold text-rm-text">
            {title}
          </div>
          <div className="text-ui-2xs text-rm-text-muted">
            {count} {count === 1 ? "emoji" : "emojis"}
          </div>
        </div>
      </div>
      <Icon
        name="chevronDown"
        size="xs"
        className={cn(
          "shrink-0 text-rm-text-muted transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
    </button>
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
  const nativeCategories = useMemo(
    () => getNativeEmojiCategories(selectedSkinTone),
    [selectedSkinTone],
  );
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >(() => buildInitialCollapsedCategories(nativeCategories));
  const [activeCategory, setActiveCategory] =
    useState<string>(CUSTOM_SECTION_ID);
  const pendingJumpIdRef = useRef<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [shortcode, setShortcode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

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
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nativeSectionOrder = useMemo(
    () => [
      CUSTOM_SECTION_ID,
      ...nativeCategories.map((category) => category.id),
    ],
    [nativeCategories],
  );

  const readyGeneratedEmojis = useMemo(
    () =>
      generatedEmojis.filter(
        (item) => item.status === "ready" && Boolean(item.image_url),
      ),
    [generatedEmojis],
  );
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
      deferredSearch
        ? searchNativeEmojis(deferredSearch, 120, selectedSkinTone)
        : [],
    [deferredSearch, selectedSkinTone],
  );
  const clapPreviewEmoji = useMemo(
    () =>
      resolveNativeEmojiShortcode("clap", selectedSkinTone) ??
      resolveNativeEmojiShortcode("raised_hands", selectedSkinTone),
    [selectedSkinTone],
  );
  const customCategoryPreview = readyGeneratedEmojis[0] ?? null;

  const setSectionRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
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
    [generatedEmojis, recents, selectedSkinTone],
  );

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

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: Math.max(0, node.offsetTop - 8),
        behavior: "smooth",
      });
      pendingJumpIdRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeView, deferredSearch]);

  useEffect(() => {
    setCollapsedCategories((current) => {
      const next = { ...current };

      if (!(RECENTS_SECTION_ID in next)) next[RECENTS_SECTION_ID] = false;
      if (!(CUSTOM_SECTION_ID in next)) next[CUSTOM_SECTION_ID] = false;
      for (const category of nativeCategories) {
        if (!(category.id in next))
          next[category.id] = category.id !== nativeCategories[0]?.id;
      }

      return next;
    });
  }, [nativeCategories]);

  useEffect(() => {
    if (activeCategory !== CUSTOM_SECTION_ID) return;
    if (generatedEmojis.length > 0) return;
    if (nativeCategories[0]) {
      setActiveCategory(nativeCategories[0].id);
    }
  }, [activeCategory, generatedEmojis.length, nativeCategories]);

  useEffect(() => {
    const updatePosition = () => {
      if (!markerRef.current) return;
      if (isMobileViewport()) {
        setDynamicStyle({ opacity: 1 });
        return;
      }

      const rect = markerRef.current.getBoundingClientRect();
      const pickerWidth = 440;

      // Calculate absolute safe max height
      const MAX_HEIGHT = Math.min(600, window.innerHeight - 20);

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

    let nextActive = activeCategory;
    const scrollTop = container.scrollTop;

    for (const id of nativeSectionOrder) {
      const node = sectionRefs.current[id];
      if (!node) continue;

      if (node.offsetTop - 32 <= scrollTop) {
        nextActive = id;
      }
    }

    if (nextActive !== activeCategory) {
      setActiveCategory(nextActive);
    }
  }, [activeCategory, deferredSearch, nativeSectionOrder]);

  const jumpToSection = useCallback((id: string) => {
    setActiveView("emoji");
    setSearch("");
    setActiveCategory(id);
    setShowSkinToneMenu(false);
    setCollapsedCategories((current) => ({
      ...current,
      [id]: false,
    }));
    pendingJumpIdRef.current = id;
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsedCategories((current) => ({
      ...current,
      [id]: !current[id],
    }));
    setActiveCategory(id);
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
              <TooltipProvider delayDuration={100}>
                <PickerSurface
                  open={open}
                  modal={false}
                  onBackButton={
                    open && !isClosing ? handleBackButton : undefined
                  }
                  onOpenChange={(nextOpen) => !nextOpen && onClose()}
                  ariaLabel="Emoji picker"
                  className="h-[min(600px,calc(100dvh-24px))] w-[min(440px,calc(100vw-24px))]"
                  style={dynamicStyle}
                  stacked
                  onEscapeKeyDown={(event) => {
                    if (showSkinToneMenu) {
                      event.preventDefault();
                      setShowSkinToneMenu(false);
                    }
                  }}
                >
                  <div className="shrink-0 border-b border-rm-border p-3">
                    {activeView === "emoji" ? (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="relative min-w-0 flex-1">
                            <Icon
                              name="search"
                              size="sm"
                              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-rm-text-muted"
                            />
                            <Input
                              ref={searchInputRef}
                              id={searchInputId}
                              type="text"
                              value={search}
                              onChange={(event) => {
                                setSearch(event.target.value);
                                setShowSkinToneMenu(false);
                              }}
                              placeholder="Search emoji and your creations"
                              aria-label="Search emoji and your creations"
                              className="h-9 pl-9 pointer-coarse:h-11"
                            />
                          </div>

                          <div className="relative">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    setShowSkinToneMenu((current) => !current)
                                  }
                                  className="size-9 pointer-coarse:size-11"
                                  aria-label="Choose emoji skin tone"
                                  aria-expanded={showSkinToneMenu}
                                >
                                  {clapPreviewEmoji ? (
                                    <ReadyEmojiPreview
                                      alt="Choose emoji skin tone"
                                      imageUrl={clapPreviewEmoji.imageUrl}
                                      native={clapPreviewEmoji.native}
                                      className="h-6 w-6"
                                    />
                                  ) : (
                                    <span className="text-ui-xl">👏</span>
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={8}>
                                Skin tone
                              </TooltipContent>
                            </Tooltip>

                            {showSkinToneMenu ? (
                              <div
                                className={cn(
                                  MENU_PANEL,
                                  "absolute right-0 top-[calc(100%+8px)] z-10 w-52",
                                )}
                              >
                                {NATIVE_EMOJI_SKIN_TONE_OPTIONS.map(
                                  (option) => {
                                    const optionClapEmoji =
                                      resolveNativeEmojiShortcode(
                                        "clap",
                                        option.tone,
                                      ) ?? clapPreviewEmoji;
                                    const isActive =
                                      selectedSkinTone === option.tone;

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
                                            className="h-5 w-5"
                                          />
                                        ) : (
                                          <span className="text-ui-md">👏</span>
                                        )}
                                        <span>{option.label}</span>
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            ) : null}
                          </div>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setActiveView("compose");
                                  setGenerateError(null);
                                  setGenerateSuccess(null);
                                  setShowSkinToneMenu(false);
                                }}
                                aria-label="Create emoji"
                                className="h-9 pointer-coarse:h-11"
                              >
                                <Icon name="magic" size="sm" />
                                <span className="hidden md:inline">Create</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={8}>
                              Generate your own emoji
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {hasPendingGeneratedEmojis ? (
                          <div className="mt-3 flex items-center gap-2 rounded-md bg-rm-warning-tint px-3 py-2 text-ui-xs font-medium text-rm-warning-ink">
                            <Icon
                              name="loader"
                              size="sm"
                              className="animate-spin"
                            />
                            Your creations are still generating. This list
                            refreshes automatically.
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setActiveView("emoji");
                              setGenerateError(null);
                              setGenerateSuccess(null);
                            }}
                          >
                            <Icon name="chevronLeft" size="xs" />
                            Back
                          </Button>
                          <div className="text-right">
                            <div className="text-ui-sm font-semibold text-rm-text">
                              AI Emoji Composer
                            </div>
                            <div className="text-ui-xs text-rm-text-muted">
                              Build custom emoji for your server vibe
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 space-y-3 rounded-lg border border-rm-border p-3">
                          <div>
                            <label
                              htmlFor={promptInputId}
                              className="mb-1.5 block text-ui-sm font-medium text-rm-text"
                            >
                              Prompt
                            </label>
                            <textarea
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
                              className="w-full resize-none rounded-md border border-rm-field-edge bg-transparent px-3 py-2 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted md:text-ui-sm"
                            />
                            <div className="mt-1 text-right text-ui-2xs text-rm-text-muted">
                              {prompt.trim().length} /{" "}
                              {MAX_AI_EMOJI_PROMPT_LENGTH}
                            </div>
                          </div>
                          <div>
                            <label
                              htmlFor={shortcodeInputId}
                              className="mb-1.5 block text-ui-sm font-medium text-rm-text"
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
                              className="rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink"
                            >
                              {generateError}
                            </div>
                          ) : null}
                          {generateSuccess ? (
                            <div className="rounded-md bg-rm-success-tint px-3 py-2 text-ui-sm text-rm-success-ink">
                              {generateSuccess}
                            </div>
                          ) : null}
                          <Button
                            size="lg"
                            onClick={() => void handleGenerate()}
                            disabled={!prompt.trim()}
                            loading={isGenerating}
                            className="w-full"
                          >
                            <Icon name="sparkle" size="sm" />
                            Generate emoji
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {activeView === "emoji" ? (
                      <div className="flex min-h-0 flex-1">
                        <aside className="flex w-14 shrink-0 flex-col border-r border-rm-border px-2 py-2">
                          <div className="no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() =>
                                    jumpToSection(CUSTOM_SECTION_ID)
                                  }
                                  aria-label="Your creations"
                                  aria-pressed={
                                    activeCategory === CUSTOM_SECTION_ID
                                  }
                                  className={cn(
                                    "flex size-10 items-center justify-center self-center rounded-md",
                                    PRESS,
                                    HIT,
                                    activeCategory === CUSTOM_SECTION_ID &&
                                      "bg-rm-tint-2",
                                  )}
                                >
                                  {customCategoryPreview?.image_url ? (
                                    <ReadyEmojiPreview
                                      alt="Your creations"
                                      imageUrl={customCategoryPreview.image_url}
                                      className="h-6 w-6"
                                    />
                                  ) : (
                                    <Icon
                                      name="sparkle"
                                      size="lg"
                                      className="text-rm-accent-ink"
                                    />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" sideOffset={10}>
                                Your creations
                              </TooltipContent>
                            </Tooltip>

                            <div className="mx-auto my-1 h-px w-8 bg-rm-border" />

                            {nativeCategories.map((category) => (
                              <Tooltip key={category.id}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => jumpToSection(category.id)}
                                    aria-label={category.label}
                                    aria-pressed={
                                      activeCategory === category.id
                                    }
                                    className={cn(
                                      "flex size-10 items-center justify-center self-center rounded-md",
                                      PRESS,
                                      HIT,
                                      activeCategory === category.id &&
                                        "bg-rm-tint-2",
                                    )}
                                  >
                                    <ReadyEmojiPreview
                                      alt={category.label}
                                      imageUrl={category.iconImageUrl}
                                      native={category.iconNative}
                                      className="size-5 grayscale opacity-75"
                                    />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right" sideOffset={10}>
                                  {category.label}
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        </aside>

                        <div
                          ref={contentRef}
                          onScroll={handleEmojiListScroll}
                          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
                        >
                          {deferredSearch ? (
                            <div className="space-y-5">
                              <div className="px-1.5">
                                <div className="text-ui-sm font-semibold text-rm-text">
                                  Search results
                                </div>
                                <div className="mt-0.5 text-ui-xs text-rm-text-muted">
                                  {customSearchResults.length +
                                    nativeSearchResults.length}{" "}
                                  matches for "{deferredSearch}"
                                </div>
                              </div>

                              {customSearchResults.length > 0 ? (
                                <section>
                                  <SectionHeader
                                    icon={
                                      <Icon
                                        name="sparkle"
                                        size="sm"
                                        className="text-rm-accent-ink"
                                      />
                                    }
                                    title="Your Creations"
                                    count={customSearchResults.length}
                                    isCollapsed={false}
                                    onToggle={() => undefined}
                                    accentClassName="bg-rm-accent-tint"
                                  />
                                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                                    {customSearchResults.map((emoji) => (
                                      <CustomEmojiCard
                                        key={emoji.id}
                                        emoji={emoji}
                                        onSelect={handleCustomSelect}
                                      />
                                    ))}
                                  </div>
                                </section>
                              ) : null}

                              {nativeSearchResults.length > 0 ? (
                                <section>
                                  <SectionHeader
                                    icon={
                                      <Icon
                                        name="search"
                                        size="sm"
                                        className="text-rm-text"
                                      />
                                    }
                                    title="Emoji"
                                    count={nativeSearchResults.length}
                                    isCollapsed={false}
                                    onToggle={() => undefined}
                                  />
                                  <div className="grid grid-cols-6 gap-1.5 md:grid-cols-7">
                                    {nativeSearchResults.map((emoji) => (
                                      <NativeEmojiButton
                                        key={`${emoji.id}-${emoji.unified}`}
                                        emoji={emoji}
                                        onSelect={handleNativeSelect}
                                      />
                                    ))}
                                  </div>
                                </section>
                              ) : null}

                              {customSearchResults.length === 0 &&
                              nativeSearchResults.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-rm-border px-5 py-10 text-center text-ui-sm text-rm-text-muted">
                                  No emoji matched "{deferredSearch}".
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="space-y-5">
                              <section ref={setSectionRef(RECENTS_SECTION_ID)}>
                                <SectionHeader
                                  icon={
                                    <Icon
                                      name="clock"
                                      size="sm"
                                      className="text-rm-text"
                                    />
                                  }
                                  title="Recently Used"
                                  count={recents.length}
                                  isCollapsed={
                                    collapsedCategories[RECENTS_SECTION_ID] ??
                                    false
                                  }
                                  onToggle={() =>
                                    toggleSection(RECENTS_SECTION_ID)
                                  }
                                />
                                {!(
                                  collapsedCategories[RECENTS_SECTION_ID] ??
                                  false
                                ) ? (
                                  recentRenderableItems.length > 0 ? (
                                    <div className="grid grid-cols-6 gap-1.5 md:grid-cols-7">
                                      {recentRenderableItems.map((item) =>
                                        item.type === "native" ? (
                                          <NativeEmojiButton
                                            key={item.key}
                                            emoji={item.emoji}
                                            onSelect={handleNativeSelect}
                                          />
                                        ) : (
                                          <CustomEmojiCard
                                            key={item.key}
                                            emoji={item.emoji}
                                            onSelect={handleCustomSelect}
                                          />
                                        ),
                                      )}
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-dashed border-rm-border px-4 py-5 text-ui-sm text-rm-text-muted">
                                      Your recently used emoji will show up
                                      here.
                                    </div>
                                  )
                                ) : null}
                              </section>

                              <section ref={setSectionRef(CUSTOM_SECTION_ID)}>
                                <SectionHeader
                                  icon={
                                    customCategoryPreview?.image_url ? (
                                      <ReadyEmojiPreview
                                        alt="Your creations"
                                        imageUrl={
                                          customCategoryPreview.image_url
                                        }
                                        className="h-5 w-5"
                                      />
                                    ) : (
                                      <Icon
                                        name="sparkle"
                                        size="sm"
                                        className="text-rm-accent-ink"
                                      />
                                    )
                                  }
                                  title="Your Creations"
                                  count={generatedEmojis.length}
                                  isCollapsed={
                                    collapsedCategories[CUSTOM_SECTION_ID] ??
                                    false
                                  }
                                  onToggle={() =>
                                    toggleSection(CUSTOM_SECTION_ID)
                                  }
                                  accentClassName="bg-rm-accent-tint"
                                />
                                {!(
                                  collapsedCategories[CUSTOM_SECTION_ID] ??
                                  false
                                ) ? (
                                  loadingGeneratedEmojis ? (
                                    <div className="rounded-lg border border-rm-border px-4 py-5 text-ui-sm text-rm-text-muted">
                                      Loading your creations...
                                    </div>
                                  ) : generatedEmojiError ? (
                                    <div className="rounded-md bg-rm-danger-tint px-4 py-3 text-ui-sm text-rm-danger-ink">
                                      {generatedEmojiError}
                                    </div>
                                  ) : generatedEmojis.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                                      {generatedEmojis.map((emoji) => (
                                        <CustomEmojiCard
                                          key={emoji.id}
                                          emoji={emoji}
                                          onSelect={handleCustomSelect}
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-dashed border-rm-border px-5 py-10 text-center">
                                      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-lg bg-rm-accent-tint">
                                        <Icon
                                          name="sparkle"
                                          size="lg"
                                          className="text-rm-accent-ink"
                                        />
                                      </div>
                                      <div className="text-ui-sm font-semibold text-rm-text">
                                        No custom emoji yet
                                      </div>
                                      <div className="mt-1 text-ui-sm text-rm-text-muted">
                                        Use the composer button above to
                                        generate your first one.
                                      </div>
                                    </div>
                                  )
                                ) : null}
                              </section>

                              {nativeCategories.map((category) => (
                                <section
                                  key={category.id}
                                  ref={setSectionRef(category.id)}
                                  style={{
                                    contentVisibility: "auto",
                                    containIntrinsicSize: "280px",
                                  }}
                                >
                                  <SectionHeader
                                    icon={
                                      <ReadyEmojiPreview
                                        alt={category.label}
                                        imageUrl={category.iconImageUrl}
                                        native={category.iconNative}
                                        className="h-5 w-5"
                                      />
                                    }
                                    title={category.label}
                                    count={category.emojis.length}
                                    isCollapsed={
                                      collapsedCategories[category.id] ?? false
                                    }
                                    onToggle={() => toggleSection(category.id)}
                                  />
                                  {!(
                                    collapsedCategories[category.id] ?? false
                                  ) ? (
                                    <div className="grid grid-cols-6 gap-1.5 md:grid-cols-7">
                                      {category.emojis.map((emoji) => (
                                        <NativeEmojiButton
                                          key={`${category.id}-${emoji.id}-${emoji.unified}`}
                                          emoji={emoji}
                                          onSelect={handleNativeSelect}
                                        />
                                      ))}
                                    </div>
                                  ) : null}
                                </section>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                        <section>
                          <SectionHeader
                            icon={
                              <Icon
                                name="sparkle"
                                size="sm"
                                className="text-rm-accent-ink"
                              />
                            }
                            title="Your Creations"
                            count={generatedEmojis.length}
                            isCollapsed={false}
                            onToggle={() => undefined}
                            accentClassName="bg-rm-accent-tint"
                          />
                          {loadingGeneratedEmojis ? (
                            <div className="rounded-lg border border-rm-border px-4 py-5 text-ui-sm text-rm-text-muted">
                              Loading your creations...
                            </div>
                          ) : generatedEmojiError ? (
                            <div className="rounded-md bg-rm-danger-tint px-4 py-3 text-ui-sm text-rm-danger-ink">
                              {generatedEmojiError}
                            </div>
                          ) : generatedEmojis.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                              {generatedEmojis.map((emoji) => (
                                <CustomEmojiCard
                                  key={emoji.id}
                                  emoji={emoji}
                                  onSelect={handleCustomSelect}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-rm-border px-5 py-10 text-center text-ui-sm text-rm-text-muted">
                              Your creations will show up here as soon as you
                              generate them.
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </div>
                </PickerSurface>
              </TooltipProvider>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
