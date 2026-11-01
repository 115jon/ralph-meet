import { CaretLeft, Star, TrendUp } from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { tapHaptic } from "@/lib/haptics";
import { RADIUS, THEMES, useTheme } from "@/theme";
import { Icon, IconButton, RemoteImage, showToast, Text } from "@/ui";

import {
  fetchGifCategories,
  fetchGifs,
  gifErrorText,
  gifKey,
  gifPreview,
  GIF_MEDIA_TYPES,
  type Gif,
  type GifCategory,
  type GifMediaType,
} from "./api";
import { GifGrid } from "./GifGrid";
import { PoweredByKlipy } from "./KlipyMark";
import {
  loadGifFavorites,
  toggleGifFavorite,
  useGifFavorites,
} from "./library";

const MEDIA_LABEL: Readonly<Record<GifMediaType, string>> = {
  gifs: "GIFs",
  stickers: "Stickers",
  clips: "Clips",
  memes: "Memes",
};
const SEARCH_DELAY_MS = 300;
const TILE_HEIGHT = 70;
/** Text over pictures is always light, whatever the theme. */
const ON_IMAGE = THEMES.dark.ink1;

type Browse = "home" | "trending" | "favorites";

// Categories and the trending cover change slowly; keep them for the session.
const categoryCache = new Map<GifMediaType, readonly GifCategory[]>();
const coverCache = new Map<GifMediaType, Gif | null>();

interface Feed {
  readonly gifs: readonly Gif[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadMore: () => void;
}

/** Trending (no query) or search results for one media type, paged. */
function useGifFeed(
  mediaType: GifMediaType,
  query: string,
  enabled: boolean,
): Feed {
  const customerId = useSession((s) => s.user?.id);
  const [gifs, setGifs] = useState<readonly Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = useRef<string | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    async (first: boolean) => {
      if (!first && (busy.current || !next.current)) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchGifs(
          {
            mediaType,
            q: query,
            next: first ? null : next.current,
            customerId,
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        next.current = page.next ?? null;
        // A category's query rides along, as the web's share ping wants it.
        const results = page.results.map((gif) =>
          query ? { ...gif, query } : gif,
        );
        setGifs((current) => {
          const base = first ? [] : current;
          const seen = new Set(base.map(gifKey));
          return [...base, ...results.filter((gif) => !seen.has(gifKey(gif)))];
        });
      } catch (caught) {
        if (abort.signal.aborted) return;
        setError(gifErrorText(caught));
      } finally {
        if (controller.current === abort) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [mediaType, query, customerId],
  );

  useEffect(() => {
    if (!enabled) return;
    next.current = null;
    setGifs([]);
    void load(true);
    return () => controller.current?.abort();
  }, [enabled, load]);

  const loadMore = useCallback(() => void load(false), [load]);
  return { gifs, loading, error, loadMore };
}

/** KLIPY's categories and a trending cover for one media type, cached. */
function useCategories(mediaType: GifMediaType, enabled: boolean) {
  const customerId = useSession((s) => s.user?.id);
  // The caches are the state; this only says one of them filled.
  const [, setFilled] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const filled = () => {
      if (!abort.signal.aborted) setFilled((n) => n + 1);
    };
    if (!categoryCache.has(mediaType))
      fetchGifCategories(mediaType, abort.signal)
        .then((list) => categoryCache.set(mediaType, list))
        .catch(() => {
          if (!abort.signal.aborted) categoryCache.set(mediaType, []);
        })
        .finally(filled);
    if (!coverCache.has(mediaType))
      fetchGifs({ mediaType, limit: 1, customerId }, abort.signal)
        .then((page) => coverCache.set(mediaType, page.results[0] ?? null))
        .catch(() => undefined)
        .finally(filled);
    return () => abort.abort();
  }, [mediaType, enabled, customerId]);
  return {
    categories: categoryCache.get(mediaType) ?? null,
    cover: coverCache.get(mediaType) ?? null,
  };
}

/** A dark wash up from the bottom, so a label reads on any picture. */
function Wash() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        experimental_backgroundImage:
          "linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0) 70%)",
      }}
    />
  );
}

