import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  MAX_AI_EMOJI_PROMPT_LENGTH,
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
import { useBackButton } from "@/hooks/useBackButton";
import { primeCustomEmojiCache } from "@/hooks/useCustomEmojiLookup";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Loader2,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import InlineEmoji from "./InlineEmoji";

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  placement?: "top-end" | "bottom-end";
  markerRef?: React.RefObject<HTMLElement | null>;
  isClosing?: boolean;
}

const CUSTOM_SECTION_ID = "custom-creations";
const RECENTS_SECTION_ID = "recently-used";
const SKIN_TONE_STORAGE_KEY = "chat:emoji:skin-tone:v1";

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

function buildInitialCollapsedCategories(categories: NativeEmojiCategory[]): Record<string, boolean> {
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

  const rawValue = window.localStorage.getItem(SKIN_TONE_STORAGE_KEY);
  const numericValue = Number(rawValue);

  return Number.isInteger(numericValue) && numericValue >= 0 && numericValue <= 5
    ? numericValue as NativeEmojiSkinTone
    : 0;
}

function matchesGeneratedEmojiSearch(item: GeneratedEmoji, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;

  return `${item.shortcode} ${item.prompt}`.toLowerCase().includes(normalizedQuery);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent bg-rm-bg-hover hover:bg-rm-bg-active hover:scale-[1.04] active:scale-[0.98] transition-all"
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
  const isFailed = emoji.status === "failed";
  const isPending = emoji.status === "pending";

  return (
    <button
      type="button"
      disabled={!isReady}
      onClick={() => {
        if (isReady) onSelect(emoji);
      }}
      title={`:${emoji.shortcode}: ${emoji.prompt}`}
      aria-label={isReady ? `Insert :${emoji.shortcode}:` : `Emoji ${emoji.shortcode} is ${emoji.status}`}
      className={cn(
        "group rounded-2xl border p-2.5 text-left transition-all",
        isReady
          ? "border-rm-border bg-rm-bg-surface hover:border-primary/30 hover:bg-rm-bg-hover hover:scale-[1.01] active:scale-[0.99]"
          : "cursor-default border-rm-border bg-rm-bg-surface/50 opacity-90",
      )}
    >
      <div
        className={cn(
          "relative mb-2 flex h-14 items-center justify-center rounded-xl border",
          isReady ? "border-rm-border bg-rm-bg-hover" : "border-rm-border bg-rm-bg-surface/30",
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
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Generating</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Failed</span>
          </div>
        )}
      </div>
      <div className="truncate text-[11px] font-black text-rm-text">:{emoji.shortcode}:</div>
      <div className="mt-0.5 line-clamp-2 min-h-[2rem] text-[10px] leading-4 text-rm-text-muted">
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
      className="mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2 text-left transition-colors hover:bg-rm-bg-hover"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl border border-rm-border bg-rm-bg-hover", accentClassName)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-black uppercase tracking-[0.12em] text-rm-text">
            {title}
          </div>
          <div className="text-[11px] text-rm-text-muted">
            {count} {count === 1 ? "emoji" : "emojis"}
          </div>
        </div>
      </div>
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-rm-text-muted transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
    </button>
  );
}

