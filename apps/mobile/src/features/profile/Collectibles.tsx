import { useEffect, useState } from "react";
import { View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { RemoteImage } from "@/ui";

import type { Collectibles } from "./schema";
import { effectLayers } from "./style";

/** An APNG decoration loops forever; it plays this long on open, then rests. */
const DECORATION_PLAY_MS = 3000;
/** An effect that says nothing about its length plays this long. */
const EFFECT_FALLBACK_MS = 4000;
/** The effect art's stage (ProfileCollectiblesLayer.tsx), scaled to the sheet. */
const STAGE_WIDTH = 450;
const STAGE_HEIGHT = 880;

/** True for `ms` after mount (never under reduced motion), then false for good. */
function usePlayOnce(ms: number): boolean {
  const reducedMotion = useReducedMotion();
  const [playing, setPlaying] = useState(!reducedMotion);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), ms);
    return () => clearTimeout(timer);
  }, [playing, ms]);
  return playing;
}

/**
 * The avatar decoration's ring art over a round-cropped avatar (DESIGN's
 * exception: the art is drawn for a circle). Plays once on open, then
 * rests on its frame.
 */
export function AvatarDecoration({
  url,
  size,
}: {
  url: string;
  /** The avatar's size; the ring art overhangs it by a fifth each side. */
  size: number;
}) {
  const playing = usePlayOnce(DECORATION_PLAY_MS);
  const art = Math.round(size * 1.2);
  const inset = (art - size) / 2;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: -inset, left: -inset }}
    >
      <RemoteImage
        url={url}
        animate={playing}
        contentFit="contain"
        style={{ width: art, height: art }}
      />
    </View>
  );
}

/**
 * A profile effect over the top of the sheet: its layers play once when
 * the sheet opens, then give way to its still frame (Silent Idle). Under
 * reduced motion only the still shows.
 */
export function ProfileEffect({
  effect,
  width,
}: {
  effect: NonNullable<Collectibles["profileEffect"]>;
  width: number;
}) {
  const layers = effectLayers(effect);
  const length = layers.reduce(
    (end, layer) =>
      layer.duration === null
        ? end
        : Math.max(end, layer.start + layer.duration),
    0,
  );
  const playing = usePlayOnce(length > 0 ? length : EFFECT_FALLBACK_MS);
  const still = effect.reducedMotionSrc ?? effect.staticFrameSrc;
  const height = Math.round((width * STAGE_HEIGHT) / STAGE_WIDTH);
  const frame = {
    position: "absolute",
    top: 0,
    left: 0,
    width,
    height,
  } as const;
  if (!playing && !still) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={frame}
    >
      {playing ? (
        layers.map((layer) => (
          <RemoteImage
            key={layer.src}
            url={layer.src}
            animate
            contentFit="cover"
            style={frame}
          />
        ))
      ) : still ? (
        <RemoteImage url={still} contentFit="cover" style={frame} />
      ) : null}
    </View>
  );
}