/** A browse tile: a still picture under a label. */
function CategoryTile({
  label,
  imageUrl,
  icon,
  plain,
  onPress,
}: {
  label: string;
  imageUrl?: string | null;
  icon?: typeof Star;
  /** Favorites: the surface itself, ruled, not a picture. */
  plain?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "48%",
        flexGrow: 1,
        height: TILE_HEIGHT,
        borderRadius: RADIUS,
        overflow: "hidden",
        justifyContent: "flex-end",
        padding: 8,
        backgroundColor: plain ? theme.ply2 : theme.tint1,
        borderWidth: plain ? 1 : 0,
        borderColor: theme.lineStrong,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {imageUrl && !plain ? (
        <>
          <RemoteImage
            url={imageUrl}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <Wash />
        </>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? (
          <Icon
            icon={icon}
            active={icon === Star}
            size={16}
            color={plain ? theme.ink1 : ON_IMAGE}
          />
        ) : null}
        <Text
          variant="name"
          numberOfLines={1}
          style={{ color: plain ? theme.ink1 : ON_IMAGE, flexShrink: 1 }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function MediaTabs({
  value,
  onChange,
}: {
  value: GifMediaType;
  onChange: (next: GifMediaType) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        gap: 18,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
      }}
    >
      {GIF_MEDIA_TYPES.map((type) => {
        const on = type === value;
        return (
          <Pressable
            key={type}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(type)}
            hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
            style={{
              paddingTop: 8,
              paddingBottom: 7,
              marginBottom: -1,
              borderBottomWidth: 2,
              borderBottomColor: on ? theme.ink1 : "transparent",
            }}
          >
            <Text
              variant="control"
              style={{ color: on ? theme.ink1 : theme.ink3 }}
            >
              {MEDIA_LABEL[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View
      style={{
        paddingVertical: 20,
        paddingHorizontal: 24,
        alignItems: "center",
      }}
    >
      <Text variant="row" tone="ink3" style={{ textAlign: "center" }}>
        {text}
      </Text>
    </View>
  );
}

interface GifTabProps {
  /** The search field's text. */
  query: string;
  /** Fills or clears the search field (a category, back). */
  onQuery: (query: string) => void;
  width: number;
  /** On screen: tiles play and back steps out of a list only then. */
  active: boolean;
  onSend: (gif: Gif) => void;
  bottomInset: number;
}

/**
 * The GIF tab: KLIPY through the server. Browsing shows Favorites,
 * Trending and KLIPY's categories; a search or a category shows results.
 * Tap a GIF to send it, long-press to star it.
 */
export function GifTab({
  query,
  onQuery,
  width,
  active,
  onSend,
  bottomInset,
}: GifTabProps) {
  const theme = useTheme();
  const [mediaType, setMediaType] = useState<GifMediaType>("gifs");
  const [browse, setBrowse] = useState<Browse>("home");
  const trimmed = query.trim();
  const [settled, setSettled] = useState(trimmed);
  useEffect(() => {
    // Clearing is immediate; typing waits for a pause.
    const timer = setTimeout(
      () => setSettled(trimmed),
      trimmed ? SEARCH_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [trimmed]);
  const debounced = trimmed ? settled : "";

  const searching = debounced.length > 0;
  const view: Browse | "search" = searching ? "search" : browse;
  const feed = useGifFeed(
    mediaType,
    searching ? debounced : "",
    active && (view === "search" || view === "trending"),
  );
  const { categories, cover } = useCategories(mediaType, active);
  const { favorites, load: favoritesLoad } = useGifFavorites();
  const shownFavorites = favorites.filter(
    (gif) => (gif.mediaType ?? "gifs") === mediaType,
  );

  useEffect(() => {
    if (active && favoritesLoad === "idle") void loadGifFavorites();
  }, [active, favoritesLoad]);

  // Back steps out of a list before it closes the panel.
  const inList = view !== "home";
  useEffect(() => {
    if (!active || !inList) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setBrowse("home");
      onQuery("");
      return true;
    });
    return () => sub.remove();
  }, [active, inList, onQuery]);

  const star = useCallback(async (gif: Gif) => {
    tapHaptic();
    const starred = await toggleGifFavorite(gif);
    showToast({
      label: "Favorites",
      text: starred ? "Starred" : "Unstarred",
      led: starred ? "talk" : "off",
    });
  }, []);

  let body;
  if (view === "home") {
    body = (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          padding: 10,
        }}
      >
        <CategoryTile
          label="Favorites"
          icon={Star}
          plain
          onPress={() => setBrowse("favorites")}
        />
        <CategoryTile
          label="Trending"
          icon={TrendUp}
          imageUrl={cover ? gifPreviewStill(cover) : null}
          onPress={() => setBrowse("trending")}
        />
        {(categories ?? []).map((category) => (
          <CategoryTile
            key={category.id}
            label={category.label}
            imageUrl={category.imageUrl}
            onPress={() => onQuery(category.query)}
          />
        ))}
        {categories === null ? <Note text="Loading categories…" /> : null}
      </ScrollView>
    );
  } else {
    const favoritesView = view === "favorites";
    const gifs = favoritesView ? shownFavorites : feed.gifs;
    const loading = favoritesView ? favoritesLoad === "loading" : feed.loading;
    const error = favoritesView ? null : feed.error;
    const empty = !loading && !error && gifs.length === 0;
    body = (
      <GifGrid
        gifs={gifs}
        width={width}
        active={active}
        onSend={onSend}
        onStar={(gif) => void star(gif)}
        onEndReached={favoritesView ? undefined : feed.loadMore}
        header={
          view === "search" ? null : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 2,
                paddingTop: 2,
              }}
            >
              <IconButton
                icon={CaretLeft}
                label="Back to categories"
                onPress={() => setBrowse("home")}
              />
              <Text variant="silk" tone="ink3">
                {favoritesView
                  ? "Favorites"
                  : `Trending ${MEDIA_LABEL[mediaType]}`}
              </Text>
            </View>
          )
        }
        footer={
          error ? (
            <Note text={error} />
          ) : loading ? (
            <Note text={`Loading ${MEDIA_LABEL[mediaType]}…`} />
          ) : empty ? (
            <Note
              text={
                favoritesView
                  ? "No favorites yet. Long-press a GIF to star it."
                  : `No ${MEDIA_LABEL[mediaType]} for “${debounced}”`
              }
            />
          ) : null
        }
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <MediaTabs value={mediaType} onChange={setMediaType} />
      <View style={{ flex: 1 }}>{body}</View>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.line,
          paddingBottom: bottomInset,
          backgroundColor: theme.ply1,
        }}
      >
        <PoweredByKlipy />
      </View>
    </View>
  );
}

/** A still for a cover tile: an image preview, never a video. */
function gifPreviewStill(gif: Gif): string | null {
  const preview = gifPreview(gif);
  return preview.kind === "image" ? preview.url : null;
}