export default function EmojiPicker({
  onSelect,
  onClose,
  placement = "top-end",
  markerRef: externalMarkerRef,
  isClosing = false,
}: Props) {
  const [activeView, setActiveView] = useState<EmojiView>("emoji");
  const [search, setSearch] = useState("");
  const [selectedSkinTone, setSelectedSkinTone] = useState<NativeEmojiSkinTone>(getStoredSkinTone);
  const [showSkinToneMenu, setShowSkinToneMenu] = useState(false);
  const [generatedEmojis, setGeneratedEmojis] = useState<GeneratedEmoji[]>([]);
  const [loadingGeneratedEmojis, setLoadingGeneratedEmojis] = useState(true);
  const [generatedEmojiError, setGeneratedEmojiError] = useState<string | null>(null);
  const [recents, setRecents] = useState<EmojiRecentItem[]>([]);
  const nativeCategories = useMemo(
    () => getNativeEmojiCategories(selectedSkinTone),
    [selectedSkinTone],
  );
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(
    () => buildInitialCollapsedCategories(nativeCategories),
  );
  const [activeCategory, setActiveCategory] = useState<string>(CUSTOM_SECTION_ID);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [shortcode, setShortcode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

  const internalMarkerRef = useRef<HTMLSpanElement>(null);
  const markerRef = externalMarkerRef ?? internalMarkerRef;
  const [dynamicStyle, setDynamicStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const promptInputId = useId();
  const searchInputId = useId();
  const shortcodeInputId = useId();

  const deferredSearch = useDeferredValue(search.trim());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nativeSectionOrder = useMemo(
    () => [CUSTOM_SECTION_ID, ...nativeCategories.map((category) => category.id)],
    [nativeCategories],
  );

  const readyGeneratedEmojis = useMemo(
    () => generatedEmojis.filter((item) => item.status === "ready" && Boolean(item.image_url)),
    [generatedEmojis],
  );
  const hasPendingGeneratedEmojis = useMemo(
    () => generatedEmojis.some((item) => item.status === "pending"),
    [generatedEmojis],
  );
  const customSearchResults = useMemo(
    () => (deferredSearch
      ? generatedEmojis.filter((item) => matchesGeneratedEmojiSearch(item, deferredSearch))
      : []),
    [deferredSearch, generatedEmojis],
  );
  const nativeSearchResults = useMemo(
    () => (deferredSearch ? searchNativeEmojis(deferredSearch, 120, selectedSkinTone) : []),
    [deferredSearch, selectedSkinTone],
  );
  const clapPreviewEmoji = useMemo(
    () => resolveNativeEmojiShortcode("clap", selectedSkinTone) ?? resolveNativeEmojiShortcode("raised_hands", selectedSkinTone),
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
      window.localStorage.setItem(SKIN_TONE_STORAGE_KEY, String(tone));
    }
  }, []);

  const recentRenderableItems = useMemo<RecentRenderableItem[]>(() => (
    recents.flatMap<RecentRenderableItem>((item) => {
      if (item.type === "native") {
        const emoji = resolveNativeEmojiShortcode(item.shortcode, selectedSkinTone)
          ?? resolveNativeEmojiShortcode(item.shortcode);

        return emoji
          ? [{ key: `recent-native-${item.id}`, type: "native" as const, emoji }]
          : [];
      }

      const customEmoji = generatedEmojis.find((emoji) => emoji.id === item.id);
      return customEmoji
        ? [{ key: `recent-custom-${item.id}`, type: "custom" as const, emoji: customEmoji }]
        : [];
    })
  ), [generatedEmojis, recents, selectedSkinTone]);

  const loadGeneratedEmojis = useCallback(async (options?: { signal?: AbortSignal; silent?: boolean }) => {
    setGeneratedEmojiError(null);
    if (!options?.silent) {
      setLoadingGeneratedEmojis(true);
    }

    try {
      const response = await apiGet<GeneratedEmojiListResponse>("/api/emojis", { signal: options?.signal });
      const nextItems = dedupeCreatedEmojis(response.items);
      primeCustomEmojiCache(nextItems);
      setGeneratedEmojis(nextItems);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setGeneratedEmojiError(getErrorMessage(error, "Could not load your emoji creations right now."));
    } finally {
      setLoadingGeneratedEmojis(false);
    }
  }, []);

  useEffect(() => {
    setRecents(loadEmojiRecents());
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [activeView]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGeneratedEmojis({ signal: controller.signal });
    return () => controller.abort();
  }, [loadGeneratedEmojis]);

  useEffect(() => {
    if (!hasPendingGeneratedEmojis) return undefined;

    const intervalId = window.setInterval(() => {
      void loadGeneratedEmojis({ silent: true });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [hasPendingGeneratedEmojis, loadGeneratedEmojis]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showSkinToneMenu) {
          setShowSkinToneMenu(false);
          return;
        }
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [onClose, showSkinToneMenu]);

  useBackButton(
    useCallback(() => {
      if (showSkinToneMenu) {
        setShowSkinToneMenu(false);
        return true;
      }
      onClose();
      return true;
    }, [onClose, showSkinToneMenu]),
    !isClosing
  );

  useEffect(() => {
    if (!pendingJumpId || activeView !== "emoji" || deferredSearch) return;

    const container = contentRef.current;
    const node = sectionRefs.current[pendingJumpId];
    if (!container || !node) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: Math.max(0, node.offsetTop - 8),
        behavior: "smooth",
      });
      setPendingJumpId(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeView, deferredSearch, pendingJumpId]);

  useEffect(() => {
    setCollapsedCategories((current) => {
      const next = { ...current };

      if (!(RECENTS_SECTION_ID in next)) next[RECENTS_SECTION_ID] = false;
      if (!(CUSTOM_SECTION_ID in next)) next[CUSTOM_SECTION_ID] = false;
      for (const category of nativeCategories) {
        if (!(category.id in next)) next[category.id] = category.id !== nativeCategories[0]?.id;
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
    let frameId: number;
    const updatePosition = () => {
      if (!markerRef.current) return;
      if (window.innerWidth < 640) {
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

      let left = rect.left;
      if (left + pickerWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - pickerWidth - 10);
      }
      if (left < 10) left = 10;
      style.left = left;

      if (placement === "bottom-end") {
        if (rect.bottom + 8 + MAX_HEIGHT > window.innerHeight - 10) {
          // Will clip bottom! Pin to safe bottom edge instead.
          style.bottom = 10;
        } else {
          style.top = rect.bottom + 8;
        }
      } else {
        style.bottom = window.innerHeight - rect.top + 8;
        style.maxHeight = Math.min(MAX_HEIGHT, Math.max(100, rect.top - 16));
      }
      setDynamicStyle(style);
    };

    frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [markerRef, placement]);

  const handleRememberRecent = useCallback((item: EmojiRecentItem) => {
    const nextRecents = rememberRecentEmoji(item);
    setRecents(nextRecents);
  }, []);

  const handleNativeSelect = useCallback((emoji: NativeEmoji) => {
    handleRememberRecent(toNativeEmojiRecentItem(emoji));
    onSelect(emoji.native);
    onClose();
  }, [handleRememberRecent, onClose, onSelect]);

  const handleCustomSelect = useCallback((emoji: GeneratedEmoji) => {
    if (!emoji.image_url) return;

    handleRememberRecent(toCustomEmojiRecentItem(emoji));
    onSelect(buildCustomEmojiToken(emoji.shortcode, emoji.id));
    onClose();
  }, [handleRememberRecent, onClose, onSelect]);

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
    setPendingJumpId(id);
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
      const response = await apiPost<{ item: GeneratedEmoji }, { prompt: string; shortcode?: string }>(
        "/api/emojis",
        {
          prompt: normalizedPrompt,
          ...(normalizedShortcode ? { shortcode: normalizedShortcode } : {}),
        },
      );

      primeCustomEmojiCache([response.item]);
      setGeneratedEmojis((current) => dedupeCreatedEmojis([response.item, ...current]));
      setPrompt("");
      setShortcode("");
      setGenerateSuccess(`Added :${response.item.shortcode}: to your creations.`);
    } catch (error) {
      setGenerateError(getErrorMessage(error, "Could not start emoji generation right now."));
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, shortcode]);

  const placementClasses =
    "fixed h-fit max-h-[80vh] sm:max-h-[600px] max-sm:bottom-0 max-sm:top-auto max-sm:inset-x-0 max-sm:h-[85dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-t-[26px] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:translate-y-0";

  return (
    <>
      {!externalMarkerRef ? (
        <span ref={internalMarkerRef} aria-hidden="true" className="absolute" style={{ pointerEvents: "none" }} />
      ) : null}
      {createPortal(
        <>
          <button
            type="button"
            className="fixed inset-0 z-[1050] bg-black/20 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
            onMouseDown={(event) => {
              event.preventDefault();
              onClose();
            }}
            aria-label="Close emoji picker"
          />
          <TooltipProvider delayDuration={100}>
            <dialog
              open
              className={cn(
                "picker-panel fixed z-[1051] m-0 flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-[26px] border p-0 shadow-[0_8px_30px_rgba(0,0,0,0.12)] outline-none dark:shadow-[0_22px_80px_rgba(0,0,0,0.55)] transition-all duration-150 ease-out",
                !isClosing ? "animate-in fade-in zoom-in-95 max-sm:slide-in-from-bottom max-sm:zoom-in-100 opacity-100" : "opacity-0 scale-95 max-sm:translate-y-8",
                placementClasses,
              )}
              style={dynamicStyle}
              aria-label="Emoji picker"
            >
              <div className="picker-header border-b px-4 pb-3 pt-4">
            {activeView === "emoji" ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted" />
                    <input
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
                      className="picker-search-input h-11 w-full rounded-2xl border pl-10 pr-4 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>

                  <div className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setShowSkinToneMenu((current) => !current)}
                          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rm-border bg-rm-bg-hover transition hover:bg-rm-bg-active"
                          aria-label="Choose emoji skin tone"
                        >
                          {clapPreviewEmoji ? (
                            <ReadyEmojiPreview
                              alt="Choose emoji skin tone"
                              imageUrl={clapPreviewEmoji.imageUrl}
                              native={clapPreviewEmoji.native}
                              className="h-6 w-6"
                            />
                          ) : (
                            <span className="text-xl">👏</span>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={8} className="bg-rm-bg-floating text-rm-text border border-rm-border shadow-xl text-xs font-semibold px-3 py-1.5">
                        Skin tone
                      </TooltipContent>
                    </Tooltip>

                    {showSkinToneMenu ? (
                      <div className="picker-panel absolute right-0 top-[calc(100%+8px)] z-10 w-52 rounded-2xl border backdrop-blur-2xl p-2 shadow-2xl">
                        {NATIVE_EMOJI_SKIN_TONE_OPTIONS.map((option) => {
                          const optionClapEmoji = resolveNativeEmojiShortcode("clap", option.tone) ?? clapPreviewEmoji;
                          const isActive = selectedSkinTone === option.tone;

                          return (
                            <button
                              key={option.tone}
                              type="button"
                              onClick={() => {
                                persistSkinTone(option.tone);
                                setShowSkinToneMenu(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                                isActive ? "bg-primary/15 text-primary font-bold" : "text-rm-text hover:bg-rm-bg-hover",
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
                                <span className="text-base">👏</span>
                              )}
                              <span className="text-sm font-semibold">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView("compose");
                          setGenerateError(null);
                          setGenerateSuccess(null);
                          setShowSkinToneMenu(false);
                        }}
                        className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rm-border bg-primary/20 px-3 text-sm font-black text-rm-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                      >
                        <WandSparkles className="h-4 w-4" />
                        <span className="hidden sm:inline">Create</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8} className="bg-rm-bg-floating text-rm-text border border-rm-border shadow-xl text-xs font-semibold px-3 py-1.5">
                      Generate your own emoji
                    </TooltipContent>
                  </Tooltip>
                </div>

                {hasPendingGeneratedEmojis ? (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-400/15 bg-amber-400/8 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-100">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Your creations are still generating. This list refreshes automatically.
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("emoji");
                      setGenerateError(null);
                      setGenerateSuccess(null);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rm-border bg-rm-bg-hover px-3 text-sm font-semibold text-rm-text transition-colors hover:bg-rm-bg-active"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <div className="text-right">
                    <div className="text-[12px] font-black uppercase tracking-[0.14em] text-rm-text">
                      AI Emoji Composer
                    </div>
                    <div className="text-[11px] text-rm-text-muted">
                      Build custom emoji for your server vibe
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-3 rounded-[24px] border border-rm-border bg-rm-bg-surface/30 p-4">
                  <div>
                    <label htmlFor={promptInputId} className="mb-2 block text-[12px] font-black uppercase tracking-[0.12em] text-rm-text">
                      Prompt
                    </label>
                    <textarea
                      id={promptInputId}
                      aria-label="Prompt"
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value.slice(0, MAX_AI_EMOJI_PROMPT_LENGTH));
                        setGenerateError(null);
                        setGenerateSuccess(null);
                      }}
                      rows={3}
                      placeholder="Cyber raccoon smirking with pixel sunglasses"
                      className="picker-search-input w-full resize-none rounded-2xl border px-4 py-3 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                    <div className="mt-1 text-right text-[11px] text-rm-text-muted">
                      {prompt.trim().length} / {MAX_AI_EMOJI_PROMPT_LENGTH}
                    </div>
                  </div>
                  <div>
                    <label htmlFor={shortcodeInputId} className="mb-2 block text-[12px] font-black uppercase tracking-[0.12em] text-rm-text">
                      Shortcode
                    </label>
                    <input
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
                      className="picker-search-input h-11 w-full rounded-2xl border px-4 text-[14px] outline-none transition placeholder:text-rm-text-muted focus:border-primary/60"
                    />
                  </div>
                  {generateError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
                      {generateError}
                    </div>
                  ) : null}
                  {generateSuccess ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                      {generateSuccess}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={!prompt.trim() || isGenerating}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-black text-white hover:opacity-90 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isGenerating ? "Starting generation..." : "Generate emoji"}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {activeView === "emoji" ? (
              <div className="flex h-[min(560px,70vh)] min-h-[420px]">
                <aside className="flex w-[68px] shrink-0 flex-col border-r border-rm-border bg-rm-bg-surface/30 px-2 py-3">
                  <div className="no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => jumpToSection(CUSTOM_SECTION_ID)}
                          className={cn(
                            "flex h-11 w-11 items-center justify-center self-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all",
                            activeCategory === CUSTOM_SECTION_ID
                              ? "border-rm-border bg-primary/20"
                              : "border-rm-border bg-rm-bg-hover hover:bg-rm-bg-active",
                          )}
                        >
                          {customCategoryPreview?.image_url ? (
                            <ReadyEmojiPreview
                              alt="Your creations"
                              imageUrl={customCategoryPreview.image_url}
                              className="h-6 w-6"
                            />
                          ) : (
                            <Sparkles className="h-5 w-5 text-primary" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10} className="bg-rm-bg-floating text-rm-text border border-rm-border shadow-xl text-xs font-semibold px-3 py-1.5">
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
                            className={cn(
                              "flex h-11 w-11 items-center justify-center self-center rounded-2xl border transition-colors",
                              activeCategory === category.id
                                ? "border-rm-border bg-rm-bg-active"
                                : "border-transparent bg-transparent hover:bg-rm-bg-hover",
                            )}
                          >
                            <ReadyEmojiPreview
                              alt={category.label}
                              imageUrl={category.iconImageUrl}
                              native={category.iconNative}
                              className="h-5 w-5 grayscale opacity-75"
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={10} className="bg-rm-bg-floating text-rm-text border border-rm-border shadow-xl text-xs font-semibold px-3 py-1.5">
                          {category.label}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </aside>

                <div
                  ref={contentRef}
                  onScroll={handleEmojiListScroll}
                  className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4"
                >
                  {deferredSearch ? (
                    <div className="space-y-5">
                      <div className="rounded-2xl border border-rm-border bg-rm-bg-surface/30 px-4 py-3">
                        <div className="text-[12px] font-black uppercase tracking-[0.12em] text-rm-text">
                          Search Results
                        </div>
                        <div className="mt-1 text-sm text-rm-text-muted">
                          {customSearchResults.length + nativeSearchResults.length} matches for "{deferredSearch}"
                        </div>
                      </div>

                      {customSearchResults.length > 0 ? (
                        <section>
                          <SectionHeader
                            icon={<Sparkles className="h-4 w-4 text-primary" />}
                            title="Your Creations"
                            count={customSearchResults.length}
                            isCollapsed={false}
                            onToggle={() => undefined}
                            accentClassName="bg-primary/20"
                          />
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                            icon={<Search className="h-4 w-4 text-rm-text" />}
                            title="Emoji"
                            count={nativeSearchResults.length}
                            isCollapsed={false}
                            onToggle={() => undefined}
                          />
                          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
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

                      {customSearchResults.length === 0 && nativeSearchResults.length === 0 ? (
                        <div className="rounded-[24px] border border-dashed border-rm-border bg-rm-bg-surface/10 px-5 py-10 text-center text-sm text-rm-text-muted">
                          No emoji matched "{deferredSearch}".
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <section ref={setSectionRef(RECENTS_SECTION_ID)}>
                        <SectionHeader
                          icon={<Clock3 className="h-4 w-4 text-rm-text" />}
                          title="Recently Used"
                          count={recents.length}
                          isCollapsed={collapsedCategories[RECENTS_SECTION_ID] ?? false}
                          onToggle={() => toggleSection(RECENTS_SECTION_ID)}
                        />
                        {!(collapsedCategories[RECENTS_SECTION_ID] ?? false) ? (
                          recentRenderableItems.length > 0 ? (
                            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
                              {recentRenderableItems.map((item) => item.type === "native" ? (
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
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-rm-border bg-rm-bg-surface/10 px-4 py-5 text-sm text-rm-text-muted">
                              Your recently used emoji will show up here.
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
                                imageUrl={customCategoryPreview.image_url}
                                className="h-5 w-5"
                              />
                            ) : (
                              <Sparkles className="h-4 w-4 text-primary" />
                            )
                          }
                          title="Your Creations"
                          count={generatedEmojis.length}
                          isCollapsed={collapsedCategories[CUSTOM_SECTION_ID] ?? false}
                          onToggle={() => toggleSection(CUSTOM_SECTION_ID)}
                          accentClassName="bg-primary/20"
                        />
                        {!(collapsedCategories[CUSTOM_SECTION_ID] ?? false) ? (
                          loadingGeneratedEmojis ? (
                            <div className="rounded-2xl border border-rm-border bg-rm-bg-surface/10 px-4 py-5 text-sm text-rm-text-muted">
                              Loading your creations...
                            </div>
                          ) : generatedEmojiError ? (
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
                              {generatedEmojiError}
                            </div>
                          ) : generatedEmojis.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {generatedEmojis.map((emoji) => (
                                <CustomEmojiCard
                                  key={emoji.id}
                                  emoji={emoji}
                                  onSelect={handleCustomSelect}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-[24px] border border-dashed border-rm-border bg-rm-bg-surface/10 px-5 py-10 text-center">
                              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20">
                                <Sparkles className="h-5 w-5 text-primary" />
                              </div>
                              <div className="text-sm font-semibold text-rm-text">
                                No custom emoji yet
                              </div>
                              <div className="mt-1 text-sm text-rm-text-muted">
                                Use the composer button above to generate your first one.
                              </div>
                            </div>
                          )
                        ) : null}
                      </section>

                      {nativeCategories.map((category) => (
                        <section
                          key={category.id}
                          ref={setSectionRef(category.id)}
                          style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
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
                            isCollapsed={collapsedCategories[category.id] ?? false}
                            onToggle={() => toggleSection(category.id)}
                          />
                          {!(collapsedCategories[category.id] ?? false) ? (
                            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
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
              <div className="custom-scrollbar h-[min(560px,70vh)] min-h-[420px] overflow-y-auto px-4 py-4">
                <section>
                  <SectionHeader
                    icon={<Sparkles className="h-4 w-4 text-primary" />}
                    title="Your Creations"
                    count={generatedEmojis.length}
                    isCollapsed={false}
                    onToggle={() => undefined}
                    accentClassName="bg-primary/20"
                  />
                  {loadingGeneratedEmojis ? (
                    <div className="rounded-2xl border border-rm-border bg-rm-bg-surface/10 px-4 py-5 text-sm text-rm-text-muted">
                      Loading your creations...
                    </div>
                  ) : generatedEmojiError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
                      {generatedEmojiError}
                    </div>
                  ) : generatedEmojis.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {generatedEmojis.map((emoji) => (
                        <CustomEmojiCard
                          key={emoji.id}
                          emoji={emoji}
                          onSelect={handleCustomSelect}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-rm-border bg-rm-bg-surface/10 px-5 py-10 text-center text-sm text-rm-text-muted">
                      Your creations will show up here as soon as you generate them.
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
            </dialog>
          </TooltipProvider>
        </>,
        document.body
      )}
    </>
  );
}
