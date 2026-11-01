import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { useAppActive } from "@/lib/app-active";

import { gifKey, type Gif } from "./api";
import { GifTile } from "./GifTile";
import { framesBetween, layoutMasonry } from "./masonry";

const GAP = 6;
const PAD = 10;
/** Columns of at least this width. */
const MIN_COLUMN = 150;
/** Tiles are mounted this far (in viewports) above and below the view. */
const OVERSCAN = 1;
/** Near the end by this much, the next page loads. */
const LOAD_AHEAD = 600;

interface GifGridProps {
  gifs: readonly Gif[];
  width: number;
  /** The panel is up and this grid is the one in front. */
  active: boolean;
  onSend: (gif: Gif) => void;
  onStar: (gif: Gif) => void;
  onEndReached?: () => void;
  /** Drawn under the tiles: loading, an error, the end. */
  footer?: ReactNode;
  header?: ReactNode;
}

/**
 * Results as uneven columns, drawing only the tiles near the viewport and
 * playing only the ones in it, so a long scroll of GIFs costs a screenful.
 */
export function GifGrid({
  gifs,
  width,
  active,
  onSend,
  onStar,
  onEndReached,
  footer,
  header,
}: GifGridProps) {
  const appActive = useAppActive();
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const inner = width - PAD * 2;
  const columns = Math.max(2, Math.floor(inner / MIN_COLUMN));
  const layout = useMemo(
    () =>
      layoutMasonry(
        gifs.map((gif) => gif.aspectRatio),
        inner,
        columns,
        GAP,
      ),
    [gifs, inner, columns],
  );

  // The tiles' own coordinates start under the header.
  const top = scrollY - headerHeight;
  const mounted = useMemo(
    () =>
      new Set(
        framesBetween(
          layout.frames,
          top - viewport * OVERSCAN,
          top + viewport * (1 + OVERSCAN),
        ),
      ),
    [layout, top, viewport],
  );
  const playing = useMemo(
    () => new Set(framesBetween(layout.frames, top, top + viewport)),
    [layout, top, viewport],
  );
  const mayPlay = active && appActive && !reducedMotion;

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      setScrollY(contentOffset.y);
      if (
        contentOffset.y + layoutMeasurement.height >
        contentSize.height - LOAD_AHEAD
      )
        onEndReached?.();
    },
    [onEndReached],
  );

  return (
    <ScrollView
      onLayout={(event: LayoutChangeEvent) =>
        setViewport(event.nativeEvent.layout.height)
      }
      onScroll={onScroll}
      scrollEventThrottle={64}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 8 }}
    >
      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        {header}
      </View>
      <View
        style={{ height: layout.height, marginHorizontal: PAD, marginTop: 4 }}
      >
        {layout.frames.map((frame, index) => {
          const gif = gifs[index];
          if (!gif || !mounted.has(index)) return null;
          return (
            <GifTile
              key={gifKey(gif)}
              gif={gif}
              frame={frame}
              play={mayPlay && playing.has(index)}
              onPress={onSend}
              onLongPress={onStar}
            />
          );
        })}
      </View>
      {footer}
    </ScrollView>
  );
}
