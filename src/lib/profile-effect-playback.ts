import type { ProfileEffectLayer, ProfileEffectSelection } from "@/lib/avatar-display";

type MediaKind = "image" | "video";

export type ProfileEffectFallbackAsset = {
  src: string | null;
  kind: MediaKind;
};

export type ProfileEffectPlaybackLayerState = {
  layer: ProfileEffectLayer;
  renderIndex: number;
  renderKey: string;
  active: boolean;
  cycleIndex: number;
  startMs: number;
  activeOffsetMs: number;
  zIndex: number;
  nextTransitionMs: number | null;
};

export type ProfileEffectPlaybackSnapshot = {
  activeLayers: ProfileEffectPlaybackLayerState[];
  nextTransitionMs: number | null;
};

function normalizeNonNegativeInt(value: number | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function normalizeFiniteInt(value: number | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

function normalizePositiveInt(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function pickFallbackAsset(
  candidates: Array<{ src?: string; kind: MediaKind }>,
): ProfileEffectFallbackAsset {
  for (const candidate of candidates) {
    if (candidate.src) return { src: candidate.src, kind: candidate.kind };
  }
  return { src: null, kind: "image" };
}

export function getProfileEffectFallbackAsset(
  effect: ProfileEffectSelection | undefined,
  options?: {
    playAnimation?: boolean;
    prefersReducedMotion?: boolean;
  },
): ProfileEffectFallbackAsset {
  if (!effect) return { src: null, kind: "image" };

  const playAnimation = options?.playAnimation !== false;
  const prefersReducedMotion = options?.prefersReducedMotion === true;

  if (prefersReducedMotion) {
    return pickFallbackAsset([
      { src: effect.reducedMotionSrc, kind: "image" },
      { src: effect.staticFrameSrc, kind: "image" },
      { src: effect.staticUrl, kind: "image" },
      { src: effect.thumbnailPreviewSrc, kind: "image" },
      { src: effect.previewUrl, kind: "image" },
      { src: effect.animatedUrl, kind: "video" },
      { src: effect.effectUrls[0], kind: "video" },
    ]);
  }

  if (!playAnimation) {
    return pickFallbackAsset([
      { src: effect.staticFrameSrc, kind: "image" },
      { src: effect.reducedMotionSrc, kind: "image" },
      { src: effect.staticUrl, kind: "image" },
      { src: effect.thumbnailPreviewSrc, kind: "image" },
      { src: effect.previewUrl, kind: "image" },
      { src: effect.animatedUrl, kind: "video" },
      { src: effect.effectUrls[0], kind: "video" },
    ]);
  }

  return pickFallbackAsset([
    { src: effect.animatedUrl, kind: "video" },
    { src: effect.effectUrls[0], kind: "video" },
    { src: effect.thumbnailPreviewSrc, kind: "image" },
    { src: effect.previewUrl, kind: "image" },
    { src: effect.staticFrameSrc, kind: "image" },
    { src: effect.reducedMotionSrc, kind: "image" },
    { src: effect.staticUrl, kind: "image" },
  ]);
}

export function getProfileEffectLayerState(
  layer: ProfileEffectLayer,
  elapsedMs: number,
  renderIndex = 0,
): ProfileEffectPlaybackLayerState {
  const safeElapsed = normalizeNonNegativeInt(elapsedMs);
  const startMs = normalizeNonNegativeInt(layer.start);
  const durationMs = normalizePositiveInt(layer.duration);
  const loopDelayMs = normalizeNonNegativeInt(layer.loopDelay);
  const zIndex = 4 + renderIndex + normalizeFiniteInt(layer.zIndex);

  if (safeElapsed < startMs) {
    return {
      layer,
      renderIndex,
      renderKey: `${renderIndex}:${layer.src}:pending`,
      active: false,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: 0,
      zIndex,
      nextTransitionMs: startMs,
    };
  }

  if (!durationMs) {
    return {
      layer,
      renderIndex,
      renderKey: `${renderIndex}:${layer.src}:0`,
      active: true,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: safeElapsed - startMs,
      zIndex,
      nextTransitionMs: null,
    };
  }

  if (layer.loop !== true) {
    const active = safeElapsed < startMs + durationMs;
    return {
      layer,
      renderIndex,
      renderKey: `${renderIndex}:${layer.src}:0`,
      active,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: active ? safeElapsed - startMs : durationMs,
      zIndex,
      nextTransitionMs: active ? startMs + durationMs : null,
    };
  }

  const periodMs = durationMs + loopDelayMs;
  if (periodMs <= 0) {
    return {
      layer,
      renderIndex,
      renderKey: `${renderIndex}:${layer.src}:0`,
      active: true,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: safeElapsed - startMs,
      zIndex,
      nextTransitionMs: null,
    };
  }

  const elapsedSinceStart = safeElapsed - startMs;
  const cycleIndex = Math.floor(elapsedSinceStart / periodMs);
  const cycleStartMs = startMs + cycleIndex * periodMs;
  const cycleElapsedMs = elapsedSinceStart - cycleIndex * periodMs;
  const active = cycleElapsedMs < durationMs;

  return {
    layer,
    renderIndex,
    renderKey: `${renderIndex}:${layer.src}:${cycleIndex}`,
    active,
    cycleIndex,
    startMs: cycleStartMs,
    activeOffsetMs: active ? cycleElapsedMs : durationMs,
    zIndex,
    nextTransitionMs: active ? cycleStartMs + durationMs : cycleStartMs + periodMs,
  };
}

export function getProfileEffectPlaybackSnapshot(
  layers: ProfileEffectLayer[],
  elapsedMs: number,
): ProfileEffectPlaybackSnapshot {
  const states = layers.map((layer, index) => getProfileEffectLayerState(layer, elapsedMs, index));
  const nextTransitionMs = states.reduce<number | null>((soonest, state) => {
    if (state.nextTransitionMs == null) return soonest;
    if (state.nextTransitionMs <= elapsedMs) return soonest;
    return soonest == null ? state.nextTransitionMs : Math.min(soonest, state.nextTransitionMs);
  }, null);

  return {
    activeLayers: states.filter((state) => state.active),
    nextTransitionMs,
  };
}
