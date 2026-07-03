import type { ProfileEffectLayer, ProfileEffectSelection } from "@/lib/avatar-display";

type MediaKind = "image" | "video";

export type ProfileEffectFallbackAsset = {
  src: string | null;
  kind: MediaKind;
};

export type ProfileEffectPlaybackLayerState = {
  layer: ProfileEffectLayer;
  resolvedSrc: string;
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

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getLayerSourceOptions(layer: ProfileEffectLayer) {
  const sources = [
    layer.src,
    ...(layer.randomizedSources?.map((source) => source.src) ?? []),
  ].filter((src, index, entries) => Boolean(src) && entries.indexOf(src) === index);

  return sources.length ? sources : [layer.src];
}

export function resolveProfileEffectLayerSource(
  layer: ProfileEffectLayer,
  cycleIndex = 0,
  invocationSeed = 0,
) {
  const sources = getLayerSourceOptions(layer);
  if (sources.length === 1) return sources[0];

  const sourceIndex = hashString(`${layer.src}:${cycleIndex}:${invocationSeed}`) % sources.length;
  return sources[sourceIndex];
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
  invocationSeed = 0,
): ProfileEffectPlaybackLayerState {
  const safeElapsed = normalizeNonNegativeInt(elapsedMs);
  const startMs = normalizeNonNegativeInt(layer.start);
  const durationMs = normalizePositiveInt(layer.duration);
  const loopDelayMs = normalizeNonNegativeInt(layer.loopDelay);
  const zIndex = 4 + renderIndex + normalizeFiniteInt(layer.zIndex);
  const pendingSrc = resolveProfileEffectLayerSource(layer, 0, invocationSeed);

  if (safeElapsed < startMs) {
    return {
      layer,
      resolvedSrc: pendingSrc,
      renderIndex,
      renderKey: `${renderIndex}:${pendingSrc}:pending:${invocationSeed}`,
      active: false,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: 0,
      zIndex,
      nextTransitionMs: startMs,
    };
  }

  if (!durationMs) {
    const resolvedSrc = resolveProfileEffectLayerSource(layer, 0, invocationSeed);
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: `${renderIndex}:${resolvedSrc}:0:${invocationSeed}`,
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
    const resolvedSrc = resolveProfileEffectLayerSource(layer, 0, invocationSeed);
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: `${renderIndex}:${resolvedSrc}:0:${invocationSeed}`,
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
    const resolvedSrc = resolveProfileEffectLayerSource(layer, 0, invocationSeed);
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: `${renderIndex}:${resolvedSrc}:0:${invocationSeed}`,
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
  const resolvedSrc = resolveProfileEffectLayerSource(layer, cycleIndex, invocationSeed);

  return {
    layer,
    resolvedSrc,
    renderIndex,
    renderKey: `${renderIndex}:${resolvedSrc}:${cycleIndex}:${invocationSeed}`,
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
  invocationSeed = 0,
): ProfileEffectPlaybackSnapshot {
  const states = layers.map((layer, index) => getProfileEffectLayerState(layer, elapsedMs, index, invocationSeed));
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
